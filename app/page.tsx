"use client";

import { useEffect, useState } from "react";
import { Pause, Play, MessageSquarePlus } from "lucide-react";
import { useMiraSession } from "@/lib/useMiraSession";
import CommandPalette, {
  type PalettePhase,
} from "@/components/CommandPalette";
import NNCanvas from "@/components/canvas/NNCanvas";
import FedCanvas from "@/components/canvas/FedCanvas";
import { PhaseIndicator } from "@/components/canvas/CanvasShared";
import RenderHost from "@/lib/render/RenderHost";
import { RECENTS } from "@/lib/topics";

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
    paletteVisible,
    dismissing,
    openPalette,
    closePalette,
    setInput,
    toggleMic,
    submit,
    togglePause,
    openFollowUp,
  } = session;

  const [controlsVisible, setControlsVisible] = useState(false);

  const isLive = phase === "playing" || phase === "paused" || phase === "morphing";
  // Keep the prior scene mounted while a follow-up generates over it.
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
        else if (phase === "playing" || phase === "paused") openFollowUp();
        else closePalette();
        return;
      }
      if (e.key === "Escape") {
        if (paletteVisible) closePalette();
        return;
      }
      if (e.key === " " && (phase === "playing" || phase === "paused")) {
        // don't hijack space while typing in the palette
        if (document.activeElement?.tagName === "INPUT") return;
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
  ]);

  // ── Playback controls reveal on cursor move ─────────────────────────
  // The JSX gates visibility on phase, so we don't reset state on exit.
  useEffect(() => {
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
    phase === "empty" || phase === "playing" || phase === "paused"
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
          <div className="grain" />
          <div
            style={{
              position: "relative",
              zIndex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <h1 className="empty-wordmark">Mira</h1>
            <p className="empty-tagline">The visualization layer for thinking.</p>
            <button className="empty-hint" onClick={openPalette}>
              <span className="kbd">⌘</span>
              <span className="kbd">K</span>
              <span style={{ marginLeft: 4 }}>to begin</span>
            </button>
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
              <RenderHost
                key={scene.renderRev}
                code={scene.code ?? null}
                remountKey={scene.renderRev}
                playing={phase !== "paused"}
              />
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

      {/* Playback controls */}
      <div
        className={`playback ${
          controlsVisible && (phase === "playing" || phase === "paused")
            ? "show"
            : ""
        }`}
      >
        <button
          className="pb-btn"
          onClick={togglePause}
          title={phase === "paused" ? "Play" : "Pause"}
          aria-label={phase === "paused" ? "Play" : "Pause"}
        >
          {phase === "paused" ? (
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
