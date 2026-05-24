import type {
  ControlSpec,
  SceneContent,
  SceneController,
  Sim,
  SimLibs,
} from "@/lib/types";
import type { P5, RGB } from "@/lib/kit/types";

/**
 * EPIDEMIC — a literal agent-based SIR contagion.
 *
 * A population of moving dots is Susceptible (teal), Infected (amber/red) or
 * Recovered (dim). Infected dots transmit to nearby susceptibles with a
 * per-contact probability; each infected recovers after a fixed duration. A
 * wave of infection sweeps the crowd, peaks, and burns out — and the classic
 * SIR curves (S, I, R counts vs time) fill in live on a kit.axes plot beside
 * the swarm. The epidemic curve EMERGING from the agents is the payoff.
 *
 * Everything is deterministic: a seeded mulberry32 PRNG drives every random
 * choice (positions, velocities, infection rolls, recovery jitter), so the same
 * sliders always produce the same outbreak. setParam re-seeds and rebuilds the
 * population live, so raising vaccination past the herd-immunity threshold
 * 1 − 1/R0 visibly flattens the curve, and raising R0 sharpens the peak.
 *
 * Contract: a registered Sim. `create` mounts a p5 instance + a KaTeX overlay
 * into `container` and returns a SceneController. The host drives setPhase on
 * the narration beat and setParam on a slider change; dispose tears it all down.
 *
 * p5 2.2.3 note: no removed APIs are used. The SIR curves are drawn through
 * kit.plotLine (which samples vertices manually), never curveVertex/curve.
 */

const S = 0;
const I = 1;
const R = 2;
type State = typeof S | typeof I | typeof R;

interface Agent {
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: State;
  /** Frames remaining infectious (counts down while I). */
  timer: number;
  /** True for the initial vaccinated/immune cohort (drawn distinctly). */
  vaccinated: boolean;
}

interface Params {
  r0: number;
  recoveryTime: number; // seconds infectious
  vaccination: number; // fraction immune at start, 0..1
  population: number;
}

const CONTROLS: ControlSpec[] = [
  { key: "r0", label: "R₀ (transmission)", min: 0.5, max: 6, step: 0.1, default: 3 },
  { key: "recoveryTime", label: "Recovery time", min: 2, max: 14, step: 0.5, default: 6, unit: "s" },
  { key: "vaccination", label: "Vaccinated", min: 0, max: 0.95, step: 0.01, default: 0 },
  { key: "population", label: "Population", min: 120, max: 800, step: 20, default: 400 },
];

const DEFAULTS: Params = {
  r0: 3,
  recoveryTime: 6,
  vaccination: 0,
  population: 400,
};

const SEED = 0x5eed1234;
const FPS = 60; // sim integrates at a fixed 60 steps/s regardless of rAF rate
const INFECT_RADIUS = 11; // px contact radius for transmission
const DOT_R = 3.4;
const HIST_CAP = 900; // recorded frames before the curve stops appending

// Deterministic PRNG (mulberry32). No p5.random anywhere in sim logic.
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

/**
 * Per-step transmission probability so the realized basic reproduction number
 * matches the R₀ slider. With the swarm density fixed, an infectious agent
 * makes ~`contactsPerStep` susceptible contacts per step over `infSteps` steps;
 * R₀ ≈ p · contactsPerStep · infSteps, so p = R₀ / (contactsPerStep · infSteps).
 * `contactsPerStep` is calibrated for this density / radius / speed so the
 * curve reads true — raise R₀ → sharper peak, raise recovery → wider wave.
 */
function transmissionProb(r0: number, infSteps: number): number {
  const contactsPerStep = 0.085;
  const p = r0 / (contactsPerStep * infSteps);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

export const epidemic: Sim = {
  id: "epidemic",
  title: "Epidemic — agent-based SIR contagion",
  controls: CONTROLS,
  create(
    container: HTMLElement,
    libs: SimLibs,
    content: SceneContent,
  ): SceneController {
    const { kit, gsap } = libs;
    const PAL = kit.palette;

    // Series colors: teal S, amber/red I, dim R.
    const C_S = PAL.teal;
    const C_I = PAL.terracotta; // amber/red infected
    const C_R = PAL.fgSubtle; // dim recovered
    const C_VAX: RGB = PAL.blue; // pre-vaccinated immune cohort reads distinct

    // ── live params (seeded from content overrides, else control defaults) ──
    const params: Params = { ...DEFAULTS };
    const ov = content.params ?? {};
    for (const c of CONTROLS) {
      const v = ov[c.key];
      params[c.key as keyof Params] =
        typeof v === "number" && Number.isFinite(v)
          ? Math.max(c.min, Math.min(c.max, v))
          : c.default;
    }

    // ── phase / clock state ───────────────────────────────────────────────
    let phase = 0;
    const phaseCount = Math.max(1, content.phases.length || 4);

    // ── simulation state ────────────────────────────────────────────────
    let agents: Agent[] = [];
    let rng = makeRng(SEED);
    let hist: { s: number; i: number; r: number }[] = [];
    let peakI = 0; // peak infected fraction observed
    let peakStep = 0;
    let stepCount = 0;
    let acc = 0; // fixed-step accumulator (ms)
    let lastMs = 0;
    let field = { x: 0, y: 0, w: 0, h: 0 };
    let plot = { x: 0, y: 0, w: 0, h: 0 };

    const recoverySteps = () => Math.max(1, Math.round(params.recoveryTime * FPS));

    // The outbreak's natural length in sim-seconds (a few generations). The sim
    // is only allowed to advance to the current beat's target, so the curve and
    // the swarm unfold WITH the narration instead of finishing all at once.
    const totalSimSeconds = () => Math.max(8, params.recoveryTime * 6.5);
    const phaseTargetSeconds = (): number => {
      const last = phaseCount - 1;
      if (phase >= last || last <= 0) return totalSimSeconds() * 1.4; // burnout
      // Back-loaded + compressed early so the growth beat reads as early spread
      // and the peak beat lands near the I-curve maximum (the tail is long).
      const frac = 0.03 + 0.37 * Math.pow(phase / Math.max(1, last - 1), 1.4);
      return totalSimSeconds() * frac;
    };

    function layout(W: number, H: number): void {
      const pad = 28;
      const split = Math.round(W * 0.55);
      field = {
        x: pad,
        y: 90,
        w: split - pad * 1.5,
        h: H - 90 - pad - 24,
      };
      const px = split + pad * 0.5;
      plot = {
        x: px + 40, // room for the rotated y-label
        y: 120,
        w: Math.max(80, W - px - pad - 48),
        h: Math.max(80, H - 120 - 96),
      };
    }

    function spawn(): void {
      rng = makeRng(SEED);
      hist = [];
      peakI = 0;
      peakStep = 0;
      stepCount = 0;
      // Hard cap regardless of the generated param so the main thread can never
      // be locked by a runaway agent count.
      const n = Math.max(60, Math.min(500, Math.round(params.population) || 400));
      const vaxCount = Math.round(n * params.vaccination);
      agents = new Array(n);
      const speed = 1.05;
      for (let k = 0; k < n; k++) {
        const ang = rng() * Math.PI * 2;
        agents[k] = {
          x: field.x + rng() * field.w,
          y: field.y + rng() * field.h,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          state: S,
          timer: 0,
          vaccinated: false,
        };
      }
      // Vaccinate the first `vaxCount` agents (deterministic ordering).
      for (let k = 0; k < vaxCount && k < n; k++) {
        agents[k].state = R;
        agents[k].vaccinated = true;
      }
      // Patient zero: the last agent (always susceptible), centered so the
      // wave radiates outward and reads cleanly.
      const pz = agents[n - 1];
      if (pz) {
        pz.state = I;
        pz.vaccinated = false;
        pz.timer = recoverySteps();
        pz.x = field.x + field.w / 2;
        pz.y = field.y + field.h / 2;
      }
      record();
    }

    function counts(): { s: number; i: number; r: number } {
      let s = 0;
      let i = 0;
      let r = 0;
      for (const a of agents) {
        if (a.state === S) s++;
        else if (a.state === I) i++;
        else r++;
      }
      return { s, i, r };
    }

    function record(): void {
      const n = agents.length || 1;
      const c = counts();
      const frac = { s: c.s / n, i: c.i / n, r: c.r / n };
      if (frac.i > peakI) {
        peakI = frac.i;
        peakStep = stepCount;
      }
      if (hist.length < HIST_CAP) hist.push(frac);
    }

    function activeInfections(): number {
      let i = 0;
      for (const a of agents) if (a.state === I) i++;
      return i;
    }

    /** One fixed sim step: move, transmit, recover. Deterministic. */
    function step(): void {
      const n = agents.length;
      if (n === 0) return;
      // Spatial hash so transmission is ~O(n) not O(n²) at 800 dots.
      const cell = INFECT_RADIUS;
      const cols = Math.max(1, Math.ceil(field.w / cell));
      const rows = Math.max(1, Math.ceil(field.h / cell));
      const buckets: number[][] = new Array(cols * rows);

      for (let k = 0; k < n; k++) {
        const a = agents[k];
        a.x += a.vx;
        a.y += a.vy;
        if (a.x < field.x) {
          a.x = field.x;
          a.vx = -a.vx;
        } else if (a.x > field.x + field.w) {
          a.x = field.x + field.w;
          a.vx = -a.vx;
        }
        if (a.y < field.y) {
          a.y = field.y;
          a.vy = -a.vy;
        } else if (a.y > field.y + field.h) {
          a.y = field.y + field.h;
          a.vy = -a.vy;
        }
        const cx = Math.min(cols - 1, Math.max(0, Math.floor((a.x - field.x) / cell)));
        const cy = Math.min(rows - 1, Math.max(0, Math.floor((a.y - field.y) / cell)));
        const bi = cy * cols + cx;
        (buckets[bi] ?? (buckets[bi] = [])).push(k);
      }

      const pInfect = transmissionProb(params.r0, recoverySteps());
      const r2 = INFECT_RADIUS * INFECT_RADIUS;
      const newlyInfected: number[] = [];

      for (let k = 0; k < n; k++) {
        const a = agents[k];
        if (a.state !== I) continue;
        const cx = Math.min(cols - 1, Math.max(0, Math.floor((a.x - field.x) / cell)));
        const cy = Math.min(rows - 1, Math.max(0, Math.floor((a.y - field.y) / cell)));
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          for (let gy = cy - 1; gy <= cy + 1; gy++) {
            if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
            const b = buckets[gy * cols + gx];
            if (!b) continue;
            for (const j of b) {
              const o = agents[j];
              if (o.state !== S) continue;
              const dx = o.x - a.x;
              const dy = o.y - a.y;
              if (dx * dx + dy * dy <= r2 && rng() < pInfect) {
                newlyInfected.push(j);
                o.state = R; // mark out of S so two infectors don't double-count
              }
            }
          }
        }
      }
      // Promote the marked agents to I with a fresh (jittered) infectious timer.
      for (const j of newlyInfected) {
        const o = agents[j];
        o.state = I;
        o.timer = recoverySteps() + Math.floor((rng() - 0.5) * recoverySteps() * 0.4);
        if (o.timer < 1) o.timer = 1;
      }
      // Recover the currently infectious.
      for (let k = 0; k < n; k++) {
        const a = agents[k];
        if (a.state === I) {
          a.timer--;
          if (a.timer <= 0) a.state = R;
        }
      }
      stepCount++;
      record();
    }

    // ── KaTeX overlay (the SIR ODEs + R₀ + herd-immunity threshold) ─────────
    const eqEl = document.createElement("div");
    Object.assign(eqEl.style, {
      position: "absolute",
      left: "0",
      right: "0",
      bottom: "12px",
      display: "flex",
      gap: "26px",
      justifyContent: "center",
      alignItems: "center",
      flexWrap: "wrap",
      pointerEvents: "none",
      color: "rgba(244,244,245,0.82)",
      fontSize: "14px",
      zIndex: "2",
      padding: "0 24px",
    } as Partial<CSSStyleDeclaration>);
    const tex = (src: string): string => {
      try {
        return libs.katex.renderToString(src, {
          throwOnError: false, output: "html",
          displayMode: false,
        });
      } catch {
        return "";
      }
    };
    const ode = content.equation
      ? content.equation
      : "\\frac{dS}{dt}=-\\frac{\\beta S I}{N}\\quad\\frac{dI}{dt}=\\frac{\\beta S I}{N}-\\gamma I\\quad\\frac{dR}{dt}=\\gamma I";
    // Reveal the math beat-by-beat: nothing at patient zero, the governing law
    // once spread begins, the herd-immunity identity only at the final beat.
    const updateEqs = (): void => {
      if (phase < 1) {
        eqEl.innerHTML = "";
        return;
      }
      const parts = [
        `<span>${tex(ode)}</span>`,
        `<span>${tex("R_0=\\frac{\\beta}{\\gamma}")}</span>`,
      ];
      if (phase >= phaseCount - 1) {
        parts.push(`<span>${tex("\\text{herd}=1-\\tfrac{1}{R_0}")}</span>`);
      }
      eqEl.innerHTML = parts.join("");
    };
    updateEqs();

    // ── p5 sketch ──────────────────────────────────────────────────────────
    const sketch = (p: P5): void => {
      p.setup = () => {
        const W = container.clientWidth || 960;
        const H = container.clientHeight || 600;
        const c = p.createCanvas(W, H);
        c.style("display", "block");
        kit.useFonts(p);
        layout(W, H);
        spawn();
        lastMs = p.millis();
      };

      p.windowResized = () => {
        const W = container.clientWidth || p.width;
        const H = container.clientHeight || p.height;
        p.resizeCanvas(W, H);
        layout(W, H);
        spawn(); // re-seed into the new field box (still deterministic)
        lastMs = p.millis();
      };

      p.draw = () => {
        // Fixed-timestep integration, decoupled from rAF rate.
        const now = p.millis();
        let dt = now - lastMs;
        lastMs = now;
        if (dt > 200) dt = 200; // clamp tab-switch hitches
        acc += dt;
        const stepMs = 1000 / FPS;
        let guard = 0;
        const stillSpreading =
          activeInfections() > 0 &&
          hist.length < HIST_CAP &&
          stepCount / FPS < phaseTargetSeconds(); // hold at the current beat
        while (acc >= stepMs && guard < 6) {
          if (stillSpreading) step();
          acc -= stepMs;
          guard++;
        }
        drawScene(p);
      };
    };

    function drawScene(p: P5): void {
      const W = p.width;
      kit.grid(p, { cell: 120, wash: C_I });

      kit.label(p, {
        x: 28,
        y: 34,
        text: content.title || epidemic.title,
        size: 17,
        weight: "bold",
        color: PAL.fg,
        align: "left",
      });
      const beat = content.phases[Math.min(phase, content.phases.length - 1)];
      if (beat) {
        kit.label(p, {
          x: 28,
          y: 56,
          text: beat.sublabel ? `${beat.label} · ${beat.sublabel}` : beat.label,
          size: 12,
          mono: true,
          upper: true,
          color: PAL.fgMuted,
          align: "left",
        });
      }
      kit.phaseDots(p, {
        x: W - 28 - phaseCount * 20,
        y: 30,
        total: phaseCount,
        current: phase,
      });

      drawSwarm(p);
      drawCurves(p);
      drawReadouts(p, W);
    }

    function drawSwarm(p: P5): void {
      p.push();
      p.noFill();
      p.stroke(255, 255, 255, 0.08 * 255);
      p.strokeWeight(1);
      p.rect(field.x - 8, field.y - 8, field.w + 16, field.h + 16, 10);
      p.pop();

      const t = p.frameCount * 0.02;
      p.noStroke();
      // Draw S, then R, then I last so infected sit on top and read hot.
      for (const ord of [S, R, I] as State[]) {
        for (const a of agents) {
          if (a.state !== ord) continue;
          if (a.state === S) {
            kit.fill(p, C_S, 0.85);
            p.circle(a.x, a.y, DOT_R * 2);
          } else if (a.state === R) {
            kit.fill(p, a.vaccinated ? C_VAX : C_R, a.vaccinated ? 0.5 : 0.42);
            p.circle(a.x, a.y, DOT_R * 1.7);
          } else {
            kit.fill(p, C_I, 0.1); // soft contact-radius halo
            p.circle(a.x, a.y, INFECT_RADIUS * 2);
            kit.fill(p, C_I, 1);
            p.circle(a.x, a.y, DOT_R * 2.2);
          }
        }
      }
      // Pulse the patient-zero front during the early growth beat.
      if (activeInfections() > 0 && stepCount < 60) {
        const pz = agents[agents.length - 1];
        if (pz && pz.state === I) {
          const pr = (Math.sin(t * 3) * 0.5 + 0.5) * 14 + INFECT_RADIUS;
          p.noFill();
          kit.stroke(p, C_I, 0.5, 1.5);
          p.circle(pz.x, pz.y, pr * 2);
        }
      }
    }

    function drawCurves(p: P5): void {
      kit.axes(p, {
        x: plot.x,
        y: plot.y,
        w: plot.w,
        h: plot.h,
        xLabel: "time",
        yLabel: "share of population",
      });

      if (hist.length >= 2) {
        // Map history (fractions over recorded frames) into plot-normalized
        // points. x normalized by a stable denom so the curve grows L→R.
        const denom = Math.max(hist.length - 1, HIST_CAP * 0.18);
        const sPts: { x: number; y: number }[] = [];
        const iPts: { x: number; y: number }[] = [];
        const rPts: { x: number; y: number }[] = [];
        const stride = Math.max(1, Math.floor(hist.length / 220));
        for (let k = 0; k < hist.length; k += stride) {
          const nx = k / denom;
          sPts.push({ x: nx, y: hist[k].s });
          iPts.push({ x: nx, y: hist[k].i });
          rPts.push({ x: nx, y: hist[k].r });
        }
        const lastK = hist.length - 1;
        const lx = lastK / denom;
        sPts.push({ x: lx, y: hist[lastK].s });
        iPts.push({ x: lx, y: hist[lastK].i });
        rPts.push({ x: lx, y: hist[lastK].r });

        // Drawn fully (t=1); the live fill comes from appending points.
        kit.plotLine(p, { ...plot, points: rPts, t: 1, color: C_R, head: false });
        kit.plotLine(p, { ...plot, points: sPts, t: 1, color: C_S, head: false });
        kit.plotLine(p, { ...plot, points: iPts, t: 1, color: C_I, head: true });

        if (phase >= 2 && peakI > 0.01) {
          const px = plot.x + kit.clamp01(peakStep / denom) * plot.w;
          const py = plot.y + plot.h - kit.clamp01(peakI) * plot.h;
          p.push();
          p.drawingContext.setLineDash([3, 4]);
          kit.stroke(p, C_I, 0.4, 1);
          p.line(px, py, px, plot.y + plot.h);
          p.drawingContext.setLineDash([]);
          p.pop();
          kit.label(p, {
            x: px,
            y: py - 12,
            text: `peak ${(peakI * 100).toFixed(0)}%`,
            size: 10,
            mono: true,
            color: C_I,
          });
        }
      }

      // Series legend.
      const lx0 = plot.x + 6;
      let ly = plot.y + 6;
      const leg = (col: RGB, txt: string) => {
        p.noStroke();
        kit.fill(p, col, 1);
        p.circle(lx0, ly, 7);
        kit.label(p, { x: lx0 + 12, y: ly, text: txt, size: 11, mono: true, color: PAL.fgMuted, align: "left" });
        ly += 16;
      };
      leg(C_S, "S susceptible");
      leg(C_I, "I infected");
      leg(C_R, "R recovered");
    }

    function drawReadouts(p: P5, W: number): void {
      const c = counts();
      const n = agents.length || 1;
      const herd = params.r0 > 1 ? 1 - 1 / params.r0 : 0;
      const protectedNow = params.vaccination >= herd && herd > 0;
      // Reveal readouts beat-by-beat: live S/I/R + R₀ from the start, the peak
      // only once we're at the peak beat, the herd threshold only at the end.
      const cards: { label: string; value: string; color: RGB }[] = [
        { label: "S", value: String(c.s), color: C_S },
        { label: "I", value: String(c.i), color: C_I },
        { label: "R", value: String(c.r), color: C_R },
        { label: "R₀", value: params.r0.toFixed(1), color: PAL.accent },
      ];
      if (phase >= 2) {
        cards.push({ label: "peak I", value: `${(peakI * 100).toFixed(0)}%`, color: C_I });
      }
      if (phase >= phaseCount - 1) {
        cards.push({
          label: "herd thr",
          value: `${(herd * 100).toFixed(0)}%`,
          color: protectedNow ? C_S : PAL.fgMuted,
        });
      }
      const cw = 78;
      const startX = W - 28 - cards.length * cw;
      const y = 60;
      cards.forEach((card, k) => {
        const cx = startX + k * cw;
        kit.label(p, {
          x: cx,
          y,
          text: card.label,
          size: 10,
          mono: true,
          upper: true,
          color: PAL.fgMuted,
          align: "left",
        });
        kit.label(p, {
          x: cx,
          y: y + 20,
          text: card.value,
          size: 22,
          mono: true,
          weight: "bold",
          color: card.color,
          align: "left",
        });
      });

      // Herd-immunity banner: the payoff of the vaccination slider.
      const done = activeInfections() === 0 && stepCount > 0;
      const finalBeat = phase >= phaseCount - 1;
      if (finalBeat && protectedNow) {
        kit.label(p, {
          x: field.x,
          y: field.y + field.h + 18,
          text:
            done && peakI < params.vaccination + 0.06
              ? `HERD IMMUNITY — vaccinated ${(params.vaccination * 100).toFixed(0)}% > threshold ${(herd * 100).toFixed(0)}%, outbreak contained`
              : `Vaccinated ${(params.vaccination * 100).toFixed(0)}% clears the ${(herd * 100).toFixed(0)}% threshold`,
          size: 12,
          mono: true,
          color: C_S,
          align: "left",
        });
      } else if (finalBeat && done) {
        const attack =
          (c.r / n - params.vaccination) / Math.max(1e-6, 1 - params.vaccination);
        kit.label(p, {
          x: field.x,
          y: field.y + field.h + 18,
          text: `Burnout — ${(kit.clamp01(attack) * 100).toFixed(0)}% of the susceptible pool was infected`,
          size: 12,
          mono: true,
          color: PAL.fgMuted,
          align: "left",
        });
      }
    }

    const inst = new libs.p5(sketch, container);
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.appendChild(eqEl);
    gsap.fromTo(
      eqEl,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" },
    );

    return {
      setPhase: (n: number) => {
        phase = Math.max(0, Math.min(phaseCount - 1, Math.floor(n)));
        updateEqs();
      },
      setParam: (key: string, value: number) => {
        if (!(key in params) || !Number.isFinite(value)) return;
        const ctl = CONTROLS.find((c) => c.key === key);
        params[key as keyof Params] = ctl
          ? Math.max(ctl.min, Math.min(ctl.max, value))
          : value;
        // Any knob change restarts the deterministic outbreak from patient zero
        // so the user sees the full new wave (flattened / sharpened) at once.
        spawn();
        acc = 0;
      },
      dispose: () => {
        gsap.killTweensOf(eqEl);
        eqEl.remove();
        inst.remove();
        agents = [];
        hist = [];
      },
    };
  },
};

export default epidemic;
