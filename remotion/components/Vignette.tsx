import React from "react";
import { AbsoluteFill } from "remotion";

/** Soft cinematic vignette — darkens the edges, focuses the eye to center. */
export const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.62 }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(120% 120% at 50% 46%, transparent 38%, rgba(0,0,0,${
        strength * 0.5
      }) 78%, rgba(0,0,0,${strength}) 100%)`,
      pointerEvents: "none",
    }}
  />
);
