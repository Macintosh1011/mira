"use client";

import { useEffect, useState } from "react";
import { CanvasGrid, PhaseIndicator, type CanvasProps } from "./CanvasShared";

/* Neural network classifier. 4 phases:
   0: input pixels (an 8x8 stylized "7")
   1: first hidden layer activates (edge detectors)
   2: second hidden layer activates (compositions)
   3: output layer, "7" wins */

const DIGIT_7: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 0, 0, 0, 0, 1, 1, 0],
  [0, 0, 0, 0, 1, 1, 0, 0],
  [0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

interface Neuron {
  x: number;
  y: number;
  idx: number;
  label?: string;
}

const NN_LAYOUT = (() => {
  const gridCell = 28;
  const gridSize = 8;
  const gridW = gridCell * gridSize; // 224
  const gridCx = 260;
  const gridCy = 450;
  const gridX0 = gridCx - gridW / 2;
  const gridY0 = gridCy - gridW / 2;

  const xH1 = 700;
  const xH2 = 980;
  const xOut = 1300;

  const yRange: [number, number] = [150, 750];
  const ys = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      n === 1
        ? (yRange[0] + yRange[1]) / 2
        : yRange[0] + (i * (yRange[1] - yRange[0])) / (n - 1),
    );

  return {
    grid: {
      x: gridX0,
      y: gridY0,
      cell: gridCell,
      size: gridSize,
      cx: gridCx,
      cy: gridCy,
      w: gridW,
    },
    h1: ys(10).map((y, i): Neuron => ({ x: xH1, y, idx: i })),
    h2: ys(8).map((y, i): Neuron => ({ x: xH2, y, idx: i })),
    out: ys(10).map((y, i): Neuron => ({ x: xOut, y, idx: i, label: String(i) })),
  };
})();

const NN_ACTIVE = {
  h1: [1, 3, 4, 7],
  h2: [0, 2, 5],
  out: { winner: 7, secondary: [1, 9] },
};

const NN_SIGNAL_EDGES = {
  h1: [1, 3, 4, 7], // target h1 indices (source = input grid)
  h2: [
    [1, 0],
    [3, 0],
    [4, 2],
    [7, 5],
  ],
  out: [
    [0, 7],
    [2, 7],
    [5, 7],
  ],
};

function NNInputGrid({ visible }: { visible: boolean }) {
  const { x, y, cell, size } = NN_LAYOUT.grid;
  const [reveal, setReveal] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let i = 0;
    let onCount = 0;
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++) if (DIGIT_7[r][c]) onCount++;
    const id = setInterval(() => {
      i++;
      setReveal(i);
      if (i >= onCount) clearInterval(id);
    }, 60);
    return () => clearInterval(id);
  }, [visible, size]);

  const cells: React.ReactNode[] = [];
  let onIdx = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const on = DIGIT_7[r][c] === 1;
      const revealed = on ? onIdx++ < reveal : false;
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={x + c * cell + 1}
          y={y + r * cell + 1}
          width={cell - 2}
          height={cell - 2}
          rx={3}
          fill={
            on
              ? revealed
                ? "var(--accent)"
                : "rgba(239,197,64,0.0)"
              : "rgba(255,255,255,0.025)"
          }
          stroke={on ? "rgba(239,197,64,0.5)" : "rgba(255,255,255,0.06)"}
          strokeWidth={1}
          style={{
            transition:
              "fill 280ms var(--ease-default), stroke 280ms var(--ease-default)",
            filter:
              on && revealed
                ? "drop-shadow(0 0 4px rgba(239,197,64,0.5))"
                : "none",
          }}
        />,
      );
    }
  }

  return (
    <g
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(0.94)",
        transformOrigin: `${NN_LAYOUT.grid.cx}px ${NN_LAYOUT.grid.cy}px`,
        transition:
          "opacity 500ms var(--ease-smooth), transform 500ms var(--ease-smooth)",
      }}
    >
      <rect
        x={x - 8}
        y={y - 8}
        width={NN_LAYOUT.grid.w + 16}
        height={NN_LAYOUT.grid.w + 16}
        rx={12}
        fill="rgba(20,20,24,0.5)"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1}
      />
      {cells}
      <text
        x={NN_LAYOUT.grid.cx}
        y={y + NN_LAYOUT.grid.w + 38}
        textAnchor="middle"
        className="label-text"
      >
        Input · 8×8 pixels
      </text>
      <text
        x={NN_LAYOUT.grid.cx}
        y={y - 18}
        textAnchor="middle"
        className="label-sub"
        style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
      >
        x ∈ ℝ⁶⁴
      </text>
    </g>
  );
}

function NNNeuron({
  x,
  y,
  r = 12,
  active,
  settled,
  label,
  winner,
  confidence,
}: {
  x: number;
  y: number;
  r?: number;
  active?: boolean;
  settled?: boolean;
  label?: string;
  winner?: boolean;
  confidence?: number | null;
}) {
  return (
    <g style={{ transition: "opacity 400ms var(--ease-default)" }}>
      <circle
        cx={x}
        cy={y}
        r={r}
        fill={
          winner
            ? "var(--accent)"
            : active
              ? "var(--accent)"
              : settled
                ? "rgba(161,161,170,0.55)"
                : "rgba(255,255,255,0.05)"
        }
        stroke={
          winner
            ? "var(--accent)"
            : active
              ? "var(--accent)"
              : "rgba(255,255,255,0.18)"
        }
        strokeWidth={winner ? 2 : 1}
        style={{
          filter:
            winner || active
              ? "drop-shadow(0 0 8px rgba(239,197,64,0.55))"
              : "none",
          transition:
            "fill 400ms var(--ease-default), stroke 400ms var(--ease-default), filter 400ms var(--ease-default)",
        }}
      />
      {label != null && (
        <text
          x={x + r + 12}
          y={y + 4}
          fontFamily="var(--font-sans)"
          fontSize={13}
          fontWeight={500}
          style={{
            fill: winner
              ? "var(--accent)"
              : active || settled
                ? "var(--fg)"
                : "var(--fg-muted)",
            transition: "fill 400ms var(--ease-default)",
            letterSpacing: "-0.01em",
          }}
        >
          {label}
        </text>
      )}
      {winner && confidence != null && (
        <g>
          <rect
            x={x + r + 38}
            y={y - 7}
            width={80}
            height={4}
            rx={2}
            fill="rgba(255,255,255,0.08)"
          />
          <rect
            x={x + r + 38}
            y={y - 7}
            width={80 * confidence}
            height={4}
            rx={2}
            fill="var(--accent)"
            style={{ transition: "width 600ms var(--ease-smooth)" }}
          />
          <text
            x={x + r + 38 + 88}
            y={y + 4}
            className="label-sub"
            fontFamily="var(--font-mono)"
            fontSize={11}
            fill="var(--accent)"
          >
            {(confidence * 100).toFixed(1)}%
          </text>
        </g>
      )}
    </g>
  );
}

function NNEdges({
  fromLayer,
  toLayer,
  signalEdges = [],
  visible,
  signalActive,
}: {
  fromLayer: Neuron[];
  toLayer: Neuron[];
  signalEdges?: number[][];
  visible: boolean;
  signalActive: boolean;
}) {
  const lines: React.ReactNode[] = [];
  for (let i = 0; i < fromLayer.length; i++) {
    for (let j = 0; j < toLayer.length; j++) {
      lines.push(
        <line
          key={`b-${i}-${j}`}
          x1={fromLayer[i].x + 12}
          y1={fromLayer[i].y}
          x2={toLayer[j].x - 12}
          y2={toLayer[j].y}
          stroke="rgba(255,255,255,0.05)"
          strokeWidth={1}
        />,
      );
    }
  }
  if (signalActive) {
    signalEdges.forEach(([si, ti], k) => {
      const a = fromLayer[si];
      const b = toLayer[ti];
      if (!a || !b) return;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      lines.push(
        <line
          key={`s-${k}`}
          x1={a.x + 12}
          y1={a.y}
          x2={b.x - 12}
          y2={b.y}
          stroke="var(--accent)"
          strokeWidth={1.5}
          strokeOpacity={0.7}
          strokeDasharray={`4 ${dist / 5}`}
          style={{ animation: "dashFlow 2.0s linear infinite" }}
        />,
      );
    });
  }
  return (
    <g
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 400ms var(--ease-default)",
      }}
    >
      {lines}
    </g>
  );
}

function NNInputEdges({
  visible,
  signalActive,
}: {
  visible: boolean;
  signalActive: boolean;
}) {
  const fromX = NN_LAYOUT.grid.x + NN_LAYOUT.grid.w;
  const fromY = NN_LAYOUT.grid.cy;
  const base: React.ReactNode[] = [];
  NN_LAYOUT.h1.forEach((n, j) => {
    base.push(
      <line
        key={`b-${j}`}
        x1={fromX + 6}
        y1={fromY}
        x2={n.x - 12}
        y2={n.y}
        stroke="rgba(255,255,255,0.05)"
        strokeWidth={1}
      />,
    );
  });
  const signal: React.ReactNode[] = [];
  if (signalActive) {
    NN_SIGNAL_EDGES.h1.forEach((ti, k) => {
      const n = NN_LAYOUT.h1[ti];
      const dist = Math.hypot(n.x - fromX, n.y - fromY);
      signal.push(
        <line
          key={`s-${k}`}
          x1={fromX + 6}
          y1={fromY}
          x2={n.x - 12}
          y2={n.y}
          stroke="var(--accent)"
          strokeWidth={1.5}
          strokeOpacity={0.7}
          strokeDasharray={`4 ${dist / 5}`}
          style={{ animation: "dashFlow 2.0s linear infinite" }}
        />,
      );
    });
  }
  return (
    <g
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 400ms var(--ease-default)",
      }}
    >
      {base}
      {signal}
    </g>
  );
}

function NNLayerLabel({
  x,
  y,
  title,
  sub,
}: {
  x: number;
  y: number;
  title: string;
  sub: string;
}) {
  return (
    <g>
      <text x={x} y={y} textAnchor="middle" className="label-text" fontSize={13}>
        {title}
      </text>
      <text
        x={x}
        y={y + 18}
        textAnchor="middle"
        className="label-sub"
        fontSize={11}
        style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
      >
        {sub}
      </text>
    </g>
  );
}

export default function NNCanvas({ phase, dimmed }: CanvasProps) {
  const showInput = phase >= 0;
  const showH1 = phase >= 1;
  const showH2 = phase >= 2;
  const showOut = phase >= 3;

  const [conf, setConf] = useState(0);
  useEffect(() => {
    if (phase < 3) return;
    const t = setTimeout(() => setConf(0.942), 350);
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <div className={`canvas-wrap show ${dimmed ? "dimmed" : ""}`}>
      <svg
        className="canvas-svg"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id="nnFalloff" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="rgba(239, 197, 64, 0.04)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>
        <rect width={1600} height={900} fill="url(#nnFalloff)" />
        <CanvasGrid />

        <NNInputEdges visible={showH1} signalActive={phase >= 1} />
        <NNEdges
          fromLayer={NN_LAYOUT.h1}
          toLayer={NN_LAYOUT.h2}
          signalEdges={NN_SIGNAL_EDGES.h2}
          visible={showH2}
          signalActive={phase >= 2}
        />
        <NNEdges
          fromLayer={NN_LAYOUT.h2}
          toLayer={NN_LAYOUT.out}
          signalEdges={NN_SIGNAL_EDGES.out}
          visible={showOut}
          signalActive={phase === 3}
        />

        <NNInputGrid visible={showInput} />

        <g
          style={{
            opacity: showH1 ? 1 : 0,
            transition: "opacity 500ms var(--ease-smooth)",
          }}
        >
          {NN_LAYOUT.h1.map((n) => (
            <NNNeuron
              key={`h1-${n.idx}`}
              x={n.x}
              y={n.y}
              r={11}
              active={phase === 1 && NN_ACTIVE.h1.includes(n.idx)}
              settled={phase > 1 && NN_ACTIVE.h1.includes(n.idx)}
            />
          ))}
          <NNLayerLabel
            x={NN_LAYOUT.h1[0].x}
            y={110}
            title="Hidden Layer 1"
            sub="edge detectors"
          />
        </g>

        <g
          style={{
            opacity: showH2 ? 1 : 0,
            transition: "opacity 500ms var(--ease-smooth)",
          }}
        >
          {NN_LAYOUT.h2.map((n) => (
            <NNNeuron
              key={`h2-${n.idx}`}
              x={n.x}
              y={n.y}
              r={11}
              active={phase === 2 && NN_ACTIVE.h2.includes(n.idx)}
              settled={phase > 2 && NN_ACTIVE.h2.includes(n.idx)}
            />
          ))}
          <NNLayerLabel
            x={NN_LAYOUT.h2[0].x}
            y={110}
            title="Hidden Layer 2"
            sub="shape composition"
          />
        </g>

        <g
          style={{
            opacity: showOut ? 1 : 0,
            transition: "opacity 500ms var(--ease-smooth)",
          }}
        >
          {NN_LAYOUT.out.map((n) => {
            const isWinner = n.idx === NN_ACTIVE.out.winner;
            const isSecondary = NN_ACTIVE.out.secondary.includes(n.idx);
            return (
              <NNNeuron
                key={`out-${n.idx}`}
                x={n.x}
                y={n.y}
                r={10}
                label={n.label}
                active={false}
                settled={isSecondary}
                winner={isWinner && phase >= 3}
                confidence={isWinner ? conf : null}
              />
            );
          })}
          <NNLayerLabel
            x={NN_LAYOUT.out[0].x}
            y={110}
            title="Output"
            sub="softmax · 10 classes"
          />
        </g>
      </svg>
      <PhaseIndicator
        phase={phase}
        total={4}
        labels={["input pixels", "hidden layer 1", "hidden layer 2", "classify"]}
      />
    </div>
  );
}
