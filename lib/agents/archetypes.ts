/**
 * Hand-tuned scene ARCHETYPES — the reliability-over-novelty engine.
 *
 * Instead of asking the model to write good animation code (which usually fails
 * looksRunnable and falls back to a weak generic scene), the orchestrator picks
 * one of these beautiful, kit-composed renderers by `sceneType` and FILLS it
 * with the query's structured per-phase content. The aesthetic lives here and in
 * the kit, at the same quality bar as the hand-authored Fed / NN scenes.
 *
 * Each archetype is a function that bakes the plan's content into the BODY of a
 * render module — `(container, libs) => SceneController` per lib/types.ts. The
 * body keeps a `phase` closure variable that the render host drives via
 * `setPhase(phaseIndex)` (phase boundaries come from narration, not an internal
 * clock). The p5 draw loop reads `phase` + a per-phase `sinceMs` timer (reset on
 * every phase change) so easing stays smooth WITHIN a beat while boundaries stay
 * externally synced. Elements reveal CUMULATIVELY: once a beat appears it stays;
 * the current beat eases in on top. Number of phases == number of cues (1:1).
 *
 * The emitted string is fully self-contained (content baked in as a literal),
 * uses only `container` + `libs` ({ p5, THREE, gsap, kit }), references libs.kit,
 * ends with `return { setPhase, dispose }`, and contains no imports/fences — so
 * it passes sanitizeCode/looksRunnable and runs via new Function().
 */
import type { ScenePlan, SceneType, SceneContentItem } from "@/lib/types";

/** All archetype scene types, for orchestrator validation + the schema enum. */
export const SCENE_TYPES: SceneType[] = [
  "flow",
  "cycle",
  "layered",
  "timeline",
  "comparison",
];

export function isSceneType(value: unknown): value is SceneType {
  return SCENE_TYPES.includes(value as SceneType);
}

// ── content shaping ──────────────────────────────────────────────────────
interface ShapedItem {
  label: string;
  sublabel: string;
  value: string;
  magnitude: number;
}

const cap = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;

/** A short uppercase tag from an id/label, for sublabels when none was given. */
function tagFrom(id: string, index: number): string {
  const cleaned = id.replace(/[^a-z0-9]+/gi, " ").trim();
  return cap(cleaned || `step ${index + 1}`, 16);
}

/**
 * Coerce the plan's per-phase content into a clean, bounded shape, one item per
 * phase. Falls back to phase-derived text so an archetype is never empty even if
 * the model returned nothing useful.
 */
function shapeContent(plan: ScenePlan): ShapedItem[] {
  const phases = plan.phases;
  return phases.map((ph, i): ShapedItem => {
    const c: SceneContentItem | undefined = plan.content[i];
    const rawLabel = c?.label?.trim() || ph.intent.split(/[.;:]/)[0]?.trim() || `Step ${i + 1}`;
    const mag =
      typeof c?.magnitude === "number" && Number.isFinite(c.magnitude)
        ? Math.max(0, Math.min(1, c.magnitude))
        : // No magnitude given: stagger a sensible descending default so a
          // comparison scene still reads as a comparison.
          0.85 - (i / Math.max(1, phases.length)) * 0.55;
    return {
      label: cap(rawLabel, 40),
      sublabel: cap(c?.sublabel?.trim() || tagFrom(ph.id, i), 18),
      value: cap(c?.value?.trim() || "", 12),
      magnitude: mag,
    };
  });
}

/** Embed JS-safe literal for the shaped content + title. */
function literal(value: unknown): string {
  return JSON.stringify(value);
}

// ── shared body preamble ──────────────────────────────────────────────────
// Every archetype shares the same phase-driven scaffold: a `phase` closure set
// by setPhase, a `sinceMs` timer that resets on phase change so the current beat
// eases in smoothly, the 1600x900 scale-to-fit transform, kit.grid + phaseDots.
// `DRAW` is the per-archetype frame body; it can read: p, phase, local (0..1
// eased progress of the current beat), tSec (seconds clock for dash flow), VW,
// VH, ITEMS, TITLE, COUNT, kit, ease, palette.
function buildBody(
  title: string,
  items: ShapedItem[],
  phaseLabels: string[],
  draw: string,
): string {
  return String.raw`const W = container.clientWidth || 1280, H = container.clientHeight || 720;
const kit = libs.kit;
const { ease, palette } = kit;
const VW = 1600, VH = 900;
const ITEMS = ${literal(items)};
const TITLE = ${literal(title)};
const PHASE_LABELS = ${literal(phaseLabels)};
const COUNT = ITEMS.length;
const SERIES = [palette.accent, palette.teal, palette.terracotta, palette.blue, palette.pink];

let phase = 0;            // externally driven beat index (cumulative reveal)
let phaseStart = null;    // ms the current phase began (for within-beat easing)

const sketch = (p) => {
  p.setup = () => {
    const c = p.createCanvas(W, H);
    c.style("display", "block");
    kit.useFonts(p);
  };

  p.draw = () => {
    const now = p.millis();
    const tSec = now / 1000;
    if (phaseStart === null) phaseStart = now;
    const local = ease.outCubic(Math.min(1, (now - phaseStart) / 900));

    kit.grid(p);
    p.push();
    const s = Math.min(W / VW, H / VH);
    p.translate(W / 2 - (VW * s) / 2, H / 2 - (VH * s) / 2);
    p.scale(s);

    kit.label(p, { x: VW / 2, y: 92, text: TITLE, size: 32, color: palette.fg, weight: "bold" });

${draw}

    p.pop();
    kit.phaseDots(p, { x: 28, y: H - 34, total: COUNT, current: Math.min(phase, COUNT - 1), label: PHASE_LABELS[Math.min(phase, COUNT - 1)] || "" });
  };
};

const inst = new libs.p5(sketch, container);
return {
  setPhase: (n) => {
    const next = Math.max(0, Math.min(COUNT - 1, n | 0));
    // Reset the within-beat timer to the p5 clock the draw loop reads, so the
    // new beat eases in from local=0 regardless of when the phase changed.
    if (next !== phase) { phase = next; phaseStart = typeof inst.millis === "function" ? inst.millis() : null; }
  },
  dispose: () => inst.remove(),
};`;
}

// Small helper baked into bodies that need a phase-aware reveal/active pair.
// (Inlined as text rather than a runtime import so the body stays self-contained.)

// ── FLOW: directed nodes connected by flow edges (process / cause→effect) ──
function flowBody(title: string, items: ShapedItem[], labels: string[]): string {
  const draw = String.raw`
    // Layout: zig-zag the nodes across two rows so edges read as a flow, not a
    // straight line, once there are 3+ beats.
    const marginX = 220, span = COUNT > 1 ? VW - marginX * 2 : 0;
    const rowY = [VH * 0.42, VH * 0.62];
    const R = COUNT >= 5 ? 70 : COUNT === 4 ? 78 : 90;
    const X = (i) => COUNT > 1 ? marginX + (span * i) / (COUNT - 1) : VW / 2;
    const Y = (i) => COUNT <= 2 ? VH * 0.52 : rowY[i % 2];

    // Edges first (under nodes), revealed with the beat they lead into.
    for (let i = 1; i < COUNT; i++) {
      if (phase < i) continue;
      const ax = X(i - 1), ay = Y(i - 1), bx = X(i), by = Y(i);
      const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;
      const col = SERIES[i % SERIES.length];
      kit.arrowEdge(p, {
        x1: ax + ux * (R + 6), y1: ay + uy * (R + 6),
        x2: bx - ux * (R + 14), y2: by - uy * (R + 14),
        t: tSec, color: col, reveal: i === phase ? local : 1,
        curve: COUNT > 2 ? (i % 2 ? 60 : -60) : 0,
      });
    }

    // Nodes, cumulative.
    for (let i = 0; i < COUNT; i++) {
      if (phase < i) continue;
      const isCur = i === phase;
      const reveal = isCur ? local : 1;
      const active = isCur ? ease.smoothstep(local) : 0.35;
      const col = SERIES[i % SERIES.length];
      kit.node(p, {
        x: X(i), y: Y(i), r: R,
        label: ITEMS[i].label, sublabel: ITEMS[i].sublabel,
        value: ITEMS[i].value || undefined,
        color: col, reveal, settle: active,
      });
    }`;
  return buildBody(title, items, labels, draw);
}

// ── CYCLE: a loop of stages around a ring (cyclic processes) ───────────────
function cycleBody(title: string, items: ShapedItem[], labels: string[]): string {
  const draw = String.raw`
    const cx = VW / 2, cy = VH * 0.54;
    const ringR = COUNT >= 5 ? 290 : 250;
    // Start at top (-90deg) and go clockwise.
    const ang = (i) => -Math.PI / 2 + (i / COUNT) * Math.PI * 2;
    const PX = (i) => cx + Math.cos(ang(i)) * ringR;
    const PY = (i) => cy + Math.sin(ang(i)) * ringR;
    const r = COUNT >= 6 ? 52 : 60;

    // Faint full ring so the loop reads even before all beats appear.
    p.push();
    p.noFill();
    p.stroke(255, 255, 255, 0.05 * 255);
    p.strokeWeight(1.5);
    p.circle(cx, cy, ringR * 2);
    p.pop();

    // Curved arrows between consecutive stages, including the closing edge back
    // to the start once the loop has fully revealed.
    const drawArc = (from, to, rev, col) => {
      const ax = PX(from), ay = PY(from), bx = PX(to), by = PY(to);
      const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;
      // Bow the arc outward from the ring center for a clean clockwise feel.
      const midA = (ang(from) + ang(to)) / 2;
      kit.arrowEdge(p, {
        x1: ax + ux * (r + 4), y1: ay + uy * (r + 4),
        x2: bx - ux * (r + 12), y2: by - uy * (r + 12),
        t: tSec, color: col, reveal: rev, curve: 46 * Math.sign(Math.sin(midA - ang(from) + 0.001) || 1),
      });
    };
    for (let i = 1; i < COUNT; i++) {
      if (phase < i) continue;
      drawArc(i - 1, i, i === phase ? local : 1, SERIES[i % SERIES.length]);
    }
    // Closing edge (loop back) once the last beat is reached.
    if (COUNT > 2 && phase >= COUNT - 1) {
      drawArc(COUNT - 1, 0, local, SERIES[0]);
    }

    // Stage pills, cumulative.
    for (let i = 0; i < COUNT; i++) {
      if (phase < i) continue;
      const isCur = i === phase;
      kit.stageNode(p, {
        x: PX(i), y: PY(i), r,
        label: ITEMS[i].label, sublabel: ITEMS[i].sublabel,
        value: ITEMS[i].value || undefined,
        color: SERIES[i % SERIES.length],
        reveal: isCur ? local : 1,
        active: isCur ? ease.smoothstep(local) : 0,
        index: i + 1,
      });
    }`;
  return buildBody(title, items, labels, draw);
}

// ── LAYERED: stacked left-to-right layers with signals (NN-like) ───────────
function layeredBody(title: string, items: ShapedItem[], labels: string[]): string {
  const draw = String.raw`
    const marginX = 240, span = COUNT > 1 ? VW - marginX * 2 : 0;
    const X = (i) => COUNT > 1 ? marginX + (span * i) / (COUNT - 1) : VW / 2;
    const midY = VH * 0.54;
    const colH = 300;
    // Each layer is a column of small nodes; the count tapers so it reads like a
    // narrowing stack (input wide -> output narrow), capped for legibility.
    const layerN = (i) => Math.max(3, 6 - i);
    const nodeYs = (i) => {
      const n = layerN(i);
      return Array.from({ length: n }, (_, k) => midY - colH / 2 + (k * colH) / (n - 1));
    };

    // Edge bundles between consecutive revealed layers (under the nodes).
    for (let i = 1; i < COUNT; i++) {
      if (phase < i) continue;
      const from = nodeYs(i - 1).map((y) => ({ x: X(i - 1), y }));
      const to = nodeYs(i).map((y) => ({ x: X(i), y }));
      kit.connectBundle(p, { from, to, inset: 14, reveal: i === phase ? local : 1 });
    }
    // Bright signal flows into the current layer.
    if (phase >= 1) {
      const fromYs = nodeYs(phase - 1), toYs = nodeYs(phase);
      const pick = Math.min(fromYs.length, toYs.length, 3);
      for (let k = 0; k < pick; k++) {
        kit.signal(p, {
          x1: X(phase - 1) + 14, y1: fromYs[k],
          x2: X(phase) - 14, y2: toYs[k],
          t: tSec, reveal: local, color: SERIES[phase % SERIES.length],
        });
      }
    }

    // Layer columns + titles, cumulative.
    for (let i = 0; i < COUNT; i++) {
      if (phase < i) continue;
      const isCur = i === phase;
      const reveal = isCur ? local : 1;
      const ys = nodeYs(i);
      const col = SERIES[i % SERIES.length];
      ys.forEach((y, k) => {
        const litLayer = isCur && k < 3;
        kit.neuron(p, {
          x: X(i), y, r: 13,
          active: litLayer, settled: !isCur,
          color: col, reveal,
        });
      });
      // Title + sublabel + value above/below the column.
      kit.label(p, { x: X(i), y: midY - colH / 2 - 40, text: ITEMS[i].label, size: 14, weight: "bold", color: palette.fg, alpha: ease.outCubic(reveal) });
      kit.label(p, { x: X(i), y: midY - colH / 2 - 22, text: ITEMS[i].sublabel, size: 10, upper: true, mono: true, color: palette.fgMuted, alpha: ease.outCubic(reveal) });
      if (ITEMS[i].value) {
        kit.label(p, { x: X(i), y: midY + colH / 2 + 34, text: ITEMS[i].value, size: 15, mono: true, weight: "bold", color: col, alpha: ease.outCubic(reveal) });
      }
    }`;
  return buildBody(title, items, labels, draw);
}

// ── TIMELINE: ordered steps along a horizontal track (sequences/protocols) ─
function timelineBody(title: string, items: ShapedItem[], labels: string[]): string {
  const draw = String.raw`
    const marginX = 210, span = COUNT > 1 ? VW - marginX * 2 : 0;
    const trackY = VH * 0.54;
    const X = (i) => COUNT > 1 ? marginX + (span * i) / (COUNT - 1) : VW / 2;
    const r = COUNT >= 5 ? 50 : 58;

    // The full track (faint), drawn first so it underlies everything.
    p.push();
    p.stroke(255, 255, 255, 0.08 * 255);
    p.strokeWeight(1.5);
    p.strokeCap(p.ROUND);
    if (COUNT > 1) p.line(X(0), trackY, X(COUNT - 1), trackY);
    p.pop();

    // Progress fill of the track up to the current beat.
    if (phase >= 1 || COUNT === 1) {
      for (let i = 1; i <= Math.min(phase, COUNT - 1); i++) {
        const rev = i === phase ? local : 1;
        kit.arrowEdge(p, {
          x1: X(i - 1) + r + 4, y1: trackY, x2: X(i) - r - 10, y2: trackY,
          t: tSec, color: SERIES[i % SERIES.length], reveal: rev, curve: 0,
        });
      }
    }

    // Alternate labels above/below the track to avoid collisions; pills sit on
    // the track. Stagger pills slightly above the line.
    for (let i = 0; i < COUNT; i++) {
      if (phase < i) continue;
      const isCur = i === phase;
      kit.stageNode(p, {
        x: X(i), y: trackY, r,
        label: ITEMS[i].label, sublabel: ITEMS[i].sublabel,
        value: ITEMS[i].value || undefined,
        color: SERIES[i % SERIES.length],
        reveal: isCur ? local : 1,
        active: isCur ? ease.smoothstep(local) : 0,
        index: i + 1,
      });
    }`;
  return buildBody(title, items, labels, draw);
}

// ── COMPARISON: bars revealed one per beat (quantities / magnitudes) ───────
function comparisonBody(title: string, items: ShapedItem[], labels: string[]): string {
  const draw = String.raw`
    const baseY = VH * 0.74;
    const maxH = 380;
    const slotW = COUNT > 0 ? Math.min(220, (VW - 320) / COUNT) : 220;
    const totalW = slotW * COUNT;
    const X = (i) => VW / 2 - totalW / 2 + slotW * (i + 0.5);
    const barW = Math.min(120, slotW * 0.56);

    // Baseline.
    p.push();
    p.stroke(255, 255, 255, 0.12 * 255);
    p.strokeWeight(1.5);
    p.line(VW / 2 - totalW / 2 - 10, baseY, VW / 2 + totalW / 2 + 10, baseY);
    p.pop();

    for (let i = 0; i < COUNT; i++) {
      if (phase < i) continue;
      const isCur = i === phase;
      const reveal = isCur ? local : 1;
      const col = SERIES[i % SERIES.length];
      const readout = ITEMS[i].value || Math.round(ITEMS[i].magnitude * 100) + "%";
      kit.bar(p, {
        x: X(i), y: baseY, w: barW, maxH,
        value: ITEMS[i].magnitude,
        label: ITEMS[i].label, readout,
        color: col, reveal, active: isCur ? ease.smoothstep(local) : 0.25,
      });
      kit.label(p, { x: X(i), y: baseY + 38, text: ITEMS[i].sublabel, size: 10, upper: true, mono: true, color: palette.fgMuted, alpha: ease.outCubic(reveal) });
    }`;
  return buildBody(title, items, labels, draw);
}

const BUILDERS: Record<
  SceneType,
  (title: string, items: ShapedItem[], labels: string[]) => string
> = {
  flow: flowBody,
  cycle: cycleBody,
  layered: layeredBody,
  timeline: timelineBody,
  comparison: comparisonBody,
};

/**
 * Build the render-module body for a plan, selecting the archetype by
 * `plan.sceneType` and baking in the plan's structured content. This is the
 * DEFAULT path for novel queries — reliable, on-topic, reference-quality.
 */
export function archetypeSceneCode(plan: ScenePlan): string {
  const items = shapeContent(plan);
  const labels = plan.phases.map((ph, i) => items[i]?.sublabel || tagFrom(ph.id, i));
  const builder = BUILDERS[plan.sceneType] ?? flowBody;
  return builder(plan.title || "Mira", items, labels);
}
