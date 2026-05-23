/**
 * Generic-scene fallback: ScenePlan -> a deterministic render-module body.
 *
 * When live codegen fails or times out AND no hand-authored bundle genuinely
 * matches the query, the route renders THIS instead. It is built directly from
 * the real plan, so it is always ON-TOPIC: each phase becomes a titled kit
 * `node` card, laid out left-to-right and connected by `flowEdge`s, revealed
 * one beat at a time off a single self-driven clock, with the plan title and
 * `phaseDots`. It composes only kit primitives in the Mira house style, so it
 * never matches a bespoke scene for richness but is always coherent.
 *
 * The returned string is the BODY of `(container, libs) => () => void` — the
 * exact same contract codegen emits — so it passes looksRunnable/sanitizeCode
 * and runs via `new Function("container","libs",code)` in the render host.
 */
import type { ScenePlan } from "@/lib/types";

/** Escape a plan-derived string for safe embedding inside a JS string literal. */
function jsString(value: string): string {
  return JSON.stringify(value);
}

/** Short uppercase tag for a phase card's sublabel, derived from its id. */
function phaseTag(id: string, index: number): string {
  const cleaned = id.replace(/[^a-z0-9]+/gi, " ").trim();
  return (cleaned || `phase ${index + 1}`).slice(0, 18);
}

/**
 * A concise card title from the phase intent: first clause, capped, so the
 * label fits under the node without wrapping past the card.
 */
function phaseTitle(intent: string, index: number): string {
  const firstClause = intent.split(/[.;:]/)[0]?.trim() || intent.trim();
  const text = firstClause || `Step ${index + 1}`;
  return text.length > 42 ? `${text.slice(0, 41).trimEnd()}…` : text;
}

/**
 * Build the deterministic generic render-module body for a plan. Composes the
 * kit's node/flowEdge/label/phaseDots primitives in the Mira palette/easings.
 */
export function genericSceneCode(plan: ScenePlan): string {
  const phases = (plan.phases.length ? plan.phases : [
    { id: "main", intent: plan.title, renderer: "2d" as const, approxDurationMs: 5000 },
  ]).slice(0, 4);

  const nodes = phases.map((ph, i) => ({
    tag: phaseTag(ph.id, i),
    title: phaseTitle(ph.intent, i),
    ms: Math.max(2500, Math.min(9000, Math.round(ph.approxDurationMs))),
  }));

  // Serialize plan-derived data as literals so the body is fully self-contained
  // (no closure over plan), matching the codegen output contract.
  const nodesLiteral = JSON.stringify(nodes);
  const titleLiteral = jsString(plan.title || "Mira");

  return String.raw`const W = container.clientWidth || 1280, H = container.clientHeight || 720;
const kit = libs.kit;
const { ease, palette } = kit;
const VW = 1600, VH = 900;
const NODES = ${nodesLiteral};
const TITLE = ${titleLiteral};
const COUNT = NODES.length;
const PHASE_MS = 4200;

const sketch = (p) => {
  // Lay the phase cards out along a centered horizontal track.
  const trackY = VH * 0.54;
  const marginX = 240;
  const span = COUNT > 1 ? (VW - marginX * 2) : 0;
  const xs = NODES.map((_, i) => COUNT > 1 ? marginX + (span * i) / (COUNT - 1) : VW / 2);
  const R = COUNT >= 4 ? 78 : COUNT === 3 ? 92 : 104;
  const SERIES = [palette.accent, palette.teal, palette.terracotta, palette.blue];

  const trim = (x1, x2) => {
    const dir = x2 >= x1 ? 1 : -1;
    return { a: x1 + dir * (R + 4), b: x2 - dir * (R + 4) };
  };

  p.setup = () => {
    const c = p.createCanvas(W, H);
    c.style("display", "block");
    kit.useFonts(p);
  };

  p.draw = () => {
    const tSec = p.millis() / 1000;
    const elapsed = p.millis();
    const phase = Math.min(COUNT - 1, Math.floor(elapsed / PHASE_MS));
    const local = ease.outCubic(Math.min(1, (elapsed % PHASE_MS) / 1100));

    kit.grid(p);
    p.push();
    const s = Math.min(W / VW, H / VH);
    p.translate(W / 2 - (VW * s) / 2, H / 2 - (VH * s) / 2);
    p.scale(s);

    kit.label(p, { x: VW / 2, y: VH * 0.16, text: TITLE, size: 34, color: palette.fg, weight: "bold" });

    // Edges first, under the nodes. Each edge reveals with the beat it leads into.
    for (let i = 1; i < COUNT; i++) {
      if (phase < i) continue;
      const t = trim(xs[i - 1], xs[i]);
      const rev = i === phase ? local : 1;
      kit.flowEdge(p, { x1: t.a, y1: trackY, x2: t.b, y2: trackY, t: tSec, reveal: rev, color: SERIES[i % SERIES.length] });
    }

    // Phase cards, revealed cumulatively.
    for (let i = 0; i < COUNT; i++) {
      if (phase < i) continue;
      const isCurrent = i === phase;
      const reveal = isCurrent ? local : 1;
      const settle = Math.min(1, Math.max(0, (elapsed - i * PHASE_MS - 200) / 1500));
      const color = SERIES[i % SERIES.length];
      kit.node(p, { x: xs[i], y: trackY, r: R, sublabel: NODES[i].tag, value: String(i + 1), color, reveal, settle });
      kit.label(p, { x: xs[i], y: trackY + R + 30, text: NODES[i].title, size: 15, color: palette.fg, alpha: reveal });
    }
    p.pop();

    kit.phaseDots(p, { x: 28, y: H - 34, total: COUNT, current: phase, label: NODES[phase] ? NODES[phase].tag : "" });
  };
};

const inst = new libs.p5(sketch, container);
return () => inst.remove();`;
}
