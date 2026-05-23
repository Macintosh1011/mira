/**
 * traffic-jam — a literal phantom-traffic-jam simulation.
 *
 * Cars follow the Optimal Velocity Model (Bando et al. 1995) on a ring road:
 *
 *     v̇ᵢ = a · [ V(Δxᵢ) − vᵢ ]      V(b) = vmax · (tanh(b−bc) + tanh(bc)) / (1 + tanh(bc))
 *
 * Above a critical density the uniform flow is linearly unstable (a < 2·V′(h*)),
 * so a single small brake tap amplifies upstream and freezes into a stop-and-go
 * wave that travels BACKWARD around the ring while every car keeps moving
 * forward. That backward wave is the whole point — a "phantom" jam with no cause.
 *
 * Story beats (setPhase): open road → one car taps the brakes → the wave rolls
 * upstream → the jam locks in (space-time stripe). The density slider lets you
 * cross the stability threshold yourself.
 *
 * Aesthetic: one focal idea per beat, generous space, amber = flowing, deep red
 * = stopped. Single equation rendered once via KaTeX overlay. No clutter.
 */

import type { Sim, SimLibs, SceneContent, SceneController } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type P5 = any;

// ── Model tuning (chosen so the default state is comfortably unstable) ────────
const RING_LEN = 100; // model units around the loop
const VMAX = 2.0; // free-flow speed (units/s)
const BC = 2.0; // comfortable headway in V(b)
const TIME_SCALE = 1.6; // sim seconds per wall second (paces the story)
const SUBSTEPS = 6; // integration substeps per frame (stability)

const PALETTE = {
  bg: "#0c0c0e",
  fg: "#f4f4f5",
  fgMuted: "#a1a1aa",
  fgSubtle: "#52525b",
  flow: [239, 197, 64] as const, // amber — full speed
  jam: [164, 18, 71] as const, // deep red — stopped
  hint: [49, 192, 177] as const, // teal — accents
};

/** Optimal velocity as a function of headway b. */
function optimalVelocity(b: number, vmax: number): number {
  const t = Math.tanh(BC);
  return (vmax * (Math.tanh(b - BC) + t)) / (1 + t);
}

/** Blend amber→red by how stopped a car is (0 = full speed, 1 = stopped). */
function carColor(stopped: number): [number, number, number] {
  const f = stopped < 0 ? 0 : stopped > 1 ? 1 : stopped;
  return [
    Math.round(PALETTE.flow[0] + (PALETTE.jam[0] - PALETTE.flow[0]) * f),
    Math.round(PALETTE.flow[1] + (PALETTE.jam[1] - PALETTE.flow[1]) * f),
    Math.round(PALETTE.flow[2] + (PALETTE.jam[2] - PALETTE.flow[2]) * f),
  ];
}

interface Car {
  s: number; // arc position [0, RING_LEN)
  v: number; // speed
}

const TrafficJamSim: Sim = {
  id: "traffic-jam",
  title: "How a Phantom Traffic Jam Forms",
  controls: [
    { key: "density", label: "Density", min: 12, max: 52, step: 1, default: 36, unit: "cars" },
    { key: "sensitivity", label: "Reaction", min: 0.12, max: 1.2, step: 0.02, default: 0.3, unit: "a" },
    { key: "vmax", label: "Free speed", min: 1, max: 3, step: 0.1, default: 2, unit: "" },
  ],

  create(container: HTMLElement, libs: SimLibs, content: SceneContent): SceneController {
    const p5 = libs.p5;
    const title = content.title || TrafficJamSim.title;

    // Live params (seedable from the orchestrator's content.params).
    const params = {
      density: content.params?.density ?? 36,
      sensitivity: content.params?.sensitivity ?? 0.3,
      vmax: content.params?.vmax ?? VMAX,
    };

    let phase = 0;
    let cars: Car[] = [];
    let perturbed = false;
    // Space-time buffer: rows over time, each row = speed sampled around the ring.
    const ST_COLS = 90;
    const ST_ROWS = 70;
    const stBuffer = new Float32Array(ST_COLS * ST_ROWS).fill(1);
    let stHead = 0;
    let stTimer = 0;

    // ── seed uniform equilibrium flow (no perturbation) ───────────────────────
    const reseed = () => {
      const n = Math.round(params.density);
      const gap = RING_LEN / n;
      const vEq = optimalVelocity(gap, params.vmax);
      cars = [];
      for (let i = 0; i < n; i++) cars.push({ s: i * gap, v: vEq });
      perturbed = false;
      stBuffer.fill(1);
      stHead = 0;
    };
    reseed();

    // Inject the single brake tap that seeds the instability.
    const perturb = () => {
      if (perturbed || cars.length === 0) return;
      cars[0].v *= 0.15; // one driver taps the brakes
      perturbed = true;
    };

    // ── physics step (OVM, single-lane, no passing) ──────────────────────────
    const step = (dt: number) => {
      const n = cars.length;
      if (n < 2) return;
      const accel = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const ahead = cars[(i + 1) % n];
        let headway = ahead.s - cars[i].s;
        if (headway <= 0) headway += RING_LEN;
        accel[i] = params.sensitivity * (optimalVelocity(headway, params.vmax) - cars[i].v);
      }
      for (let i = 0; i < n; i++) {
        cars[i].v = Math.max(0, cars[i].v + accel[i] * dt);
      }
      // advance, clamped so a car never overtakes the one ahead (min bumper gap)
      for (let i = 0; i < n; i++) {
        const ahead = cars[(i + 1) % n];
        let room = ahead.s - cars[i].s;
        if (room <= 0) room += RING_LEN;
        const move = Math.min(cars[i].v * dt, Math.max(0, room - 0.6));
        cars[i].s = (cars[i].s + move) % RING_LEN;
        if (move < cars[i].v * dt) cars[i].v *= 0.5; // forced to brake hard
      }
    };

    // sample speed around the ring into a space-time row
    const recordSpaceTime = () => {
      const row = stHead % ST_ROWS;
      const n = cars.length;
      for (let c = 0; c < ST_COLS; c++) {
        const sPos = (c / ST_COLS) * RING_LEN;
        let best = 1;
        let bestD = Infinity;
        for (let i = 0; i < n; i++) {
          let d = Math.abs(cars[i].s - sPos);
          if (d > RING_LEN / 2) d = RING_LEN - d;
          if (d < bestD) {
            bestD = d;
            best = Math.min(1, cars[i].v / params.vmax);
          }
        }
        stBuffer[row * ST_COLS + c] = best;
      }
      stHead++;
    };

    // ── KaTeX equation, rendered ONCE into a positioned overlay ───────────────
    const eqSrc =
      content.equation ||
      "\\dot v_i = a\\,\\bigl[\\,V(\\Delta x_i) - v_i\\,\\bigr]";
    const eqEl = document.createElement("div");
    eqEl.style.position = "absolute";
    eqEl.style.left = "28px";
    eqEl.style.top = "64px";
    eqEl.style.color = "rgba(244,244,245,0.82)";
    eqEl.style.fontSize = "15px";
    eqEl.style.pointerEvents = "none";
    eqEl.style.opacity = "0";
    eqEl.style.transition = "opacity 500ms cubic-bezier(0.16,1,0.3,1)";
    try {
      eqEl.innerHTML = libs.katex.renderToString(eqSrc, {
        throwOnError: false,
        output: "html",
        displayMode: false,
      });
    } catch {
      eqEl.textContent = "";
    }
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.appendChild(eqEl);

    // ── p5 sketch ─────────────────────────────────────────────────────────────
    let inst: P5 | null = null;
    let W = container.clientWidth || 960;
    let H = container.clientHeight || 540;

    const sketch = (p: P5) => {
      p.setup = () => {
        const c = p.createCanvas(W, H);
        c.style("display", "block");
        p.textFont("Helvetica Neue, Helvetica, Arial, sans-serif");
      };

      p.draw = () => {
        const dt = (Math.min(p.deltaTime, 50) / 1000) * TIME_SCALE;
        if (phase >= 1) perturb();
        for (let k = 0; k < SUBSTEPS; k++) step(dt / SUBSTEPS);
        if (phase >= 2) {
          stTimer += dt;
          if (stTimer > 0.08) {
            recordSpaceTime();
            stTimer = 0;
          }
        }

        p.background(PALETTE.bg);

        const cx = W * 0.5;
        const cy = H * 0.52;
        const R = Math.min(W, H) * 0.3;

        // title
        p.noStroke();
        p.fill(244, 244, 245);
        p.textSize(Math.min(30, W * 0.024));
        p.textAlign(p.CENTER, p.TOP);
        p.textStyle(p.BOLD);
        p.text(title, cx, H * 0.06);
        p.textStyle(p.NORMAL);

        // road
        p.noFill();
        p.stroke(255, 255, 255, 0.06 * 255);
        p.strokeWeight(R * 0.16);
        p.circle(cx, cy, R * 2);
        p.stroke(255, 255, 255, 0.1 * 255);
        p.strokeWeight(1);
        p.circle(cx, cy, R * 2);

        // cars
        const n = cars.length;
        let sumV = 0;
        let jammed = 0;
        for (let i = 0; i < n; i++) {
          const ang = (cars[i].s / RING_LEN) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(ang) * R;
          const y = cy + Math.sin(ang) * R;
          const speedFrac = Math.min(1, cars[i].v / params.vmax);
          sumV += speedFrac;
          if (speedFrac < 0.35) jammed++;
          const col = carColor(1 - speedFrac);
          if (i === 0 && phase === 1) {
            p.noFill();
            p.stroke(PALETTE.jam[0], PALETTE.jam[1], PALETTE.jam[2], 0.9 * 255);
            p.strokeWeight(1.5);
            p.circle(x, y, R * 0.2);
          }
          p.noStroke();
          p.fill(col[0], col[1], col[2], 255);
          p.circle(x, y, R * 0.075);
        }

        // direction hint (cars move clockwise; the jam moves the other way)
        if (phase >= 2) {
          p.noStroke();
          p.fill(PALETTE.fgSubtle);
          p.textSize(11);
          p.textAlign(p.CENTER, p.CENTER);
          p.text("cars →", cx, cy - 14);
          p.fill(PALETTE.jam[0], PALETTE.jam[1], PALETTE.jam[2]);
          p.text("← jam travels backward", cx, cy + 14);
        }

        // space-time stripe (phase 3): position (x) vs time (down) — the wave is a
        // diagonal because the jam drifts upstream at a steady speed.
        if (phase >= 3) {
          const sx = W - 220;
          const sy = H * 0.28;
          const sw = 180;
          const sh = 240;
          const cw = sw / ST_COLS;
          const ch = sh / ST_ROWS;
          p.noStroke();
          for (let r = 0; r < ST_ROWS; r++) {
            const srcRow = (stHead - 1 - r + ST_ROWS * 2) % ST_ROWS;
            for (let cc = 0; cc < ST_COLS; cc++) {
              const sp = stBuffer[srcRow * ST_COLS + cc];
              const col = carColor(1 - sp);
              p.fill(col[0], col[1], col[2], (0.25 + 0.75 * (1 - sp)) * 255);
              p.rect(sx + cc * cw, sy + r * ch, cw + 0.6, ch + 0.6);
            }
          }
          p.fill(PALETTE.fgSubtle);
          p.textSize(10);
          p.textAlign(p.LEFT, p.BOTTOM);
          p.text("POSITION →", sx, sy - 6);
          p.push();
          p.translate(sx - 8, sy + sh);
          p.rotate(-Math.PI / 2);
          p.text("TIME →", 0, 0);
          p.pop();
        }

        // readouts (phase 3) — minimal, mono
        if (phase >= 3) {
          const avg = n > 0 ? sumV / n : 0;
          p.textFont("Menlo, Monaco, monospace");
          p.textAlign(p.LEFT, p.TOP);
          p.textSize(12);
          p.fill(PALETTE.fgSubtle);
          p.text("AVG SPEED", 28, H - 78);
          p.text("STOPPED", 28, H - 50);
          p.fill(PALETTE.flow[0], PALETTE.flow[1], PALETTE.flow[2]);
          p.text(`${(avg * 100).toFixed(0)}%`, 130, H - 78);
          p.fill(PALETTE.jam[0], PALETTE.jam[1], PALETTE.jam[2]);
          p.text(`${n > 0 ? Math.round((jammed / n) * 100) : 0}%`, 130, H - 50);
          p.textFont("Helvetica Neue, Helvetica, Arial, sans-serif");
        }
      };
    };

    inst = new p5(sketch, container);

    const ro = new ResizeObserver(() => {
      W = container.clientWidth || W;
      H = container.clientHeight || H;
      inst?.resizeCanvas(W, H);
    });
    ro.observe(container);

    return {
      setPhase(i: number) {
        const next = Math.max(0, i);
        if (next === 0 && phase !== 0) reseed(); // scrub back to open road
        phase = next;
        eqEl.style.opacity = phase >= 1 ? "1" : "0";
      },
      setParam(key: string, value: number) {
        if (!Number.isFinite(value)) return;
        if (key === "density") {
          params.density = value;
          reseed();
        } else if (key === "sensitivity") {
          params.sensitivity = value;
        } else if (key === "vmax") {
          params.vmax = value;
        }
      },
      dispose() {
        ro.disconnect();
        inst?.remove();
        inst = null;
        if (eqEl.parentNode) eqEl.parentNode.removeChild(eqEl);
      },
    };
  },
};

export default TrafficJamSim;
