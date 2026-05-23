"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import RenderHost, { type RenderStatus } from "@/lib/render/RenderHost";
import { Narrator, isTTSSupported } from "@/lib/voice/tts";
import type { NarrationCue, Renderer } from "@/lib/types";
import {
  IconPlay,
  IconPause,
  IconReplay,
  IconVolume,
  IconMute,
} from "./icons";
import Captions from "./Captions";

interface SceneStageProps {
  title: string;
  code: string | null;
  renderer: Renderer;
  narration: NarrationCue[];
  /** Changes whenever a fresh scene lands — drives a clean remount + reset. */
  renderRev: number;
}

/**
 * The render surface + paused-by-default playback controls. Owns the Narrator
 * clock that schedules TTS against playback; pause halts both the scene and
 * the voice, play/replay restart from the top.
 */
export default function SceneStage({
  title,
  code,
  renderer,
  narration,
  renderRev,
}: SceneStageProps) {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [tempo, setTempo] = useState(1);
  const [progress, setProgress] = useState(0); // 0..1 across narration span
  const [activeCue, setActiveCue] = useState(-1);
  const [status, setStatus] = useState<RenderStatus>("loading");

  const narratorRef = useRef<Narrator | null>(null);
  const ttsOk = isTTSSupported();

  // total narrated span, used to drive the progress bar
  const spanMs = useMemo(() => {
    if (narration.length === 0) return 0;
    const last = narration[narration.length - 1];
    return last.startMs + 6000; // pad past the final cue's start
  }, [narration]);

  // Build the narrator once on mount. The parent keys this component on
  // renderRev, so a new scene remounts with fresh playback state — no resets.
  useEffect(() => {
    const n = new Narrator();
    n.setCues(narration);
    n.setOnCue((i) => setActiveCue(i));
    narratorRef.current = n;
    return () => n.dispose();
    // narration is stable for a mounted scene's lifetime (set from the done bundle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // tempo → narrator clock + TTS rate
  useEffect(() => {
    narratorRef.current?.setRate(tempo);
  }, [tempo]);

  // progress ticker while playing
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const n = narratorRef.current;
      if (n && spanMs > 0) {
        const p = Math.min(n.elapsedMs / spanMs, 1);
        setProgress(p);
        if (p >= 1) {
          setPlaying(false);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, spanMs]);

  const handlePlayPause = () => {
    const n = narratorRef.current;
    if (!n) return;
    if (playing) {
      n.pause();
      setPlaying(false);
    } else {
      if (progress >= 1) {
        n.reset();
        setProgress(0);
        setActiveCue(-1);
      }
      n.setMuted(muted);
      n.start();
      setPlaying(true);
    }
  };

  const handleReplay = () => {
    const n = narratorRef.current;
    if (!n) return;
    n.reset();
    setProgress(0);
    setActiveCue(-1);
    n.setMuted(muted);
    n.start();
    setPlaying(true);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    narratorRef.current?.setMuted(next);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4">
      {/* stage — explicit min height so the render surface never collapses
          regardless of the flex-height chain above it */}
      <div className="relative min-h-[48vh] flex-1 overflow-hidden rounded-2xl border border-[var(--hairline-strong)] bg-[var(--paper-raised)] sm:min-h-[42vh]">
        {/* render surface — remounts cleanly on renderRev */}
        <RenderHost
          key={renderRev}
          code={code}
          remountKey={renderRev}
          playing={playing}
          onStatusChange={setStatus}
        />

        {/* poster / paused overlay */}
        {!playing && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-gradient-to-t from-black/55 via-transparent to-transparent">
            <button
              onClick={handlePlayPause}
              className="glass-raised group grid h-20 w-20 place-items-center rounded-full text-ink transition-transform hover:scale-105 active:scale-95"
              aria-label="Play scene"
            >
              <IconPlay className="ml-1 h-8 w-8" />
            </button>
          </div>
        )}

        {/* top bar: title + status */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <span className="label">
              {renderer === "3d" ? "3D Scene" : "2D Scene"}
            </span>
            <h2 className="mt-1 max-w-[90%] truncate font-serif text-xl leading-tight text-ink drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)] sm:text-2xl">
              {title}
            </h2>
          </div>
          <StatusBadge status={status} />
        </div>
      </div>

      {/* controls */}
      <div className="glass flex items-center gap-3 rounded-2xl px-4 py-3">
        <button
          onClick={handlePlayPause}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-coral text-paper transition-transform hover:scale-105 active:scale-95"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <IconPause /> : <IconPlay className="ml-0.5" />}
        </button>

        <button
          onClick={handleReplay}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-dim transition-colors hover:bg-white/5 hover:text-ink"
          aria-label="Replay from start"
        >
          <IconReplay />
        </button>

        {/* progress / scrub display */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-coral to-amber transition-[width] duration-100"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-faint">
            {Math.round(progress * 100)}%
          </span>
        </div>

        {/* tempo — power control, hidden on the cramped mobile bar */}
        <label
          className="hidden shrink-0 items-center gap-2 sm:flex"
          title="Playback tempo"
        >
          <span className="label">Tempo</span>
          <input
            type="range"
            min={0.5}
            max={1.5}
            step={0.1}
            value={tempo}
            onChange={(e) => setTempo(Number(e.target.value))}
            className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-white/10 accent-[var(--amber)]"
            aria-label="Tempo"
          />
          <span className="w-8 font-mono text-[11px] tabular-nums text-ink-dim">
            {tempo.toFixed(1)}×
          </span>
        </label>

        {/* mute */}
        <button
          onClick={toggleMute}
          disabled={!ttsOk}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-dim transition-colors hover:bg-white/5 hover:text-ink disabled:opacity-30"
          aria-label={muted ? "Unmute narration" : "Mute narration"}
          aria-pressed={muted}
        >
          {muted || !ttsOk ? <IconMute /> : <IconVolume />}
        </button>
      </div>

      {/* captions */}
      {narration.length > 0 && (
        <div className="px-1">
          <Captions cues={narration} activeIndex={activeCue} />
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: RenderStatus }) {
  const map = {
    loading: { dot: "var(--ink-faint)", label: "Paused" },
    live: { dot: "var(--c-green)", label: "Live" },
    fallback: { dot: "var(--amber)", label: "Ambient" },
  } as const;
  const s = map[status];
  return (
    <span className="glass pointer-events-none flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: s.dot }}
      />
      <span className="label !text-[9px]">{s.label}</span>
    </span>
  );
}
