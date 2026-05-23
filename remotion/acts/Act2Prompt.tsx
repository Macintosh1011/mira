import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { CommandBar } from "../components/CommandBar";
import { C, FONT, FPS, rgb } from "../theme";
import { clamp, ramp, easeOutCubic } from "../lib/draw";

const PROMPT_START = 6.8; // global; matches ACTS.prompt.start
const QUERY = "show me how a neural network recognizes a handwritten 7";

export const Act2Prompt: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS;

  const u2Local = 7.9 - PROMPT_START; // ~1.1
  const intro = easeOutCubic(ramp(t, 0.0, 0.9));
  const reveal = ramp(t, u2Local, u2Local + 3.7);
  const caret = 0.35 + 0.65 * Math.abs(Math.sin(t * 4));
  const mic = Math.abs(Math.sin(t * 3.2));
  const armed = clamp((reveal - 0.92) / 0.08);
  const submit = Math.max(0, 1 - Math.abs(t - (u2Local + 3.9)) / 0.2);

  return (
    <AbsoluteFill style={{ background: rgb(C.bg) }}>
      {/* bottom amber horizon */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(80% 40% at 50% 116%, ${rgb(C.accent, 0.16 * intro)}, transparent 70%)`,
        }}
      />

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
        <div
          style={{
            fontFamily: FONT.display, fontWeight: 300, fontSize: 92,
            letterSpacing: "-0.03em", color: rgb(C.fg, 0.96 * intro),
            opacity: intro, transform: `translateY(${(1 - intro) * 18}px)`, marginBottom: 18,
          }}
        >
          Mira
        </div>
        <div
          style={{
            fontFamily: FONT.sans, fontSize: 19, color: rgb(C.fgMuted, intro),
            marginBottom: 56, opacity: interpolate(t, [0.3, 1.0], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          The visualization layer for thinking
        </div>

        <div style={{ opacity: intro, transform: `translateY(${(1 - intro) * 24}px) scale(${1 + submit * 0.012})` }}>
          <CommandBar text={QUERY} reveal={reveal} caret={caret} micPulse={mic} armed={armed} width={860} />
        </div>

        <div
          style={{
            marginTop: 30, display: "flex", gap: 18, fontFamily: FONT.mono, fontSize: 13,
            color: rgb(C.fgSubtle, intro * 0.9), letterSpacing: "0.02em",
            opacity: interpolate(t, [0.6, 1.2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          <span>🎙 listening</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>⏎ to generate</span>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ background: rgb(C.fg, submit * 0.12), pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};
