/**
 * GOLD-STANDARD EXAMPLE — Fed rate cut → mortgage market.
 *
 * A faithful rebuild of design_handoff_mira/canvas.jsx using ONLY the kit.
 * This is a real render-module body (the string assigned to SceneBundle.code):
 * it mounts a p5 instance into `container`, drives a 4-phase timeline off its
 * own clock, composes the scene from kit primitives, and returns cleanup.
 *
 * It serves two jobs:
 *   1) proves the kit can express reference-grade quality, and
 *   2) is embedded VERBATIM in the codegen system prompt as a few-shot
 *      exemplar ("generate in exactly this style").
 *
 * Keep this string self-contained: the only inputs are `container` and `libs`
 * ({ p5, THREE, gsap, kit }). No imports, no fences.
 */
export const FED_RATE_CUT_BODY = String.raw`const W = container.clientWidth || 1280, H = container.clientHeight || 720;
const kit = libs.kit;
const { ease } = kit;

// Layout authored for a 1600x900 design space; scaled to fit the container.
const VW = 1600, VH = 900;
const sketch = (p) => {
  const NODES = [
    { id: "fed",   x: 800,  y: 450, label: "Federal Reserve", sub: "Federal Funds Rate", from: "5.25%", to: "4.75%", r: 96, phase: 0 },
    { id: "tsy",   x: 380,  y: 250, label: "10-Yr Treasury",  sub: "yield",   from: "4.20%",  to: "3.95%", r: 64, phase: 1 },
    { id: "mbs",   x: 380,  y: 650, label: "MBS Spread",      sub: "over 10Y", from: "+165bp", to: "+150bp", r: 64, phase: 1 },
    { id: "mtg",   x: 1220, y: 450, label: "30-Yr Mortgage",  sub: "avg rate", from: "7.20%",  to: "6.55%", r: 80, phase: 2 },
    { id: "refi",  x: 1440, y: 240, label: "Refinance Apps",  sub: "index",   from: "112", to: "184", r: 54, phase: 3, delta: "up" },
    { id: "purch", x: 1440, y: 460, label: "Purchase Apps",   sub: "index",   from: "143", to: "171", r: 54, phase: 3, delta: "up" },
    { id: "price", x: 1440, y: 680, label: "Home Prices",     sub: "m/m",     from: "+0.1%", to: "+0.4%", r: 54, phase: 3, delta: "up" },
  ];
  const EDGES = [
    { from: "fed", to: "tsy", phase: 1 }, { from: "fed", to: "mbs", phase: 1 },
    { from: "tsy", to: "mtg", phase: 2 }, { from: "mbs", to: "mtg", phase: 2 },
    { from: "mtg", to: "refi", phase: 3 }, { from: "mtg", to: "purch", phase: 3 },
    { from: "mtg", to: "price", phase: 3 },
  ];
  const byId = (id) => NODES.find((n) => n.id === id);
  const PHASE_MS = 5000;            // ~5s per beat
  const PHASE_LABELS = ["policy rate", "bond market", "mortgage rate", "demand"];

  // Trim an edge so it starts/ends at the circle rims.
  const trim = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    return { x1: a.x + ux * (a.r + 2), y1: a.y + uy * (a.r + 2),
             x2: b.x - ux * (b.r + 2), y2: b.y - uy * (b.r + 2) };
  };

  p.setup = () => { const c = p.createCanvas(W, H); c.style("display", "block"); kit.useFonts(p); };

  p.draw = () => {
    const tSec = p.millis() / 1000;
    const elapsed = p.millis();
    const phase = Math.min(3, Math.floor(elapsed / PHASE_MS));
    // local progress within the current phase, 0..1
    const local = ease.outCubic(Math.min(1, (elapsed % PHASE_MS) / 1200));

    kit.grid(p);
    // Center the 1600x900 design space inside the container.
    p.push();
    const s = Math.min(W / VW, H / VH);
    p.translate(W / 2 - (VW * s) / 2, H / 2 - (VH * s) / 2);
    p.scale(s);

    // Edges under nodes.
    for (const e of EDGES) {
      if (phase < e.phase) continue;
      const a = byId(e.from), b = byId(e.to);
      const t = trim(a, b);
      const rev = e.phase === phase ? local : 1;
      kit.flowEdge(p, { x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2, t: tSec, reveal: rev });
    }

    // Nodes (value flips 700ms after the node's phase begins; settle drives the
    // hero-ring brighten over the rest of the beat).
    for (const n of NODES) {
      if (phase < n.phase) continue;
      const isCurrent = n.phase === phase;
      const reveal = isCurrent ? local : 1;
      const sinceMs = elapsed - n.phase * PHASE_MS;
      const flip = ease.smoothstep(Math.min(1, Math.max(0, (sinceMs - 700) / 900)));
      const settle = Math.min(1, Math.max(0, (sinceMs - 200) / 1400));
      // Card without the value (value is a flip, drawn on top).
      kit.node(p, { x: n.x, y: n.y, r: n.r, label: n.label, sublabel: n.sub,
                    reveal, settle, delta: n.delta && flip > 0.5 ? n.delta : null });
      const valueSize = n.r >= 90 ? 32 : n.r >= 76 ? 26 : n.r >= 60 ? 20 : 18;
      kit.valueFlip(p, { x: n.x, y: n.y + valueSize / 6, from: n.from, to: n.to,
                         t: flip, size: valueSize });
    }
    p.pop();

    kit.phaseDots(p, { x: 28, y: H - 34, total: 4, current: phase, label: PHASE_LABELS[phase] });
  };
};
const inst = new libs.p5(sketch, container);
return () => inst.remove();`;
