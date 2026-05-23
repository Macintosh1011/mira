"use client";

import { useEffect, useRef, useState } from "react";
import type { ControlSpec } from "@/lib/types";

interface SceneControlsProps {
  /** The active sim's tunable knobs. One slider per spec. */
  controls: ControlSpec[];
  /** Current values keyed by ControlSpec.key (the source of truth lives above). */
  values: Record<string, number>;
  /** Fired on every slider input with the changed key + value. */
  onChange: (key: string, value: number) => void;
  /** Optional KaTeX-rendered equation HTML to show above the sliders. */
  equationHtml?: string | null;
  /** Auto-reveal on cursor move, like the playback controls. */
  visible: boolean;
}

const ACCENT = "#efc540";

/** Trim trailing zeros from a stepped readout (3.50 -> 3.5, 4.00 -> 4). */
function fmt(value: number, step: number): string {
  const decimals = (String(step).split(".")[1] || "").length;
  const fixed = value.toFixed(decimals);
  return decimals > 0 ? fixed.replace(/\.?0+$/, "") : fixed;
}

/**
 * Floating slider panel for the interactive-sim stage. Frosted glass, mono
 * labels, accent-filled tracks on tinted black — the Mira read of the design
 * handoff's tweaks panel. One slider per `sim.controls`; each input calls back
 * through to the host's setParam. Mounts only while a sim is playing/paused.
 */
export default function SceneControls({
  controls,
  values,
  onChange,
  equationHtml,
  visible,
}: SceneControlsProps) {
  // Reveal mirrors the playback controls (fade in on activity, out after idle),
  // but stay pinned while the user is actually dragging a slider.
  const [interacting, setInteracting] = useState(false);
  const eqRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = eqRef.current;
    if (el) el.innerHTML = equationHtml ?? "";
  }, [equationHtml]);

  if (controls.length === 0) return null;

  const show = visible || interacting;

  return (
    <div className={`scene-controls ${show ? "show" : ""}`}>
      <div className="sc-hd">
        <span className="sc-title">Parameters</span>
        <span className="sc-dot" />
      </div>

      {equationHtml && <div className="sc-eq" ref={eqRef} aria-hidden />}

      <div className="sc-body">
        {controls.map((ctrl) => {
          const value = values[ctrl.key] ?? ctrl.default;
          const pct = ((value - ctrl.min) / (ctrl.max - ctrl.min)) * 100;
          const fill = `linear-gradient(to right, ${ACCENT} 0%, ${ACCENT} ${pct}%, rgba(255,255,255,0.1) ${pct}%, rgba(255,255,255,0.1) 100%)`;
          return (
            <div className="sc-row" key={ctrl.key}>
              <div className="sc-lbl">
                <span className="sc-key">{ctrl.label}</span>
                <span className="sc-val">
                  {fmt(value, ctrl.step)}
                  {ctrl.unit ? <span className="sc-unit">{ctrl.unit}</span> : null}
                </span>
              </div>
              <input
                type="range"
                className="sc-slider"
                min={ctrl.min}
                max={ctrl.max}
                step={ctrl.step}
                value={value}
                style={{ background: fill }}
                onPointerDown={() => setInteracting(true)}
                onPointerUp={() => setInteracting(false)}
                onChange={(e) => onChange(ctrl.key, Number(e.target.value))}
                aria-label={ctrl.label}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
