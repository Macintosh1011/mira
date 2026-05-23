import type { SceneBundle } from "@/lib/types";

/**
 * Hand-authored fallback: a Fed rate cut rippling through the mortgage market.
 * 2D p5 flow diagram. This is a REAL render-module body matching the contract
 * in lib/types.ts: it mounts a p5 instance into `container` and returns a
 * cleanup. Used as demo insurance and to resolve the example-query button
 * instantly. Verified to run under new Function("container","libs", code).
 */
const code = `
const W = container.clientWidth || 960, H = container.clientHeight || 600;
const sketch = (p) => {
  const BG = [14, 12, 13];
  const TERRA = [217, 138, 106];
  const YELLOW = [232, 196, 104];
  const SAGE = [143, 176, 138];
  const BLUE = [122, 162, 194];
  const TEXT = [232, 226, 216];
  const nodes = [
    { x: 0.16, y: 0.5, label: "Federal Reserve", c: TERRA, sub: "cuts rate 0.50%" },
    { x: 0.42, y: 0.5, label: "Banks", c: YELLOW, sub: "cheaper funding" },
    { x: 0.68, y: 0.5, label: "Mortgage Rates", c: SAGE, sub: "fall" },
    { x: 0.9, y: 0.5, label: "Homebuyers", c: BLUE, sub: "demand rises" },
  ];
  const edges = [[0,1],[1,2],[2,3]];
  let t = 0;
  const px = (n) => n.x * W;
  const py = (n) => n.y * H;
  p.setup = () => { p.createCanvas(W, H); p.textFont("Georgia"); };
  p.draw = () => {
    p.background(BG[0], BG[1], BG[2]);
    t += 0.012;
    const phase = (t * 0.5) % 4; // four beats
    p.strokeWeight(1.5);
    edges.forEach((e, i) => {
      const a = nodes[e[0]], b = nodes[e[1]];
      p.stroke(TEXT[0], TEXT[1], TEXT[2], 60);
      p.line(px(a), py(a), px(b), py(b));
      // pulse travels along edge once its beat is active
      const active = phase > i;
      if (active) {
        const local = Math.min(1, (phase - i));
        const eased = local < 1 ? 1 - Math.pow(1 - local, 3) : 1;
        const x = px(a) + (px(b) - px(a)) * eased;
        const y = py(a) + (py(b) - py(a)) * eased;
        p.noStroke();
        p.fill(TERRA[0], TERRA[1], TERRA[2], 200);
        p.circle(x, y, 10 + 4 * Math.sin(t * 6));
      }
    });
    nodes.forEach((n, i) => {
      const lit = phase >= i ? 1 : 0.35;
      const r = 46;
      p.noFill();
      p.stroke(n.c[0], n.c[1], n.c[2], 255 * lit);
      p.strokeWeight(1.5);
      p.circle(px(n), py(n), r * 2);
      p.noStroke();
      p.fill(n.c[0], n.c[1], n.c[2], 30 * lit);
      p.circle(px(n), py(n), r * 2);
      p.fill(TEXT[0], TEXT[1], TEXT[2], 255 * lit);
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(14);
      p.text(n.label, px(n), py(n) - r - 16);
      p.textSize(11);
      p.fill(n.c[0], n.c[1], n.c[2], 220 * lit);
      p.text(n.sub, px(n), py(n) + r + 16);
    });
    p.fill(TEXT[0], TEXT[1], TEXT[2], 180);
    p.textAlign(p.LEFT, p.TOP);
    p.textSize(13);
    p.text("How a Fed rate cut ripples to the mortgage market", 28, 24);
  };
};
const inst = new libs.p5(sketch, container);
return () => inst.remove();
`.trim();

export const fedRateCut: SceneBundle = {
  sceneId: "cache-fed-rate-cut",
  renderer: "2d",
  code,
  narration: [
    {
      phaseId: "fed",
      text: "It starts at the Federal Reserve, which lowers its benchmark interest rate by half a point.",
      startMs: 0,
    },
    {
      phaseId: "banks",
      text: "Banks borrow more cheaply, so their own cost of funding falls almost immediately.",
      startMs: 3000,
    },
    {
      phaseId: "mortgage",
      text: "That feeds into mortgage rates, which drift downward over the following weeks.",
      startMs: 6000,
    },
    {
      phaseId: "buyers",
      text: "Lower rates mean smaller monthly payments, so more homebuyers can afford to enter the market.",
      startMs: 9000,
    },
  ],
};
