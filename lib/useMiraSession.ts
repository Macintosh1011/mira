"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Familiarity,
  GenerateEvent,
  NarrationCue,
  Renderer,
  SceneContent,
} from "@/lib/types";
import { streamGenerate, type GenerateHandle } from "@/lib/sse";
import { Narrator } from "@/lib/voice/tts";
import { startDictation, type STTHandle } from "@/lib/voice/stt";
import { matchTopic, type Topic } from "@/lib/topics";
import type { AgentState } from "@/components/CommandPalette";

/**
 * The shell state machine, plus the `paused` sub-state.
 * `empty -> active -> listening -> generating -> playing -> ended`, with
 * `morphing` reachable from playing/paused/ended for a follow-up.
 */
export type Phase =
  | "empty"
  | "active"
  | "listening"
  | "generating"
  | "playing"
  | "paused"
  | "ended"
  | "morphing";

export type { Familiarity };

/** How the current scene is being rendered. */
export type SceneKind = "topic" | "live";

/** A unified, playable scene — whether hand-authored or live-generated. */
export interface ActiveScene {
  /**
   * Stable scene id. For live scenes it's the backend `SceneBundle.sceneId`;
   * for topics it's the topic id. Threaded back as `previousSceneId` on a
   * follow-up so the backend morphs THIS scene.
   */
  id: string;
  kind: SceneKind;
  /** State-badge topic label. */
  label: string;
  /** Phase-indicator labels (one per cue). */
  phaseLabels: string[];
  /** Caption + TTS cues. Cue i drives caption i and canvas phase i, in order. */
  cues: NarrationCue[];
  /** Topic SVG canvas component name, when kind === "topic". */
  canvas?: Topic["canvas"];
  /** Generated code body, when kind === "live" and no sim is attached. */
  code?: string;
  renderer?: Renderer;
  /**
   * Interactive-sim id, when the scene renders through the sim path. Takes
   * precedence over `code`: the page mounts SimHost(simId, content) instead of
   * RenderHost(code).
   */
  simId?: string;
  /** Structured per-beat content + initial params + equation for the sim. */
  content?: SceneContent;
  /** Bumped on each fresh live scene to force a clean render remount. */
  renderRev: number;
}

export interface MiraSession {
  phase: Phase;
  input: string;
  agents: AgentState[];
  micActive: boolean;
  canvasPhase: number;
  captionIdx: number;
  scene: ActiveScene | null;
  error: string | null;
  familiarity: Familiarity;
  /** Palette mount + animation flags (decoupled from phase for the dismiss fade). */
  paletteVisible: boolean;
  dismissing: boolean;
  /** Imperative API. */
  openPalette: () => void;
  closePalette: () => void;
  setInput: (value: string) => void;
  setFamiliarity: (value: Familiarity) => void;
  toggleMic: () => void;
  submit: (query: string) => void;
  togglePause: () => void;
  replay: () => void;
  openFollowUp: () => void;
  cancelFollowUp: () => void;
  endScene: () => void;
}

// How long the final caption + canvas linger after the last cue's audio ends,
// before the scene fades back to empty.
const SCENE_END_TAIL_MS = 1500;

/** SSE event -> which of the 4 agent dots [plan, gen, voice, check]. */
function agentsForEvent(
  prev: AgentState[],
  event: GenerateEvent,
): AgentState[] {
  const next: AgentState[] = [...prev];
  switch (event.type) {
    case "plan":
      next[0] = "done";
      next[1] = "active";
      next[2] = "active";
      break;
    case "code_chunk":
      if (next[1] === "idle") next[1] = "active";
      break;
    case "code_done":
      next[1] = "done";
      break;
    case "narration":
      // first narration cue means voice is producing
      next[2] = next[2] === "active" ? "done" : next[2];
      break;
    case "verify":
      next[2] = "done";
      next[3] = event.status === "block" ? "failed" : "active";
      break;
    case "error":
      next[3] = "failed";
      break;
    case "done":
      next[3] = "done";
      break;
  }
  return next;
}

function topicToScene(topic: Topic, renderRev: number): ActiveScene {
  return {
    id: topic.id,
    kind: "topic",
    label: topic.label,
    phaseLabels: topic.phaseLabels,
    cues: topic.captions.map((c, i) => ({
      phaseId: `cap-${i}`,
      text: c.text,
      startMs: c.t,
    })),
    canvas: topic.canvas,
    renderRev,
  };
}

export function useMiraSession(): MiraSession {
  const [phase, setPhase] = useState<Phase>("empty");
  const [input, setInputState] = useState("");
  const [agents, setAgents] = useState<AgentState[]>([
    "idle",
    "idle",
    "idle",
    "idle",
  ]);
  const [micActive, setMicActive] = useState(false);
  const [canvasPhase, setCanvasPhase] = useState(-1);
  const [captionIdx, setCaptionIdx] = useState(-1);
  const [scene, setScene] = useState<ActiveScene | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [familiarity, setFamiliarityState] = useState<Familiarity>("familiar");
  const [paletteVisible, setPaletteVisible] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const narratorRef = useRef<Narrator | null>(null);
  const handleRef = useRef<GenerateHandle | null>(null);
  const sttRef = useRef<STTHandle | null>(null);
  const renderRevRef = useRef(0);
  // Latest phase, read inside deferred timers (e.g. the scene-end caption fade)
  // without making those callbacks re-bind on every phase change. Synced in an
  // effect (writing a ref during render is disallowed by the React lint).
  const phaseRef = useRef<Phase>("empty");
  // Live scene currently on screen, mirrored in a ref so runGeneration can read
  // its id for `previousSceneId` without re-binding on every scene change.
  const sceneRef = useRef<ActiveScene | null>(null);
  // Live generation accumulates code + cues; promote to a scene on `done`.
  // `done` may also carry a simId + content (interactive-sim path).
  const liveRef = useRef<{
    sceneId: string;
    code: string;
    renderer: Renderer;
    cues: NarrationCue[];
    simId?: string;
    content?: SceneContent;
  } | null>(null);
  // Generation token: bumped on every submit / palette close so a cached
  // topic's deferred "generation theater" timers no-op if the user moved on.
  const matchGenRef = useRef(0);

  // Lazily construct the Narrator on the client. Each cue activation drives the
  // caption AND the canvas phase in lockstep — onCue(i) means cue i is speaking,
  // caption i is on screen, and the canvas is in phase i.
  useEffect(() => {
    const n = new Narrator();
    n.setOnCue((i) => {
      setCaptionIdx(i);
      setCanvasPhase(i);
    });
    narratorRef.current = n;
    return () => n.dispose();
  }, []);

  // Mirror the latest phase into a ref for deferred timers to read.
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Single writer for the on-screen scene: keeps the ref (read by
  // runGeneration for previousSceneId) in lockstep with the rendered state.
  const commitScene = useCallback((next: ActiveScene | null) => {
    sceneRef.current = next;
    setScene(next);
  }, []);

  const stopStt = useCallback(() => {
    sttRef.current?.stop();
    sttRef.current = null;
    setMicActive(false);
  }, []);

  // ── Transitions ─────────────────────────────────────────────────────
  const openPalette = useCallback(() => {
    setPhase("active");
    setInputState("");
    setAgents(["idle", "idle", "idle", "idle"]);
    setError(null);
    setDismissing(false);
    setPaletteVisible(true);
  }, []);

  const closePalette = useCallback(() => {
    stopStt();
    handleRef.current?.abort();
    handleRef.current = null;
    matchGenRef.current += 1; // cancel any pending cached-topic generation theater
    narratorRef.current?.reset();
    setDismissing(true);
    window.setTimeout(() => {
      setPaletteVisible(false);
      setDismissing(false);
    }, 200);
    setPhase("empty");
    commitScene(null);
    setCanvasPhase(-1);
    setCaptionIdx(-1);
  }, [stopStt, commitScene]);

  const startPlaying = useCallback(
    (next: ActiveScene) => {
      const n = narratorRef.current;
      // Dismiss the palette (200ms fade) then mount the canvas + start narration.
      setDismissing(true);
      setPhase("playing");
      window.setTimeout(() => {
        setPaletteVisible(false);
        setDismissing(false);
        commitScene(next);
        if (!n) return;
        // Scene end: hold the finished scene on its last frame and enter the
        // calm ENDED state instead of dumping back to the homepage. The canvas
        // stays mounted at the final phase; the caption fades after a short
        // tail. Esc starts over, ⌘K opens a follow-up.
        n.setOnComplete(() => {
          setPhase((p) => (p === "playing" ? "ended" : p));
          window.setTimeout(() => {
            // Fade the final caption only if we're still resting on this scene
            // (not if the user has since replayed or opened a follow-up).
            if (phaseRef.current === "ended") setCaptionIdx(-1);
          }, SCENE_END_TAIL_MS);
        });
        n.reset();
        n.setCues(next.cues);
        n.start(); // synchronously fires onCue(0) -> caption 0 + phase 0
      }, 200);
    },
    [commitScene],
  );

  const runGeneration = useCallback(
    (query: string, mutate: boolean) => {
      handleRef.current?.abort();
      liveRef.current = { sceneId: "", code: "", renderer: "2d", cues: [] };
      setAgents(["active", "idle", "idle", "idle"]);
      // A follow-up (mutate) keeps the current scene mounted + dimmed under the
      // palette while it regenerates — go to `morphing`, not `generating`, so
      // the canvas isn't torn down. A fresh query shows the full agent dock.
      const followUp = mutate && sceneRef.current !== null;
      setPhase(followUp ? "morphing" : "generating");
      setPaletteVisible(true);
      setDismissing(false);
      setError(null);

      const handle = streamGenerate(
        {
          query,
          mode: mutate ? "mutate" : "new",
          previousSceneId: followUp ? sceneRef.current?.id : undefined,
          familiarity,
        },
        {
          onEvent: (event) => {
            setAgents((prev) => agentsForEvent(prev, event));
            const live = liveRef.current;
            if (!live) return;
            if (event.type === "code_chunk") live.code += event.delta;
            if (event.type === "code_done") {
              live.sceneId = event.sceneId;
              live.code = event.code;
              live.renderer = event.renderer;
            }
            if (event.type === "narration") live.cues.push(event.cue);
            if (event.type === "done") {
              live.sceneId = event.bundle.sceneId;
              live.code = event.bundle.code;
              live.renderer = event.bundle.renderer;
              live.cues = event.bundle.narration;
              live.simId = event.bundle.simId;
              live.content = event.bundle.content;
              renderRevRef.current += 1;
              const cues = [...live.cues].sort(
                (a, b) => a.startMs - b.startMs,
              );
              // Sim path: prefer the content's per-beat labels for the phase
              // indicator; else fall back to "phase N". One canvas phase per
              // narration cue, advanced in lockstep by the Narrator's onCue.
              const phaseLabels =
                live.content?.phases?.length === cues.length
                  ? live.content.phases.map((p) => p.label)
                  : cues.map((_, i) => `phase ${i + 1}`);
              startPlaying({
                id: live.sceneId || `scene-${renderRevRef.current}`,
                kind: "live",
                label: live.content?.title?.slice(0, 40) ?? query.slice(0, 40),
                phaseLabels,
                cues,
                code: live.code,
                renderer: live.renderer,
                simId: live.simId,
                content: live.content,
                renderRev: renderRevRef.current,
              });
            }
          },
          onError: (message) => {
            setError(message);
            setAgents((prev) => {
              const next = [...prev];
              next[3] = "failed";
              return next;
            });
          },
        },
      );
      handleRef.current = handle;
    },
    [startPlaying, familiarity],
  );

  const submit = useCallback(
    (raw: string) => {
      const query = raw.trim();
      if (!query) return;
      // Prime audio playback while we're still inside the user gesture so the
      // prefetched ElevenLabs clips aren't autoplay-blocked at cue time.
      narratorRef.current?.unlock();
      stopStt();
      handleRef.current?.abort();
      const gen = (matchGenRef.current += 1);
      const mutate = phase === "morphing" && scene !== null;

      const topic = matchTopic(query);
      if (topic) {
        // Cached hand-authored topic: run the SAME agent-dot generation theater
        // as a live query (~7-9s) so it's indistinguishable from a real run and
        // never plays instantly. Token + phase guard cancel it on esc/resubmit.
        renderRevRef.current += 1;
        const topicScene = topicToScene(topic, renderRevRef.current);
        setAgents(["active", "idle", "idle", "idle"]);
        setPhase(mutate ? "morphing" : "generating");
        setPaletteVisible(true);
        setDismissing(false);
        const total = 6800 + Math.random() * 2400;
        const live = () => gen === matchGenRef.current;
        window.setTimeout(() => {
          if (live()) setAgents(["done", "active", "active", "idle"]);
        }, total * 0.32);
        window.setTimeout(() => {
          if (live()) setAgents(["done", "done", "done", "active"]);
        }, total * 0.74);
        window.setTimeout(() => {
          if (
            live() &&
            (phaseRef.current === "generating" || phaseRef.current === "morphing")
          ) {
            setAgents(["done", "done", "done", "done"]);
            startPlaying(topicScene);
          }
        }, total);
        return;
      }
      // Novel query: live Gemini generation.
      runGeneration(query, mutate);
    },
    [phase, scene, stopStt, startPlaying, runGeneration],
  );

  const toggleMic = useCallback(() => {
    if (micActive) {
      stopStt();
      setPhase((p) => (p === "listening" ? "active" : p));
      return;
    }
    setPhase("listening");
    setMicActive(true);
    setInputState("");
    const handle = startDictation({
      onTranscript: (text) => setInputState(text),
      onError: () => {
        setMicActive(false);
        setPhase((p) => (p === "listening" ? "active" : p));
      },
      onEnd: () => {
        sttRef.current = null;
        setMicActive(false);
        setPhase((p) => (p === "listening" ? "active" : p));
      },
    });
    if (!handle) {
      setMicActive(false);
      setPhase("active");
      return;
    }
    sttRef.current = handle;
  }, [micActive, stopStt]);

  // Replay the on-screen scene from the top (from `ended`, or any time the user
  // hits the replay control). Rewinds the Narrator and re-enters `playing`.
  const replay = useCallback(() => {
    const n = narratorRef.current;
    if (!n || !sceneRef.current) return;
    n.reset();
    n.setCues(sceneRef.current.cues);
    setPhase("playing");
    n.start();
  }, []);

  const togglePause = useCallback(() => {
    const n = narratorRef.current;
    if (phase === "ended") {
      replay();
      return;
    }
    setPhase((p) => {
      if (p === "playing") {
        n?.pause();
        return "paused";
      }
      if (p === "paused") {
        n?.start();
        return "playing";
      }
      return p;
    });
  }, [phase, replay]);

  const openFollowUp = useCallback(() => {
    // Keep the canvas mounted underneath (dimmed); reopen the palette for a
    // follow-up. Pause any in-flight narration so the scene freezes cleanly.
    narratorRef.current?.pause();
    setPhase("morphing");
    setPaletteVisible(true);
    setDismissing(false);
    setInputState("");
    setAgents(["idle", "idle", "idle", "idle"]);
  }, []);

  // Cancel a follow-up (esc / backdrop while morphing): abort any in-flight
  // regeneration and fall back to the held scene's rest state rather than
  // nuking it to the homepage. With no scene, behaves like closePalette.
  const cancelFollowUp = useCallback(() => {
    if (!sceneRef.current) {
      closePalette();
      return;
    }
    handleRef.current?.abort();
    handleRef.current = null;
    matchGenRef.current += 1; // cancel any pending cached-topic generation theater
    stopStt();
    setDismissing(true);
    window.setTimeout(() => {
      setPaletteVisible(false);
      setDismissing(false);
    }, 200);
    setPhase("ended");
  }, [closePalette, stopStt]);

  // Leave the ENDED rest state and start over from the homepage.
  const endScene = useCallback(() => {
    closePalette();
  }, [closePalette]);

  const setFamiliarity = useCallback(
    (value: Familiarity) => setFamiliarityState(value),
    [],
  );

  const setInput = useCallback((value: string) => setInputState(value), []);

  // Caption + canvas phase are driven entirely by the Narrator's onCue (cue i ->
  // captionIdx i + canvasPhase i) and scene end by its onComplete. There is no
  // separate clock tick: the spoken audio is the single timeline.

  return {
    phase,
    input,
    agents,
    micActive,
    canvasPhase,
    captionIdx,
    scene,
    error,
    familiarity,
    paletteVisible,
    dismissing,
    openPalette,
    closePalette,
    setInput,
    setFamiliarity,
    toggleMic,
    submit,
    togglePause,
    replay,
    openFollowUp,
    cancelFollowUp,
    endScene,
  };
}
