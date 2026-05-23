/**
 * Interactive ALGORITHM simulation — graph shortest-path search, executed step
 * by step on a weighted grid with obstacles. Watch the frontier (open set)
 * expand, tentative distances update on each cell, the visited (closed) set
 * fill in, and the final shortest path light up.
 *
 * Three algorithms, swappable live, to contrast frontier SHAPES:
 *   • Dijkstra  — uniform-cost, expands in concentric cost rings (round blob)
 *   • A*        — Dijkstra + Manhattan heuristic, frontier leans toward target
 *   • BFS       — unweighted breadth-first, expands in diamond layers
 *
 * Model: we run the chosen search ONCE to completion against a deterministic,
 * seeded grid and record an ordered EVENT LOG — one entry per cell expansion,
 * each carrying the open/closed snapshot and the dist field at that instant —
 * plus the reconstructed path. The animation is a cursor into that log, so it
 * is fully deterministic and scrubbable. setPhase pins the cursor to one of the
 * four narration beats; `speed` advances it via rAF between beats.
 *
 * Aesthetic per the kit brief: amber #efc540 frontier + path on #0c0c0e, teal
 * visited, dim unvisited, 1.5px strokes, flat. Distances render ON cells; a
 * legend + complexity equation + live readouts sit in the margins. The kit's
 * declared technical primitives (readout/legend/equation) are NOT implemented
 * in this build, so we compose those from the primitives that exist (`label`,
 * raw KaTeX) to stay self-contained.
 *
 * Contract: default-exports a `Sim`. `create` mounts a p5 instance and returns
 * a SceneController { setPhase, setParam, dispose }. No runtime p5/three import
 * — everything arrives via `libs`.
 */
import type {
  Sim,
  SceneController,
  SimLibs,
  SceneContent,
  ControlSpec,
} from "@/lib/types";
import type { P5, RGB } from "@/lib/kit";

/* ── tunable knobs ──────────────────────────────────────────────────────── */
const CONTROLS: ControlSpec[] = [
  { key: "speed", label: "Speed", min: 1, max: 120, step: 1, default: 28, unit: " steps/s" },
  { key: "algorithm", label: "Algorithm", min: 0, max: 2, step: 1, default: 1, unit: "" }, // 0 Dijkstra · 1 A* · 2 BFS
  { key: "gridSize", label: "Grid size", min: 8, max: 26, step: 1, default: 18, unit: " cells" },
  { key: "obstacleDensity", label: "Obstacles", min: 0, max: 45, step: 1, default: 26, unit: "%" },
];

const ALGO_NAMES = ["Dijkstra", "A*", "BFS"] as const;
type AlgoIndex = 0 | 1 | 2;

/* ── deterministic PRNG (mulberry32) ────────────────────────────────────── */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── search core ────────────────────────────────────────────────────────── */
interface Cell {
  r: number;
  c: number;
}

interface StepEvent {
  /** Index of the cell expanded (popped from the open set) this step. */
  expanded: number;
  /** Open-set membership snapshot AFTER this expansion (cell index -> in open). */
  open: Uint8Array;
  /** Closed-set membership snapshot AFTER this expansion. */
  closed: Uint8Array;
  /** g-cost (true distance from start) per cell at this instant; Infinity = unseen. */
  dist: Float64Array;
  /** True once the goal has been popped (search can stop). */
  reachedGoal: boolean;
}

interface SearchResult {
  rows: number;
  cols: number;
  /** 1 = wall, 0 = open. Row-major, length rows*cols. */
  walls: Uint8Array;
  startIdx: number;
  goalIdx: number;
  events: StepEvent[];
  /** Cell indices of the shortest path start→goal, or [] if unreachable. */
  path: number[];
  /** Final true cost to the goal, or Infinity. */
  goalCost: number;
}

/**
 * Build a deterministic maze-ish grid and run the chosen algorithm to
 * completion, recording an event per expansion. Edge weights are uniform-1 on
 * the grid; "weighted" here means BFS ignores distance ordering while Dijkstra
 * and A* use a priority queue keyed on g (and g+h for A*). Diagonal moves are
 * disallowed so the four-neighbour frontier shapes read cleanly.
 */
function runSearch(
  algo: AlgoIndex,
  size: number,
  density: number,
): SearchResult {
  const rows = size;
  const cols = size;
  const n = rows * cols;
  const idx = (r: number, c: number) => r * cols + c;
  const rc = (i: number): Cell => ({ r: Math.floor(i / cols), c: i % cols });

  // Seed derived from the parameters so a given config is reproducible AND
  // changing any control yields a fresh, sensible layout.
  const rng = makeRng(0x9e3779b1 ^ (size * 73856093) ^ (Math.round(density) * 19349663) ^ algo);

  const startIdx = idx(Math.floor(rows / 2), 0);
  const goalIdx = idx(Math.floor(rows / 2), cols - 1);

  // Place walls; never block start/goal. Retry layouts until the goal is
  // reachable so the sim always finds a path (deterministic given the seed).
  const walls = new Uint8Array(n);
  const buildWalls = () => {
    walls.fill(0);
    const p = density / 100;
    for (let i = 0; i < n; i++) {
      if (i === startIdx || i === goalIdx) continue;
      if (rng() < p) walls[i] = 1;
    }
  };

  const neighbours = (i: number): number[] => {
    const { r, c } = rc(i);
    const out: number[] = [];
    if (r > 0 && !walls[idx(r - 1, c)]) out.push(idx(r - 1, c));
    if (r < rows - 1 && !walls[idx(r + 1, c)]) out.push(idx(r + 1, c));
    if (c > 0 && !walls[idx(r, c - 1)]) out.push(idx(r, c - 1));
    if (c < cols - 1 && !walls[idx(r, c + 1)]) out.push(idx(r, c + 1));
    return out;
  };

  const manhattan = (i: number): number => {
    const a = rc(i);
    const b = rc(goalIdx);
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
  };

  // Tie-break priority: A*/Dijkstra by f (or g), BFS by insertion order. A
  // tiny insertion counter breaks f-ties deterministically (favours the
  // earlier-discovered node) so frontier growth is stable frame to frame.
  const priority = (g: number, i: number): number =>
    algo === 0 ? g : algo === 2 ? 0 : g + manhattan(i);

  let result: SearchResult | null = null;
  for (let attempt = 0; attempt < 40 && !result; attempt++) {
    buildWalls();

    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const inOpen = new Uint8Array(n);
    dist[startIdx] = 0;

    // Open set. For Dijkstra/A* it's a min-heap on priority; for BFS a FIFO
    // queue. A small binary heap keeps the search honest (no O(V) scans) and
    // lets large grids stay smooth.
    interface HeapNode {
      i: number;
      key: number;
      seq: number;
    }
    const heap: HeapNode[] = [];
    let seq = 0;
    const less = (a: HeapNode, b: HeapNode) =>
      algo === 2
        ? a.seq < b.seq // FIFO for BFS
        : a.key !== b.key
          ? a.key < b.key
          : a.seq < b.seq;
    const swap = (x: number, y: number) => {
      const t = heap[x];
      heap[x] = heap[y];
      heap[y] = t;
    };
    const push = (node: HeapNode) => {
      heap.push(node);
      let c = heap.length - 1;
      while (c > 0) {
        const par = (c - 1) >> 1;
        if (less(heap[c], heap[par])) {
          swap(c, par);
          c = par;
        } else break;
      }
    };
    const pop = (): HeapNode | undefined => {
      if (heap.length === 0) return undefined;
      const top = heap[0];
      const last = heap.pop() as HeapNode;
      if (heap.length > 0) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = 2 * c + 1;
          const r = 2 * c + 2;
          let s = c;
          if (l < heap.length && less(heap[l], heap[s])) s = l;
          if (r < heap.length && less(heap[r], heap[s])) s = r;
          if (s === c) break;
          swap(s, c);
          c = s;
        }
      }
      return top;
    };

    push({ i: startIdx, key: priority(0, startIdx), seq: seq++ });
    inOpen[startIdx] = 1;

    const events: StepEvent[] = [];
    let reachedGoal = false;

    while (heap.length > 0) {
      const cur = pop() as HeapNode;
      const u = cur.i;
      if (closed[u]) continue; // stale heap entry (lazy deletion)
      inOpen[u] = 0;
      closed[u] = 1;

      if (u === goalIdx) reachedGoal = true;

      for (const v of neighbours(u)) {
        if (closed[v]) continue;
        const nd = dist[u] + 1; // uniform edge weight
        if (nd < dist[v]) {
          dist[v] = nd;
          prev[v] = u;
          inOpen[v] = 1;
          push({ i: v, key: priority(nd, v), seq: seq++ });
        }
      }

      // Snapshot AFTER processing this expansion.
      events.push({
        expanded: u,
        open: inOpen.slice(),
        closed: closed.slice(),
        dist: dist.slice(),
        reachedGoal,
      });

      if (reachedGoal) break; // optimal once goal is popped (Dijkstra/A*/BFS-uniform)
    }

    if (!reachedGoal) continue; // unlucky layout; reseed implicitly via retry

    // Reconstruct path goal→start.
    const path: number[] = [];
    let cur = goalIdx;
    while (cur !== -1) {
      path.push(cur);
      if (cur === startIdx) break;
      cur = prev[cur];
    }
    path.reverse();

    result = {
      rows,
      cols,
      walls: walls.slice(),
      startIdx,
      goalIdx,
      events,
      path,
      goalCost: dist[goalIdx],
    };
  }

  // Fallback: degenerate empty-corridor grid (guaranteed solvable) if every
  // random layout boxed the goal in. Keeps the sim from ever throwing.
  if (!result) {
    walls.fill(0);
    const dist = new Float64Array(n).fill(Infinity);
    dist[startIdx] = 0;
    const events: StepEvent[] = [];
    const r0 = Math.floor(rows / 2);
    const closed = new Uint8Array(n);
    const open = new Uint8Array(n);
    const path: number[] = [];
    for (let c = 0; c <= cols - 1; c++) {
      const u = idx(r0, c);
      closed[u] = 1;
      dist[u] = c;
      path.push(u);
      events.push({ expanded: u, open: open.slice(), closed: closed.slice(), dist: dist.slice(), reachedGoal: c === cols - 1 });
    }
    result = { rows, cols, walls: walls.slice(), startIdx, goalIdx, events, path, goalCost: cols - 1 };
  }

  return result;
}

/* ── colour helpers (kit palette, with a teal "visited") ────────────────── */
function withAlpha(p: P5, c: RGB, a: number): void {
  p.fill(c[0], c[1], c[2], a * 255);
}

/* ── the sim ────────────────────────────────────────────────────────────── */
const sim: Sim = {
  id: "algorithm",
  title: "Shortest-Path Search",
  controls: CONTROLS,
  create(
    container: HTMLElement,
    libs: SimLibs,
    content: SceneContent,
  ): SceneController {
    const { kit } = libs;
    const { palette, ease } = kit;
    const VISITED: RGB = palette.teal; // closed set
    const FRONTIER: RGB = palette.accent; // open set + path (amber)
    const WALL: RGB = palette.fgSubtle;

    // Live, tunable state. Seeded from content.params then control defaults.
    const params: Record<string, number> = {
      speed: content.params?.speed ?? 28,
      algorithm: content.params?.algorithm ?? 1,
      gridSize: content.params?.gridSize ?? 18,
      obstacleDensity: content.params?.obstacleDensity ?? 26,
    };

    let search: SearchResult = runSearch(
      Math.round(params.algorithm) as AlgoIndex,
      Math.round(params.gridSize),
      Math.round(params.obstacleDensity),
    );

    // Animation cursor: a fractional index into search.events. The integer part
    // is the last completed expansion; the fraction eases the just-expanded
    // cell in. setPhase pins the *target*; speed walks `cursor` toward it.
    let cursor = 0;
    let phase = 0;
    const PHASE_COUNT = 4;

    // Map a phase index to a target cursor (in events). 4 beats:
    //   0 start            → just the start cell (cursor 0)
    //   1 frontier expands → ~55% through the expansions
    //   2 target reached   → the final expansion (goal popped)
    //   3 path traced      → final expansion + path-trace animation
    const phaseTarget = (ph: number): number => {
      const last = Math.max(0, search.events.length - 1);
      if (ph <= 0) return 0;
      if (ph === 1) return Math.round(last * 0.55);
      return last; // phases 2 and 3 both sit at the final expansion
    };

    // Path-trace progress 0..1, only meaningful in phase 3.
    let pathT = 0;

    // ── KaTeX complexity equation overlay (the kit's `equation` is unbuilt). ──
    const eqEl = document.createElement("div");
    eqEl.style.position = "absolute";
    eqEl.style.pointerEvents = "none";
    eqEl.style.color = "rgb(161,161,170)";
    eqEl.style.fontSize = "15px";
    eqEl.style.zIndex = "2";
    eqEl.style.left = "0";
    eqEl.style.top = "0";
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.appendChild(eqEl);
    const complexityTex: Record<number, string> = {
      0: "O\\big((V+E)\\,\\log V\\big)",
      1: "O\\big((V+E)\\,\\log V\\big)\\;+\\;h(n)",
      2: "O(V+E)",
    };
    let lastEqAlgo = -1;
    const renderEquation = (algo: number) => {
      if (algo === lastEqAlgo) return;
      lastEqAlgo = algo;
      try {
        eqEl.innerHTML = libs.katex.renderToString(complexityTex[algo] ?? "", {
          throwOnError: false,
          displayMode: false,
          output: "html", // HTML-only; skip the MathML node so it doesn't double-render
        });
      } catch {
        eqEl.textContent = "O((V+E) log V)";
      }
    };

    // ── geometry, recomputed on resize / grid change ──
    let W = container.clientWidth || 960;
    let H = container.clientHeight || 600;
    let cell = 1;
    let originX = 0;
    let originY = 0;
    const PAD_TOP = 70; // room for the title + readouts
    const PAD_SIDE = 34;
    const PAD_BOTTOM = 92; // room for legend + phase dots
    const layout = () => {
      W = container.clientWidth || 960;
      H = container.clientHeight || 600;
      const availW = W - PAD_SIDE * 2;
      const availH = H - PAD_TOP - PAD_BOTTOM;
      cell = Math.max(6, Math.floor(Math.min(availW / search.cols, availH / search.rows)));
      const gridW = cell * search.cols;
      const gridH = cell * search.rows;
      originX = (W - gridW) / 2;
      originY = PAD_TOP + (availH - gridH) / 2;
    };

    const rebuild = () => {
      search = runSearch(
        Math.round(params.algorithm) as AlgoIndex,
        Math.round(params.gridSize),
        Math.round(params.obstacleDensity),
      );
      cursor = phaseTarget(phase);
      pathT = phase >= 3 ? 1 : 0;
      layout();
    };

    const cellCenter = (i: number): { x: number; y: number } => {
      const r = Math.floor(i / search.cols);
      const c = i % search.cols;
      return {
        x: originX + c * cell + cell / 2,
        y: originY + r * cell + cell / 2,
      };
    };

    const sketch = (p: P5) => {
      p.setup = () => {
        const cv = p.createCanvas(container.clientWidth || 960, container.clientHeight || 600);
        cv.style("display", "block");
        kit.useFonts(p);
        layout();
        renderEquation(Math.round(params.algorithm));
      };

      p.windowResized = () => {
        p.resizeCanvas(container.clientWidth || 960, container.clientHeight || 600);
        layout();
      };

      p.draw = () => {
        const dt = Math.min(0.05, (p.deltaTime || 16) / 1000);

        // Advance the cursor toward the phase target at `speed` events/sec.
        const target = phaseTarget(phase);
        if (cursor < target) {
          cursor = Math.min(target, cursor + params.speed * dt);
        } else if (cursor > target) {
          // Snapping backward (e.g. phase rewound) is instant — no reverse anim.
          cursor = target;
        }
        // Path trace eases in during phase 3, once the cursor has arrived.
        if (phase >= 3 && cursor >= target - 0.001) {
          pathT = Math.min(1, pathT + dt * 1.1);
        } else if (phase < 2) {
          pathT = 0;
        }

        const stepIdx = Math.min(search.events.length - 1, Math.floor(cursor));
        const frac = ease.outCubic(cursor - Math.floor(cursor));
        const ev = search.events[stepIdx];

        // ── background ──
        kit.grid(p, { reveal: 1, cell: 100 });

        // ── grid cells ──
        p.push();
        p.rectMode(p.CORNER);
        const showDist = cell >= 22; // only label distances when cells are big enough
        for (let i = 0; i < search.rows * search.cols; i++) {
          const r = Math.floor(i / search.cols);
          const c = i % search.cols;
          const x = originX + c * cell;
          const y = originY + r * cell;
          const isWall = search.walls[i] === 1;
          const isClosed = ev.closed[i] === 1;
          const isOpen = ev.open[i] === 1 && !isClosed;
          const justExpanded = i === ev.expanded && stepIdx > 0;

          p.noStroke();
          if (isWall) {
            withAlpha(p, WALL, 0.5);
            p.rect(x + 0.5, y + 0.5, cell - 1, cell - 1, 2);
          } else if (isClosed) {
            // Visited (closed) — teal, brighter the more recently expanded feel.
            withAlpha(p, VISITED, justExpanded ? 0.18 + 0.42 * frac : 0.22);
            p.rect(x + 0.5, y + 0.5, cell - 1, cell - 1, 2);
          } else if (isOpen) {
            // Frontier (open) — amber.
            withAlpha(p, FRONTIER, 0.16);
            p.rect(x + 0.5, y + 0.5, cell - 1, cell - 1, 2);
          }

          // Hairline cell border (only on non-wall cells, keeps it flat/clean).
          if (!isWall) {
            p.noFill();
            p.stroke(255, 255, 255, 0.05 * 255);
            p.strokeWeight(1);
            p.rect(x + 0.5, y + 0.5, cell - 1, cell - 1, 2);
          }

          // Distance value ON the cell.
          if (showDist && !isWall && (isClosed || isOpen)) {
            const d = ev.dist[i];
            if (Number.isFinite(d)) {
              const isFront = isOpen;
              p.noStroke();
              p.textFont("Menlo, Monaco, Consolas, monospace");
              p.textAlign(p.CENTER, p.CENTER);
              p.textSize(Math.min(13, cell * 0.42));
              const col = isFront ? FRONTIER : VISITED;
              p.fill(col[0], col[1], col[2], (isFront ? 0.95 : 0.8) * 255);
              p.text(String(d), x + cell / 2, y + cell / 2);
            }
          }
        }
        p.pop();

        // ── current frontier outline: stroke the open cells in amber to make
        // the "wavefront" pop even when distance labels are off ──
        p.push();
        p.noFill();
        p.stroke(FRONTIER[0], FRONTIER[1], FRONTIER[2], 0.55 * 255);
        p.strokeWeight(1.5);
        for (let i = 0; i < search.rows * search.cols; i++) {
          if (ev.open[i] === 1 && ev.closed[i] === 0) {
            const c = i % search.cols;
            const r = Math.floor(i / search.cols);
            p.rect(originX + c * cell + 0.5, originY + r * cell + 0.5, cell - 1, cell - 1, 2);
          }
        }
        p.pop();

        // ── shortest path (phase 2 reveals start→goal trace, phase 3 fully lit) ──
        if (phase >= 2 && ev.reachedGoal && search.path.length > 1) {
          const drawN =
            phase >= 3
              ? Math.max(2, Math.floor(2 + (search.path.length - 2) * ease.outCubic(pathT)))
              : search.path.length;
          p.push();
          p.noFill();
          // glow underlay
          p.stroke(FRONTIER[0], FRONTIER[1], FRONTIER[2], 0.14 * 255);
          p.strokeWeight(Math.max(6, cell * 0.5));
          p.strokeJoin(p.ROUND);
          p.strokeCap(p.ROUND);
          p.beginShape();
          for (let k = 0; k < Math.min(drawN, search.path.length); k++) {
            const ctr = cellCenter(search.path[k]);
            p.vertex(ctr.x, ctr.y);
          }
          p.endShape();
          // core line
          p.stroke(FRONTIER[0], FRONTIER[1], FRONTIER[2], 0.95 * 255);
          p.strokeWeight(Math.max(2, cell * 0.16));
          p.beginShape();
          for (let k = 0; k < Math.min(drawN, search.path.length); k++) {
            const ctr = cellCenter(search.path[k]);
            p.vertex(ctr.x, ctr.y);
          }
          p.endShape();
          p.pop();
        }

        // ── start + goal markers (drawn on top) ──
        const drawMarker = (i: number, glyph: string, col: RGB) => {
          const ctr = cellCenter(i);
          p.push();
          p.noStroke();
          p.fill(col[0], col[1], col[2], 0.9 * 255);
          p.circle(ctr.x, ctr.y, cell * 0.62);
          p.fill(palette.bg[0], palette.bg[1], palette.bg[2], 255);
          p.textFont("Menlo, Monaco, Consolas, monospace");
          p.textStyle(p.BOLD);
          p.textAlign(p.CENTER, p.CENTER);
          p.textSize(Math.min(14, cell * 0.5));
          p.text(glyph, ctr.x, ctr.y);
          p.pop();
        };
        drawMarker(search.startIdx, "S", FRONTIER);
        drawMarker(search.goalIdx, "G", palette.terracotta);

        // ── HUD: title + algorithm + live readouts ──
        const expandedCount = stepIdx + 1;
        const openCount = (() => {
          let s = 0;
          for (let i = 0; i < ev.open.length; i++) if (ev.open[i] && !ev.closed[i]) s++;
          return s;
        })();
        const algoName = ALGO_NAMES[Math.round(params.algorithm) as AlgoIndex];

        // Title (left) — uses content.title when supplied.
        kit.label(p, {
          x: PAD_SIDE,
          y: 26,
          text: content.title || sim.title,
          size: 16,
          weight: "bold",
          color: palette.fg,
          align: "left",
        });
        kit.label(p, {
          x: PAD_SIDE,
          y: 46,
          text: `${algoName} · ${search.cols}×${search.rows} grid`,
          size: 11,
          upper: true,
          mono: true,
          color: palette.fgMuted,
          align: "left",
        });

        // Readouts (right side), stacked. Composed from kit.label since the
        // kit's `readout` primitive isn't implemented in this build.
        const readout = (yTop: number, cap: string, val: string, col: RGB) => {
          kit.label(p, { x: W - PAD_SIDE, y: yTop, text: cap, size: 10, upper: true, mono: true, color: palette.fgMuted, align: "right" });
          kit.label(p, { x: W - PAD_SIDE, y: yTop + 18, text: val, size: 20, mono: true, weight: "bold", color: col, align: "right" });
        };
        readout(20, "Nodes expanded", String(expandedCount), VISITED);
        readout(58, "Frontier size", String(openCount), FRONTIER);
        if (ev.reachedGoal) {
          readout(96, "Path cost", String(search.goalCost), FRONTIER);
        } else {
          readout(96, "Searching", "…", palette.fgMuted);
        }

        // Position the complexity equation overlay just under the title block.
        eqEl.style.left = `${PAD_SIDE}px`;
        eqEl.style.top = `${H - PAD_BOTTOM + 56}px`;

        // ── legend (bottom-left) ──
        const legendY = H - PAD_BOTTOM + 24;
        const legendItem = (lx: number, col: RGB, txt: string) => {
          p.push();
          p.noStroke();
          withAlpha(p, col, 0.85);
          p.rect(lx, legendY - 6, 12, 12, 2);
          p.pop();
          kit.label(p, { x: lx + 18, y: legendY, text: txt, size: 11, mono: true, color: palette.fgMuted, align: "left" });
          // width estimate for the next item
          return lx + 18 + txt.length * 7.0 + 26;
        };
        let lx = PAD_SIDE;
        lx = legendItem(lx, FRONTIER, "frontier");
        lx = legendItem(lx, VISITED, "visited");
        lx = legendItem(lx, palette.terracotta, "goal");
        legendItem(lx, WALL, "wall");

        // ── phase dots (bottom-right) ──
        kit.phaseDots(p, {
          x: W - PAD_SIDE - (16 + 4) * PHASE_COUNT - 110,
          y: H - PAD_BOTTOM + 22,
          total: PHASE_COUNT,
          current: phase,
          label: content.phases?.[phase]?.label ?? "",
          color: FRONTIER,
        });
      };
    };

    const inst = new libs.p5(sketch, container);

    return {
      setPhase: (phaseIndex: number) => {
        phase = Math.max(0, Math.min(PHASE_COUNT - 1, Math.floor(phaseIndex)));
        // Beats 2/3 should show the completed search immediately rather than
        // waiting for the cursor to walk there; jump it forward (never back
        // past where the animation already is for beat 1).
        const target = phaseTarget(phase);
        if (phase >= 2) cursor = target;
        if (phase >= 3) pathT = 0; // re-trace the path on this beat
        if (phase < 2) pathT = 0;
      },
      setParam: (key: string, value: number) => {
        if (!(key in params)) return;
        params[key] = value;
        if (key === "speed") return; // rate only; no rebuild
        // algorithm / gridSize / obstacleDensity all change the search itself.
        if (key === "algorithm") renderEquation(Math.round(value));
        rebuild();
      },
      dispose: () => {
        inst.remove();
        eqEl.remove();
      },
    };
  },
};

export default sim;
