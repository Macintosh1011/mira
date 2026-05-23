"use client";

import { useEffect, useState } from "react";
import { CanvasGrid, PhaseIndicator, type CanvasProps } from "./CanvasShared";

/* Fed rate cut → mortgage market. Node-graph that evolves over 4 phases.
   Coordinates designed for a 1600x900 viewBox, centered around (800, 450). */

type NodeSize = "hero" | "lg" | "md" | "sm";

interface GraphNode {
  id: string;
  x: number;
  y: number;
  label: string;
  sub: string;
  valueFrom: string;
  valueTo: string;
  phase: number;
  size: NodeSize;
  delta?: "up";
}

const NODES: GraphNode[] = [
  { id: "fed", x: 800, y: 450, label: "Federal Reserve", sub: "Federal Funds Rate", valueFrom: "5.25%", valueTo: "4.75%", phase: 0, size: "hero" },

  { id: "tsy", x: 380, y: 250, label: "10-Yr Treasury", sub: "yield", valueFrom: "4.20%", valueTo: "3.95%", phase: 1, size: "md" },
  { id: "mbs", x: 380, y: 650, label: "MBS Spread", sub: "over 10Y", valueFrom: "+165bp", valueTo: "+150bp", phase: 1, size: "md" },

  { id: "mtg", x: 1220, y: 450, label: "30-Yr Mortgage", sub: "avg rate", valueFrom: "7.20%", valueTo: "6.55%", phase: 2, size: "lg" },

  { id: "refi", x: 1440, y: 240, label: "Refinance Apps", sub: "index", valueFrom: "112", valueTo: "184", phase: 3, size: "sm", delta: "up" },
  { id: "purch", x: 1440, y: 460, label: "Purchase Apps", sub: "index", valueFrom: "143", valueTo: "171", phase: 3, size: "sm", delta: "up" },
  { id: "price", x: 1440, y: 680, label: "Home Prices", sub: "m/m", valueFrom: "+0.1%", valueTo: "+0.4%", phase: 3, size: "sm", delta: "up" },
];

const EDGES: { from: string; to: string; phase: number }[] = [
  { from: "fed", to: "tsy", phase: 1 },
  { from: "fed", to: "mbs", phase: 1 },
  { from: "tsy", to: "mtg", phase: 2 },
  { from: "mbs", to: "mtg", phase: 2 },
  { from: "mtg", to: "refi", phase: 3 },
  { from: "mtg", to: "purch", phase: 3 },
  { from: "mtg", to: "price", phase: 3 },
];

function nodeById(id: string): GraphNode | undefined {
  return NODES.find((n) => n.id === id);
}

function sizeR(size: NodeSize): number {
  return size === "hero" ? 96 : size === "lg" ? 80 : size === "md" ? 64 : 54;
}

function Node({ node, visible }: { node: GraphNode; visible: boolean }) {
  const { x, y, label, sub, valueFrom, valueTo, size, delta } = node;
  const [showFinal, setShowFinal] = useState(false);

  useEffect(() => {
    if (!visible) return;
    // Hold the "before" value briefly, then cross-fade to "after".
    const t = setTimeout(() => setShowFinal(true), 700);
    return () => clearTimeout(t);
  }, [visible]);

  const valueText = showFinal ? valueTo : valueFrom;
  const ring = sizeR(size);
  const valueFontSize =
    size === "hero" ? 32 : size === "lg" ? 26 : size === "md" ? 20 : 18;
  const labelFontSize = size === "hero" ? 14 : 13;

  return (
    <g
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(0.92)",
        transformOrigin: `${x}px ${y}px`,
        transition:
          "opacity 600ms var(--ease-smooth), transform 600ms var(--ease-smooth)",
      }}
    >
      <circle
        cx={x}
        cy={y}
        r={ring}
        fill="none"
        stroke="rgba(239, 197, 64, 0.18)"
        strokeWidth={1}
        style={{
          opacity: showFinal ? 0.9 : 0.3,
          transition: "opacity 800ms var(--ease-smooth)",
        }}
      />
      <circle
        cx={x}
        cy={y}
        r={ring - 8}
        fill="rgba(20, 20, 24, 0.7)"
        stroke="rgba(255, 255, 255, 0.08)"
        strokeWidth={1}
      />
      <text
        x={x}
        y={y - valueFontSize / 2 - 6}
        textAnchor="middle"
        className="label-sub"
        fontSize={11}
        style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
      >
        {sub}
      </text>
      <text
        x={x}
        y={y + valueFontSize / 3}
        textAnchor="middle"
        fontSize={valueFontSize}
        fontWeight={500}
        fill="var(--accent)"
        fontFamily="var(--font-mono)"
        style={{
          letterSpacing: "-0.01em",
          transition: "fill 400ms var(--ease-default)",
        }}
      >
        {valueText}
      </text>
      {delta === "up" && showFinal && (
        <g style={{ opacity: 0.9 }}>
          <path
            d={`M ${x + 32} ${y + 4} l 6 -10 l 6 10 z`}
            fill="var(--accent)"
            style={{
              opacity: 0,
              animation: "fadeInUp 600ms var(--ease-smooth) forwards",
              animationDelay: "0.4s",
            }}
          />
        </g>
      )}
      <text
        x={x}
        y={y + ring + 22}
        textAnchor="middle"
        className="label-text"
        fontSize={labelFontSize}
      >
        {label}
      </text>
    </g>
  );
}

function Edge({
  from,
  to,
  visible,
}: {
  from: string;
  to: string;
  visible: boolean;
}) {
  const a = nodeById(from);
  const b = nodeById(to);
  if (!a || !b) return null;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / dist;
  const uy = dy / dist;
  const rA = sizeR(a.size) + 2;
  const rB = sizeR(b.size) + 2;
  const x1 = a.x + ux * rA;
  const y1 = a.y + uy * rA;
  const x2 = b.x - ux * rB;
  const y2 = b.y - uy * rB;
  const length = Math.max(1, dist - rA - rB);

  return (
    <g
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 400ms var(--ease-default)",
      }}
    >
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="rgba(255,255,255,0.10)"
        strokeWidth={1}
      />
      {visible && (
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="var(--accent)"
          strokeWidth={1.5}
          strokeOpacity={0.5}
          strokeDasharray={`4 ${length / 4}`}
          style={{ animation: "dashFlow 2.4s linear infinite" }}
        />
      )}
    </g>
  );
}

export default function FedCanvas({ phase, dimmed }: CanvasProps) {
  return (
    <div className={`canvas-wrap show ${dimmed ? "dimmed" : ""}`}>
      <svg
        className="canvas-svg"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id="fedFalloff" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="rgba(239, 197, 64, 0.04)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>
        <rect width={1600} height={900} fill="url(#fedFalloff)" />
        <CanvasGrid />

        {EDGES.map((e) => (
          <Edge
            key={`${e.from}-${e.to}`}
            from={e.from}
            to={e.to}
            visible={phase >= e.phase}
          />
        ))}
        {NODES.map((n) => (
          <Node key={n.id} node={n} visible={phase >= n.phase} />
        ))}
      </svg>
      <PhaseIndicator
        phase={phase}
        total={4}
        labels={["policy rate", "bond market", "mortgage rate", "demand"]}
      />
    </div>
  );
}
