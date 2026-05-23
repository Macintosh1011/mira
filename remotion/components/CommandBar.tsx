import React from "react";
import { C, FONT, rgb } from "../theme";

/**
 * The Mira command palette — frosted glass, mic, transcribing query, breathing
 * caret. Used for the opening prompt and the live "interrupt" in the NN scene.
 */
export const CommandBar: React.FC<{
  text: string;
  reveal: number; // 0..1 fraction of text shown (transcription)
  caret: number; // 0..1 caret opacity
  micPulse: number; // 0..1 ring intensity
  armed: number; // 0..1 submit-armed glow
  width?: number;
}> = ({ text, reveal, caret, micPulse, armed, width = 720 }) => {
  const shown = text.slice(0, Math.round(text.length * reveal));
  const accent = rgb(C.accent);
  return (
    <div
      style={{
        width,
        borderRadius: 18,
        background: "rgba(18,18,22,0.62)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        border: `1px solid rgba(255,255,255,${0.08 + armed * 0.5})`,
        boxShadow: `0 32px 90px -20px rgba(0,0,0,0.85), 0 0 ${
          20 + armed * 40
        }px ${rgb(C.accent, armed * 0.35)}, inset 0 0 0 1px rgba(255,255,255,0.04)`,
        display: "flex",
        alignItems: "center",
        gap: 18,
        height: 76,
        padding: "0 26px",
      }}
    >
      {/* mic */}
      <div style={{ position: "relative", width: 34, height: 34, flexShrink: 0 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: `2px solid ${accent}`,
            opacity: 0.6 * micPulse,
            transform: `scale(${1 + micPulse * 0.9})`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: accent,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" stroke="none" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <line x1="12" y1="18" x2="12" y2="21" />
          </svg>
        </div>
      </div>

      {/* query text + caret */}
      <div
        style={{
          flex: 1,
          fontFamily: FONT.mono,
          fontSize: 22,
          color: rgb(C.fg),
          letterSpacing: "-0.01em",
          whiteSpace: "nowrap",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
        }}
      >
        <span>{shown}</span>
        <span
          style={{
            display: "inline-block",
            width: 2,
            height: 26,
            marginLeft: 3,
            background: accent,
            opacity: caret,
          }}
        />
      </div>

      {/* submit cue */}
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 7,
          border: `1px solid ${armed > 0.5 ? accent : "rgba(255,255,255,0.16)"}`,
          color: armed > 0.5 ? accent : rgb(C.fgSubtle),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FONT.mono,
          fontSize: 15,
          flexShrink: 0,
        }}
      >
        ↵
      </div>
    </div>
  );
};
