import type { SceneBundle } from "@/lib/types";

/**
 * Hand-authored fallback: Dijkstra's shortest-path search on a small weighted
 * graph. 2D p5. Real render-module body per the contract. The animation runs a
 * scripted relaxation order so it always looks correct, frame-stepped on a slow
 * timer for a Ciechanowski-paced reveal.
 */
const code = `
const W = container.clientWidth || 960, H = container.clientHeight || 600;
const sketch = (p) => {
  const BG = [14, 12, 13];
  const TEXT = [232, 226, 216];
  const DIM = [232, 226, 216];
  const SAGE = [143, 176, 138];
  const TERRA = [217, 138, 106];
  const BLUE = [122, 162, 194];
  // node positions in normalized coords
  const N = [
    { id: "A", x: 0.16, y: 0.5 },
    { id: "B", x: 0.38, y: 0.26 },
    { id: "C", x: 0.38, y: 0.74 },
    { id: "D", x: 0.62, y: 0.32 },
    { id: "E", x: 0.62, y: 0.7 },
    { id: "F", x: 0.84, y: 0.5 },
  ];
  const E = [
    ["A","B",4],["A","C",2],["B","D",5],["C","D",8],
    ["C","E",10],["D","E",2],["D","F",6],["E","F",3],
  ];
  // scripted settle order (node, finalDist) — correct shortest paths from A
  const order = [
    { id: "A", d: 0 }, { id: "C", d: 2 }, { id: "B", d: 4 },
    { id: "D", d: 9 }, { id: "E", d: 11 }, { id: "F", d: 14 },
  ];
  const finalPathEdges = [["A","C"],["C","D"],["D","F"]];
  const pos = (id) => { const n = N.find((m) => m.id === id); return { x: n.x * W, y: n.y * H }; };
  let t = 0;
  p.setup = () => { p.createCanvas(W, H); p.textFont("Georgia"); };
  p.draw = () => {
    p.background(BG[0], BG[1], BG[2]);
    t += 0.016;
    const step = Math.min(order.length, Math.floor((t * 0.6) % (order.length + 2)));
    const settled = new Set(order.slice(0, step).map((o) => o.id));
    const done = step >= order.length;
    // edges
    p.strokeWeight(1.5);
    E.forEach(([a, b, w]) => {
      const onPath = done && finalPathEdges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
      const pa = pos(a), pb = pos(b);
      if (onPath) p.stroke(SAGE[0], SAGE[1], SAGE[2], 230);
      else p.stroke(DIM[0], DIM[1], DIM[2], 55);
      p.strokeWeight(onPath ? 2.5 : 1.5);
      p.line(pa.x, pa.y, pb.x, pb.y);
      p.noStroke();
      p.fill(DIM[0], DIM[1], DIM[2], 150);
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(11);
      p.text(w, (pa.x + pb.x) / 2, (pa.y + pb.y) / 2 - 8);
    });
    // nodes
    N.forEach((n) => {
      const c = pos(n.id);
      const isSettled = settled.has(n.id);
      const col = isSettled ? (done ? SAGE : TERRA) : BLUE;
      p.stroke(col[0], col[1], col[2], isSettled ? 255 : 120);
      p.strokeWeight(1.5);
      p.fill(BG[0], BG[1], BG[2]);
      p.circle(c.x, c.y, 40);
      p.noStroke();
      if (isSettled) { p.fill(col[0], col[1], col[2], 35); p.circle(c.x, c.y, 40); }
      p.fill(TEXT[0], TEXT[1], TEXT[2], isSettled ? 255 : 140);
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(14);
      p.text(n.id, c.x, c.y);
      const settledInfo = order.find((o) => o.id === n.id);
      if (isSettled && settledInfo) {
        p.fill(TERRA[0], TERRA[1], TERRA[2], 220);
        p.textSize(11);
        p.text(settledInfo.d, c.x, c.y + 28);
      }
    });
    p.fill(TEXT[0], TEXT[1], TEXT[2], 180);
    p.textAlign(p.LEFT, p.TOP);
    p.textSize(13);
    p.text(done ? "Shortest path A -> F found: cost 14" : "Dijkstra: settling nearest node each step", 28, 24);
  };
};
const inst = new libs.p5(sketch, container);
return () => inst.remove();
`.trim();

export const dijkstra: SceneBundle = {
  sceneId: "cache-dijkstra",
  renderer: "2d",
  code,
  narration: [
    {
      phaseId: "setup",
      text: "We want the cheapest route from node A to node F across this weighted graph.",
      startMs: 0,
    },
    {
      phaseId: "relax",
      text: "Dijkstra always settles the nearest unvisited node next, locking in its true shortest distance.",
      startMs: 3500,
    },
    {
      phaseId: "path",
      text: "Once every node is settled, the green edges trace the shortest path: A, C, D, F, for a total cost of fourteen.",
      startMs: 8000,
    },
  ],
};
