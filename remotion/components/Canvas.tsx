import React, { useEffect, useRef } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

export interface DrawCtx {
  frame: number;
  /** seconds since composition start */
  t: number;
  width: number;
  height: number;
  fps: number;
}

/**
 * A canvas painted deterministically from the current frame. `draw` runs once
 * per frame in a layout effect (before Remotion captures), so the pixels are
 * a pure function of the frame — fully scrubbable and reproducible.
 */
export const Canvas: React.FC<{
  draw: (ctx: CanvasRenderingContext2D, info: DrawCtx) => void;
  style?: React.CSSProperties;
}> = ({ draw, style }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    draw(ctx, { frame, t: frame / fps, width, height, fps });
  });

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", ...style }}
    />
  );
};
