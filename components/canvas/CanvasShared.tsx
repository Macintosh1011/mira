"use client";

/** Shared SVG primitives for hand-authored topics: background grid + the
 *  bottom-left phase indicator. Both reference topics compose these. */

export function CanvasGrid() {
  const lines: React.ReactNode[] = [];
  for (let i = 0; i <= 16; i++) {
    lines.push(
      <line
        key={`v${i}`}
        x1={i * 100}
        y1={0}
        x2={i * 100}
        y2={900}
        stroke="rgba(255,255,255,0.02)"
        strokeWidth={1}
      />,
    );
  }
  for (let i = 0; i <= 9; i++) {
    lines.push(
      <line
        key={`h${i}`}
        x1={0}
        y1={i * 100}
        x2={1600}
        y2={i * 100}
        stroke="rgba(255,255,255,0.02)"
        strokeWidth={1}
      />,
    );
  }
  return <g>{lines}</g>;
}

export function PhaseIndicator({
  phase,
  total = 4,
  labels,
}: {
  phase: number;
  total?: number;
  labels: string[];
}) {
  const clamped = Math.max(0, phase);
  return (
    <div
      style={{
        position: "absolute",
        bottom: 28,
        left: 28,
        display: "flex",
        gap: 8,
        alignItems: "center",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--fg-subtle)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
      }}
    >
      <span style={{ display: "flex", gap: 4 }}>
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            style={{
              width: 16,
              height: 2,
              borderRadius: 1,
              background:
                i <= clamped ? "var(--accent)" : "rgba(255,255,255,0.12)",
              transition: "background 400ms var(--ease-default)",
            }}
          />
        ))}
      </span>
      <span style={{ marginLeft: 8 }}>
        {labels[clamped] ?? `phase ${clamped + 1} / ${total}`}
      </span>
    </div>
  );
}

export interface CanvasProps {
  /** -1 = nothing visible yet; 0..N-1 cumulative reveal. */
  phase: number;
  dimmed: boolean;
}
