import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { Canvas } from "../components/Canvas";
import { CommandBar } from "../components/CommandBar";
import { C, FONT, FPS, rgb } from "../theme";
import { drawNeural, type NeuralParams } from "../lib/neural-draw";
import { cue } from "../timeline";
import { clamp, eramp, ramp, easeInOutCubic, easeOutCubic } from "../lib/draw";

const MAGIC_START = 12.4; // global sec; local = global - MAGIC_START

export const NeuralScene: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS; // local seconds

  const params: NeuralParams = {
    t,
    a7: ramp(t, 0.1, 1.3),
    pix: eramp(t, 1.3, 2.9),
    edges: eramp(t, 3.3, 4.5),
    h1: eramp(t, 5.0, 6.9),
    h2: eramp(t, 9.6, 11.5),
    latent: eramp(t, 10.2, 12.8),
    outl: eramp(t, 13.4, 15.3),
    lock: eramp(t, 14.4, 16.9),
    ghost: eramp(t, 9.0, 12.2),
    morph: eramp(t, 20.6, 30.5, easeInOutCubic),
    interrupt: 0,
  };

  // live interrupt command bar (u4)
  const u4 = cue("u4");
  const localStart = u4.startSec - MAGIC_START; // ~18.8
  const barIn = ramp(t, localStart - 0.3, localStart + 0.3);
  const barOut = ramp(t, localStart + 3.0, localStart + 3.7);
  const barVis = barIn * (1 - barOut);
  params.interrupt = barVis;
  const reveal = ramp(t, localStart + 0.1, localStart + 2.4);
  const barY = interpolate(easeOutCubic(barIn), [0, 1], [-140, 70]) -
    easeOutCubic(barOut) * 200;
  const submitFlash = Math.max(0, 1 - Math.abs(t - (localStart + 2.9)) / 0.18);

  // softmax equation chip + LIVE badge fade with the output layer
  const chip = params.outl;

  return (
    <AbsoluteFill style={{ background: rgb(C.bg) }}>
      <Canvas draw={(ctx, info) => drawNeural(ctx, info, params)} />

      {/* diegetic chrome */}
      <div
        style={{
          position: "absolute", top: 34, left: 40, display: "flex", alignItems: "center", gap: 10,
          fontFamily: FONT.mono, fontSize: 13, letterSpacing: "0.14em",
          color: rgb(C.fgMuted, 0.9), textTransform: "uppercase",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 8, background: rgb(C.accent), boxShadow: `0 0 12px ${rgb(C.accent, 0.8)}` }} />
        live · neural-net
      </div>

      <div
        style={{
          position: "absolute", top: 30, left: "50%", transform: "translateX(-50%)",
          opacity: chip * 0.92, padding: "9px 18px", borderRadius: 11,
          background: "rgba(18,18,22,0.66)", border: "1px solid rgba(255,255,255,0.08)",
          fontFamily: FONT.mono, fontSize: 17, color: rgb(C.fg), whiteSpace: "nowrap",
        }}
      >
        σ(z)<sub style={{ fontSize: 11 }}>i</sub> = e<sup style={{ fontSize: 11 }}>z<sub>i</sub>/T</sup> / Σ<sub style={{ fontSize: 11 }}>j</sub> e<sup style={{ fontSize: 11 }}>z<sub>j</sub>/T</sup>
      </div>

      {/* live interrupt */}
      {barVis > 0.01 && (
        <div
          style={{
            position: "absolute", top: barY, left: "50%",
            transform: "translateX(-50%)", opacity: clamp(barVis * 1.4),
          }}
        >
          <CommandBar
            text={u4.text.replace("...", "…")}
            reveal={reveal}
            caret={0.4 + 0.6 * Math.abs(Math.sin(t * 4))}
            micPulse={Math.abs(Math.sin(t * 3.4))}
            armed={clamp((reveal - 0.9) / 0.1)}
            width={760}
          />
        </div>
      )}

      {/* submit flash / morph kiss */}
      <AbsoluteFill style={{ background: rgb(C.fg, submitFlash * 0.1), pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};
