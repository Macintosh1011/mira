"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Pause, Play, MessageSquarePlus, RotateCcw } from "lucide-react";
import { useMiraSession } from "@/lib/useMiraSession";
import CommandPalette, {
  type PalettePhase,
} from "@/components/CommandPalette";
import NNCanvas from "@/components/canvas/NNCanvas";
import FedCanvas from "@/components/canvas/FedCanvas";
import { PhaseIndicator } from "@/components/canvas/CanvasShared";
import RenderHost from "@/lib/render/RenderHost";
import SimHost from "@/lib/render/SimHost";
import SceneControls from "@/components/SceneControls";
import LandingDetail from "@/components/landing/LandingDetail";
import { getSim } from "@/lib/sims";
import { loadRenderLibs } from "@/lib/render/libs";
import { RECENTS } from "@/lib/topics";
import type { ControlSpec } from "@/lib/types";

// three touches `window`; keep it out of SSR and the main bundle. Falls back to
// the faint CSS grain while the WebGL backdrop loads.
const NoiseField = dynamic(() => import("@/components/landing/NoiseField"), {
  ssr: false,
  loading: () => <div className="grain" />,
});

const TOPIC_CANVAS = {
  NNCanvas,
  FedCanvas,
} as const;

export default function Page() {
  const session = useMiraSession();
  const {
    phase,
    input,
    agents,
    micActive,
    canvasPhase,
    captionIdx,
    scene,
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
  } = session;

  const [controlsVisible, setControlsVisible] = useState(false);

  // ── Interactive-sim controls ────────────────────────────────────────
  // When the active scene is sim-rendered, resolve its ControlSpecs and hold
  // the live param values here (the single source of truth the SimHost reads
  // and the SceneControls writes). Re-seeds whenever the scene changes.
  const simId = scene?.kind === "live" ? scene.simId ?? null : null;
  const [simControls, setSimControls] = useState<ControlSpec[]>([]);
  const [simParams, setSimParams] = useState<Record<string, number>>({});
  const [equationHtml, setEquationHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const content = scene?.content;
    // Resolve controls (async, so setState lands in a microtask — never a
    // synchronous cascading render). No sim → empty controls + cleared params.
    const resolve = simId
      ? getSim(simId)
      : Promise.resolve(null);
    resolve.then((sim) => {
      if (cancelled) return;
      const controls = sim?.controls ?? [];
      setSimControls(controls);
      setSimParams(
        Object.fromEntries(
          controls.map((c) => [c.key, content?.params?.[c.key] ?? c.default]),
        ),
      );
    });
    // Render the optional equation off the shared katex bundle (async too).
    const eq = simId ? content?.equation : undefined;
    loadRenderLibs().then((libs) => {
      if (cancelled) return;
      if (!eq) {
        setEquationHtml(null);
        return;
      }
      try {
        setEquationHtml(
          libs.katex.renderToString(eq, {
            throwOnError: false,
            displayMode: true,
          }),
        );
      } catch {
        setEquationHtml(null);
      }
    });
    return () => {
      cancelled = true;
    };
    // Re-seed when the simId or the underlying scene (its renderRev) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simId, scene?.renderRev]);

  const isLive =
    phase === "playing" ||
    phase === "paused" ||
    phase === "morphing" ||
    phase === "ended";
  // Keep the prior scene mounted while a follow-up generates over it, and hold
  // it on screen in the rest state after narration ends.
  const showCanvas = scene !== null && phase !== "empty" && phase !== "active";
  const currentCaption =
    scene && captionIdx >= 0 ? scene.cues[captionIdx]?.text ?? null : null;
  const captionVisible = isLive && currentCaption !== null;

  // ── Global keyboard ─────────────────────────────────────────────────
  // Latest handlers via ref so the listener binds once.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;

      if (cmd && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (phase === "empty") openPalette();
        else if (
          phase === "playing" ||
          phase === "paused" ||
          phase === "ended"
        )
          openFollowUp();
        else if (phase === "morphing") cancelFollowUp();
        else closePalette();
        return;
      }
      if (e.key === "Escape") {
        // From the calm ENDED rest state, esc starts over (back to empty).
        if (phase === "ended") {
          endScene();
          return;
        }
        // Cancelling a follow-up returns to the held scene, not the homepage.
        if (phase === "morphing") {
          cancelFollowUp();
          return;
        }
        if (paletteVisible) closePalette();
        return;
      }
      if (
        e.key === " " &&
        (phase === "playing" || phase === "paused" || phase === "ended")
      ) {
        // don't hijack space while typing in a palette field
        const tag = document.activeElement?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        togglePause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    phase,
    paletteVisible,
    openPalette,
    closePalette,
    openFollowUp,
    togglePause,
    cancelFollowUp,
    endScene,
  ]);

  // ── Playback controls reveal on cursor move ─────────────────────────
  // The JSX gates visibility on phase, so we don't reset state on exit.
  // While playing/paused they auto-hide after idle; in the ENDED rest state
  // they stay pinned so the user always sees how to replay / follow up.
  useEffect(() => {
    if (phase === "ended") {
      // Deferred a tick so it isn't a synchronous setState in the effect body.
      const t = window.setTimeout(() => setControlsVisible(true), 0);
      return () => window.clearTimeout(t);
    }
    if (phase !== "playing" && phase !== "paused") return;
    let timeout: number;
    const reveal = () => {
      setControlsVisible(true);
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => setControlsVisible(false), 2200);
    };
    window.addEventListener("mousemove", reveal);
    // Reveal once on entry, deferred a tick so it isn't a synchronous
    // setState in the effect body.
    const initial = window.setTimeout(reveal, 0);
    return () => {
      window.removeEventListener("mousemove", reveal);
      window.clearTimeout(timeout);
      window.clearTimeout(initial);
    };
  }, [phase]);

  const palettePhase: PalettePhase =
    phase === "empty" ||
    phase === "playing" ||
    phase === "paused" ||
    phase === "ended"
      ? "active"
      : phase;

  const stateBadgeLabel = phase === "paused" ? "paused" : phase;
  const canvasDimmed = phase === "morphing" || phase === "generating";
  const TopicCanvas =
    scene?.kind === "topic" && scene.canvas
      ? TOPIC_CANVAS[scene.canvas]
      : null;

  return (
    <div className="mira-root">
      {/* Empty state — unmounted during playback so it can't overlap canvas */}
      {phase === "empty" && (
        <div className="empty">
          <NoiseField />
          <div className="empty-stack">
            <h1 className="empty-wordmark">Mira</h1>
            <p className="empty-tagline">The visualization layer for thinking.</p>
            <button className="empty-hint" onClick={openPalette}>
              <span className="kbd">⌘</span>
              <span className="kbd">K</span>
              <span style={{ marginLeft: 4 }}>to begin</span>
            </button>
            <LandingDetail onPick={submit} />
          </div>
        </div>
      )}

      {/* Canvas — hand-authored SVG topic OR live-generated scene.
          Dims during a follow-up (morphing) or while a follow-up regenerates. */}
      {showCanvas && scene && (
        <>
          {scene.kind === "topic" && TopicCanvas && (
            <TopicCanvas phase={canvasPhase} dimmed={canvasDimmed} />
          )}
          {scene.kind === "live" && (
            <div className={`canvas-wrap show ${canvasDimmed ? "dimmed" : ""}`}>
              {scene.simId && scene.content ? (
                <SimHost
                  key={scene.renderRev}
                  simId={scene.simId}
                  content={scene.content}
                  remountKey={scene.renderRev}
                  playing={phase !== "paused"}
                  phase={canvasPhase}
                  params={simParams}
                />
              ) : (
                <RenderHost
                  key={scene.renderRev}
                  code={scene.code ?? null}
                  remountKey={scene.renderRev}
                  playing={phase !== "paused"}
                  phase={canvasPhase}
                />
              )}
              <PhaseIndicator
                phase={canvasPhase}
                total={scene.phaseLabels.length}
                labels={scene.phaseLabels}
              />
            </div>
          )}
        </>
      )}

      {/* Captions — lower third, gradient backdrop, key-swap fade */}
      <div
        className="caption-zone"
        style={{
          opacity: captionVisible ? 1 : 0,
          transition: "opacity 250ms var(--ease-default)",
        }}
      >
        <div
          className={`caption ${captionVisible ? "show" : ""}`}
          key={captionIdx}
        >
          {currentCaption ?? ""}
        </div>
      </div>

      {/* Playback controls — also pinned in the ENDED rest state */}
      <div
        className={`playback ${
          controlsVisible &&
          (phase === "playing" || phase === "paused" || phase === "ended")
            ? "show"
            : ""
        }`}
      >
        <button
          className="pb-btn"
          onClick={phase === "ended" ? replay : togglePause}
          title={
            phase === "ended" ? "Replay" : phase === "paused" ? "Play" : "Pause"
          }
          aria-label={
            phase === "ended" ? "Replay" : phase === "paused" ? "Play" : "Pause"
          }
        >
          {phase === "ended" ? (
            <RotateCcw size={16} strokeWidth={1.5} />
          ) : phase === "paused" ? (
            <Play size={16} strokeWidth={1.5} />
          ) : (
            <Pause size={16} strokeWidth={1.5} />
          )}
        </button>
        <button
          className="pb-btn"
          onClick={openFollowUp}
          title="Ask follow-up"
          aria-label="Ask follow-up"
        >
          <MessageSquarePlus size={16} strokeWidth={1.5} />
        </button>
      </div>

      {/* ENDED rest-state hint — quiet affordance line, lower-center */}
      <div className={`ended-hint ${phase === "ended" ? "show" : ""}`}>
        <span className="kbd">⌘</span>
        <span className="kbd">K</span>
        <span className="eh-text">to ask a follow-up</span>
        <span className="eh-sep">·</span>
        <span className="kbd">esc</span>
        <span className="eh-text">to start over</span>
      </div>

      {/* Interactive-sim slider panel — kept available through the rest state */}
      {(phase === "playing" || phase === "paused" || phase === "ended") &&
        scene?.kind === "live" &&
        scene.simId &&
        simControls.length > 0 && (
          <SceneControls
            controls={simControls}
            values={simParams}
            equationHtml={equationHtml}
            visible={controlsVisible}
            onChange={(key, value) =>
              setSimParams((prev) => ({ ...prev, [key]: value }))
            }
          />
        )}

      {/* Backdrop (dim click-to-close; hidden during morphing so canvas shows) */}
      <div
        className={`backdrop ${
          paletteVisible && phase !== "morphing" ? "show" : ""
        }`}
        onClick={closePalette}
      />

      {/* Command palette */}
      <CommandPalette
        visible={paletteVisible && !dismissing}
        dismissing={dismissing}
        phase={palettePhase}
        inputValue={input}
        micActive={micActive}
        showAgents={phase === "generating" || phase === "morphing"}
        agentStates={agents}
        showRecent={phase === "active"}
        recents={RECENTS}
        showFamiliarity={phase === "active" || phase === "morphing"}
        familiarity={familiarity}
        onFamiliarityChange={setFamiliarity}
        onInputChange={setInput}
        onSubmit={() => submit(input)}
        onMicToggle={toggleMic}
        onPickRecent={(q) => {
          setInput(q);
          submit(q);
        }}
      />

      {/* State badge */}
      <div className={`state-badge ${isLive ? "live" : ""}`}>
        <span className="sb-dot" />
        <span>{stateBadgeLabel}</span>
        {scene && (
          <>
            <span style={{ opacity: 0.5 }}>·</span>
            <span style={{ opacity: 0.7 }}>{scene.label}</span>
          </>
        )}
      </div>
    </div>
  );
}
