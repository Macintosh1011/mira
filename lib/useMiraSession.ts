"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GenerateEvent,
  NarrationCue,
  Renderer,
} from "@/lib/types";
import { streamGenerate, type GenerateHandle } from "@/lib/sse";
import { Narrator } from "@/lib/voice/tts";
import { startDictation, type STTHandle } from "@/lib/voice/stt";
import { matchTopic, type Topic } from "@/lib/topics";
import type { AgentState } from "@/components/CommandPalette";

/**
 * The six-state shell machine, plus the `paused` sub-state.
 * `empty -> active -> listening -> generating -> playing -> morphing`.
 */
export type Phase =
  | "empty"
  | "active"
  | "listening"
  | "generating"
  | "playing"
  | "paused"
  | "morphing";

/** How the current scene is being rendered. */
export type SceneKind = "topic" | "live";

/** A unified, playable scene — whether hand-authored or live-generated. */
export interface ActiveScene {
  kind: SceneKind;
  /** State-badge topic label. */
  label: string;
  /** Phase-indicator labels (one per cue). */
  phaseLabels: string[];
  /** Caption + TTS cues. Cue i drives caption i and canvas phase i, in order. */
  cues: NarrationCue[];
  /** Topic SVG canvas component name, when kind === "topic". */
  canvas?: Topic["canvas"];
  /** Generated code body, when kind === "live". */
  code?: string;
  renderer?: Renderer;
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
  /** Palette mount + animation flags (decoupled from phase for the dismiss fade). */
  paletteVisible: boolean;
  dismissing: boolean;
  /** Imperative API. */
  openPalette: () => void;
  closePalette: () => void;
  setInput: (value: string) => void;
  toggleMic: () => void;
  submit: (query: string) => void;
  togglePause: () => void;
  openFollowUp: () => void;
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
  const [paletteVisible, setPaletteVisible] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const narratorRef = useRef<Narrator | null>(null);
  const handleRef = useRef<GenerateHandle | null>(null);
  const sttRef = useRef<STTHandle | null>(null);
  const renderRevRef = useRef(0);
  // Live generation accumulates code + cues; promote to a scene on `done`.
  const liveRef = useRef<{
    code: string;
    renderer: Renderer;
    cues: NarrationCue[];
  } | null>(null);

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
    narratorRef.current?.reset();
    setDismissing(true);
    window.setTimeout(() => {
      setPaletteVisible(false);
      setDismissing(false);
    }, 200);
    setPhase("empty");
    setScene(null);
    setCanvasPhase(-1);
    setCaptionIdx(-1);
  }, [stopStt]);

  const startPlaying = useCallback((next: ActiveScene) => {
    const n = narratorRef.current;
    // Dismiss the palette (200ms fade) then mount the canvas + start narration.
    setDismissing(true);
    setPhase("playing");
    window.setTimeout(() => {
      setPaletteVisible(false);
      setDismissing(false);
      setScene(next);
      if (!n) return;
      // Scene end: after the last cue's audio ends, hold a short tail, then
      // fade back to empty. onCue drives caption + phase the whole way here.
      n.setOnComplete(() => {
        setCaptionIdx(-1);
        window.setTimeout(() => {
          setPhase((p) => (p === "playing" ? "empty" : p));
          setScene((s) => (s === next ? null : s));
          setCanvasPhase(-1);
        }, SCENE_END_TAIL_MS);
      });
      n.reset();
      n.setCues(next.cues);
      n.start(); // synchronously fires onCue(0) -> caption 0 + phase 0
    }, 200);
  }, []);

  const runGeneration = useCallback(
    (query: string, mutate: boolean) => {
      handleRef.current?.abort();
      liveRef.current = { code: "", renderer: "2d", cues: [] };
      setAgents(["active", "idle", "idle", "idle"]);
      setPhase("generating");
      setPaletteVisible(true);
      setDismissing(false);
      setError(null);

      const handle = streamGenerate(
        {
          query,
          mode: mutate ? "mutate" : "new",
          previousSceneId: undefined,
        },
        {
          onEvent: (event) => {
            setAgents((prev) => agentsForEvent(prev, event));
            const live = liveRef.current;
            if (!live) return;
            if (event.type === "code_chunk") live.code += event.delta;
            if (event.type === "code_done") {
              live.code = event.code;
              live.renderer = event.renderer;
            }
            if (event.type === "narration") live.cues.push(event.cue);
            if (event.type === "done") {
              live.code = event.bundle.code;
              live.renderer = event.bundle.renderer;
              live.cues = event.bundle.narration;
              renderRevRef.current += 1;
              const cues = [...live.cues].sort(
                (a, b) => a.startMs - b.startMs,
              );
              // One canvas phase per narration cue, advanced in lockstep by the
              // Narrator's onCue.
              startPlaying({
                kind: "live",
                label: query.slice(0, 40),
                phaseLabels: cues.map((_, i) => `phase ${i + 1}`),
                cues,
                code: live.code,
                renderer: live.renderer,
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
    [startPlaying],
  );

  const submit = useCallback(
    (raw: string) => {
      const query = raw.trim();
      if (!query) return;
      // Prime audio playback while we're still inside the user gesture so the
      // prefetched ElevenLabs clips aren't autoplay-blocked at cue time.
      narratorRef.current?.unlock();
      stopStt();
      const mutate = phase === "morphing" && scene !== null;

      const topic = matchTopic(query);
      if (topic) {
        renderRevRef.current += 1;
        // Matched query: instant hand-authored SVG topic, no model round-trip.
        setAgents(["done", "done", "done", "done"]);
        startPlaying(topicToScene(topic, renderRevRef.current));
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

  const togglePause = useCallback(() => {
    const n = narratorRef.current;
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
  }, []);

  const openFollowUp = useCallback(() => {
    // Keep the canvas running underneath; reopen palette for a follow-up.
    setPhase("morphing");
    setPaletteVisible(true);
    setDismissing(false);
    setInputState("");
    setAgents(["idle", "idle", "idle", "idle"]);
  }, []);

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
    paletteVisible,
    dismissing,
    openPalette,
    closePalette,
    setInput,
    toggleMic,
    submit,
    togglePause,
    openFollowUp,
  };
}
