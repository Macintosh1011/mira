/**
 * signal — a literal, interactive oscilloscope that UNFOLDS like a video.
 *
 * The scope trace does not appear all at once. A single phase-gated sim clock
 * advances real elapsed time but is CAPPED at the current narration beat's
 * target window-fraction, so the trace physically draws itself across the scope
 * as the beats progress — exactly like traffic-jam's wave and epidemic's SIR
 * curve unfold WITH the narration instead of finishing instantly.
 *
 * Three real signals, switchable via the `mode` control:
 *
 *   mode 0  RC CIRCUIT     a battery→resistor→capacitor schematic; the stimulus
 *                          (current) begins flowing at beat 1, the capacitor
 *                          voltage charges then discharges on the scope:
 *                          V(t) = V₀(1 − e^{−t/RC}) then V₀ e^{−t/RC}. τ = RC
 *                          moves visibly with the R and C sliders.
 *
 *   mode 1  FOURIER        odd harmonics summed into a square wave; each faint
 *                          harmonic (blue) plus the amber partial sum, which
 *                          sharpens as `numHarmonics` rises (Gibbs ears and all).
 *
 *   mode 2  ACTION POT.    a Hodgkin–Huxley-flavoured membrane spike. A stimulus
 *                          above threshold triggers depolarize → repolarize →
 *                          hyperpolarized undershoot; below threshold it just
 *                          decays back to rest. `stimulus` is the injected knob.
 *
 * Phases (cumulative, gated):
 *   P0  bare scope (graticule + axes) + the idle circuit element. Nothing drawn.
 *   P1  governing equation appears + stimulus applied (current starts flowing);
 *       the trace is only JUST beginning — no τ / frequency / peak readouts yet.
 *   P2  the trace runs/builds live across the scope as the clock advances.
 *   P3  the readouts (τ=RC / frequency / peak) + legend resolve.
 *
 * Deterministic given (phase, params, clock). The only mutable state is the
 * phase-gated clock; identical inputs render an identical frame. dispose()
 * removes the p5 canvas + the KaTeX equation overlay and stops the loop. No
 * removed p5 APIs: every curve is sampled point-by-point with vertex().
 */
import type {
  Sim,
  SceneController,
  SimLibs,
  SceneContent,
  ControlSpec,
} from "@/lib/types";
import type { RGB } from "@/lib/kit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type P5 = any;

const MODE_RC = 0;
const MODE_FOURIER = 1;
const MODE_AP = 2;

const controls: ControlSpec[] = [
  { key: "mode", label: "Mode", min: 0, max: 2, step: 1, default: 0 },
  { key: "R", label: "Resistance", min: 0.5, max: 8, step: 0.1, default: 2, unit: "kΩ" },
  { key: "C", label: "Capacitance", min: 10, max: 200, step: 5, default: 50, unit: "µF" },
  { key: "numHarmonics", label: "Harmonics", min: 1, max: 40, step: 1, default: 5 },
  { key: "stimulus", label: "Stimulus", min: 0, max: 30, step: 0.5, default: 14, unit: "µA" },
];

// Membrane / spike constants for the action-potential mode (mV).
const AP_REST = -70;
const AP_THRESHOLD = -55;
const AP_PEAK = 40;
const AP_UNDERSHOOT = -80;
const AP_STIM_THRESHOLD = 10; // µA needed to clear threshold

// How much of the scope window the trace has filled at each beat. The clock is
// capped to this fraction, so the trace is JUST beginning at P1 and finishes
// only by the final beat — the whole point of the video-like unfold.
const PHASE_WINDOW_FRAC = [0, 0.08, 1, 1] as const;
// Seconds for the trace to sweep the full scope window once unlocked.
const SWEEP_SECONDS = 4.2;

const sim: Sim = {
  id: "signal",
  title: "Signal on a Scope",
  controls,

  create(
    container: HTMLElement,
    libs: SimLibs,
    content: SceneContent,
  ): SceneController {
    const { kit, katex } = libs;
    const { palette, ease, clamp01, lerp } = kit;

    const AMBER = palette.accent; // #efc540 — focal signal only
    const TEAL = palette.teal; // graticule / circuit components / current
    const BLUE = palette.blue; // harmonics / secondary
    const PINK = palette.pink; // threshold marker
    const MUTED = palette.fgMuted;

    // ── live, tunable state ────────────────────────────────────────────
    const params: Record<string, number> = {
      mode: content.params?.mode ?? 0,
      R: content.params?.R ?? 2,
      C: content.params?.C ?? 50,
      numHarmonics: content.params?.numHarmonics ?? 5,
      stimulus: content.params?.stimulus ?? 14,
    };
    const phaseCount = Math.max(1, content.phases.length || 4);
    let phase = 0;

    // The single phase-gated clock. `traceClock` accumulates real elapsed time
    // but only while it is below the current beat's target; it is the cause of
    // the trace building. `dressClock` runs free for cosmetic motion (the
    // flowing-current dashes) so the schematic feels alive even while paused.
    let traceClock = 0; // seconds of trace swept, capped per phase
    let dressClock = 0; // free-running, for current-flow animation
    let lastMs = 0;

    // Per-phase reveal eases (0..1), advanced toward 1 when their beat unlocks.
    // `frame` is the scope itself (always on); the rest gate strictly by beat.
    const reveals = { frame: 0, equation: 0, trace: 0, readout: 0 };

    const phaseTargetClock = (): number => {
      const f = PHASE_WINDOW_FRAC[Math.min(phase, PHASE_WINDOW_FRAC.length - 1)];
      return f * SWEEP_SECONDS;
    };

    // ── KaTeX equation overlay (single clean equation, output:"html") ──────
    const eqEl = document.createElement("div");
    eqEl.style.position = "absolute";
    eqEl.style.pointerEvents = "none";
    eqEl.style.left = "0";
    eqEl.style.top = "0";
    eqEl.style.color = `rgb(${palette.fg[0]},${palette.fg[1]},${palette.fg[2]})`;
    eqEl.style.fontSize = "17px";
    eqEl.style.opacity = "0";
    eqEl.style.transition = "opacity 160ms linear";
    eqEl.style.transformOrigin = "left top";
    eqEl.style.whiteSpace = "nowrap";
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.appendChild(eqEl);

    const EQ_RC = "V(t)=V_0\\left(1-e^{-t/RC}\\right)";
    const EQ_FOURIER =
      "f(t)=\\frac{4}{\\pi}\\sum_{k=1,3,5,\\dots}^{N}\\frac{\\sin(k\\omega t)}{k}";
    const EQ_AP =
      "C_m\\frac{dV}{dt}=I_{\\text{stim}}-\\bar g_{Na}m^3h(V-E_{Na})-\\bar g_K n^4(V-E_K)";

    let renderedEqForMode = -1;
    function renderEquation(mode: number) {
      if (mode === renderedEqForMode) return;
      renderedEqForMode = mode;
      const latex =
        mode === MODE_FOURIER
          ? EQ_FOURIER
          : mode === MODE_AP
            ? EQ_AP
            : EQ_RC;
      const src = content.equation ?? latex;
      eqEl.innerHTML = katex.renderToString(src, {
        throwOnError: false,
        output: "html",
        displayMode: false,
      });
    }

    // ── geometry (recomputed each frame; container may resize) ──────────
    function dims() {
      const W = container.clientWidth || 800;
      const H = container.clientHeight || 480;
      const scope = {
        x: W * 0.34,
        y: H * 0.26,
        w: W * 0.6,
        h: H * 0.5,
      };
      return { W, H, scope };
    }

    // ── signal models (all return normalized 0..1 points for the scope) ────
    // Each model takes a `frac` (0..1) = how much of the window is swept; it
    // returns ONLY the points up to that fraction, so the trace is genuinely
    // shorter at earlier beats (a real progressive build, not a clipped whole).
    function rcPoints(tau: number, windowS: number, frac: number, n: number) {
      const pts: { x: number; y: number }[] = [];
      const half = windowS / 2;
      const sweptT = clamp01(frac) * windowS;
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * windowS;
        if (t > sweptT) break;
        let v: number;
        if (t <= half) {
          v = 1 - Math.exp(-t / tau); // charging toward V0
        } else {
          const vAtHalf = 1 - Math.exp(-half / tau);
          v = vAtHalf * Math.exp(-(t - half) / tau); // discharging
        }
        pts.push({ x: t / windowS, y: clamp01(v) });
      }
      return pts;
    }

    // Fourier square wave from N odd harmonics; returns the partial sum + each
    // harmonic, all normalized to 0..1 with 0.5 as the zero line, sampled only
    // up to the swept fraction.
    function fourierData(
      N: number,
      cyclesInWindow: number,
      frac: number,
      n: number,
    ) {
      const odds: number[] = [];
      for (let k = 1; odds.length < N; k += 2) odds.push(k);
      // Peak is computed over the FULL window so the vertical scale is stable
      // as the trace grows (otherwise it would rescale every frame).
      let peak = 0;
      const raw: number[] = [];
      for (let i = 0; i <= n; i++) {
        const ph = (i / n) * cyclesInWindow * 2 * Math.PI;
        let s = 0;
        odds.forEach((k) => {
          s += ((4 / Math.PI) * Math.sin(k * ph)) / k;
        });
        raw.push(s);
        peak = Math.max(peak, Math.abs(s));
      }
      const scale = 0.42 / Math.max(peak, 1);
      const cut = Math.floor(clamp01(frac) * n);
      const sum: { x: number; y: number }[] = [];
      const harmonics: { x: number; y: number }[][] = odds.map(() => []);
      for (let i = 0; i <= cut; i++) {
        const x = i / n;
        sum.push({ x, y: clamp01(0.5 + raw[i] * scale) });
        const ph = (i / n) * cyclesInWindow * 2 * Math.PI;
        odds.forEach((k, hi) => {
          const term = ((4 / Math.PI) * Math.sin(k * ph)) / k;
          harmonics[hi].push({ x, y: clamp01(0.5 + term * scale) });
        });
      }
      return { sum, harmonics, odds };
    }

    // Action potential: a smooth deterministic spike triggered when stimulus
    // clears threshold; otherwise a passive sub-threshold decay. Sampled only
    // up to the swept fraction.
    function apData(stimulus: number, windowS: number, frac: number, n: number) {
      const fires = stimulus >= AP_STIM_THRESHOLD;
      const tStim = windowS * 0.18; // when the current is injected
      const yMin = AP_UNDERSHOOT - 5;
      const yMax = AP_PEAK + 10;
      const norm = (mv: number) => clamp01((mv - yMin) / (yMax - yMin));
      const sweptT = clamp01(frac) * windowS;
      const pts: { x: number; y: number }[] = [];
      let peakMv = AP_REST;
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * windowS;
        if (t > sweptT) break;
        let mv = AP_REST;
        if (t < tStim) {
          mv = AP_REST;
        } else if (fires) {
          const u = (t - tStim) / (windowS - tStim); // 0..1 over remaining window
          const rise = Math.exp(-Math.pow((u - 0.06) / 0.05, 2)); // depolarize
          const fall = Math.exp(-Math.pow((u - 0.06) / 0.16, 2)); // repolarize tail
          const under = -Math.exp(-Math.pow((u - 0.34) / 0.18, 2)); // dip
          const env = Math.max(rise, fall);
          const spike = (AP_PEAK - AP_REST) * env;
          const dip = (AP_REST - AP_UNDERSHOOT) * under;
          const foot =
            (AP_THRESHOLD - AP_REST) *
            Math.exp(-Math.pow((u - 0.0) / 0.03, 2)) *
            0.4;
          mv = AP_REST + spike + dip + foot;
        } else {
          const u = (t - tStim) / (windowS - tStim);
          const bump =
            (stimulus / AP_STIM_THRESHOLD) *
            (AP_THRESHOLD - AP_REST) *
            0.9 *
            u *
            Math.exp(1 - u * 6);
          mv = AP_REST + Math.max(0, bump);
        }
        peakMv = Math.max(peakMv, mv);
        pts.push({ x: t / windowS, y: norm(mv) });
      }
      // peakMv over the full window so the readout is stable once revealed.
      let fullPeak = AP_REST;
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * windowS;
        if (!fires) break;
        if (t < tStim) continue;
        const u = (t - tStim) / (windowS - tStim);
        const env = Math.max(
          Math.exp(-Math.pow((u - 0.06) / 0.05, 2)),
          Math.exp(-Math.pow((u - 0.06) / 0.16, 2)),
        );
        fullPeak = Math.max(fullPeak, AP_REST + (AP_PEAK - AP_REST) * env);
      }
      return { pts, fires, peakMv: fires ? fullPeak : peakMv, norm };
    }

    // ── scope-space helpers ─────────────────────────────────────────────
    function sx(scope: { x: number; w: number }, nx: number) {
      return scope.x + clamp01(nx) * scope.w;
    }
    function sy(scope: { y: number; h: number }, ny: number) {
      return scope.y + scope.h - clamp01(ny) * scope.h;
    }

    // Draw a normalized polyline manually with vertex() (no curve APIs). The
    // points are ALREADY truncated to the swept fraction, so the trace length
    // is the real build state; `alpha` only controls reveal opacity.
    function drawTrace(
      p: P5,
      scope: { x: number; y: number; w: number; h: number },
      pts: { x: number; y: number }[],
      color: RGB,
      alpha: number,
      weight: number,
    ) {
      if (pts.length < 2 || alpha <= 0.01) return;
      p.push();
      p.noFill();
      p.stroke(color[0], color[1], color[2], alpha * 255);
      p.strokeWeight(weight);
      p.strokeCap(p.ROUND);
      p.strokeJoin(p.ROUND);
      p.beginShape();
      for (let i = 0; i < pts.length; i++) {
        p.vertex(sx(scope, pts[i].x), sy(scope, pts[i].y));
      }
      p.endShape();
      p.pop();
    }

    function glowDot(p: P5, x: number, y: number, color: RGB, alpha: number) {
      if (alpha <= 0.01) return;
      p.noStroke();
      for (let i = 3; i >= 1; i--) {
        p.fill(color[0], color[1], color[2], 0.18 * (4 - i) * alpha * 255 * 0.25);
        p.circle(x, y, 6 + i * 5);
      }
      p.fill(color[0], color[1], color[2], alpha * 255);
      p.circle(x, y, 7);
    }

    function readout(
      p: P5,
      x: number,
      y: number,
      label: string,
      value: string,
      color: RGB,
      alpha: number,
    ) {
      kit.label(p, {
        x,
        y,
        text: label,
        size: 10,
        upper: true,
        mono: true,
        align: "left",
        color: MUTED,
        alpha,
      });
      kit.label(p, {
        x,
        y: y + 22,
        text: value,
        size: 22,
        mono: true,
        align: "left",
        color,
        alpha,
        weight: "bold",
      });
    }

    function legend(
      p: P5,
      x: number,
      y: number,
      items: { color: RGB; label: string }[],
      alpha: number,
    ) {
      items.forEach((it, i) => {
        const ly = y + i * 20;
        p.stroke(it.color[0], it.color[1], it.color[2], alpha * 255);
        p.strokeWeight(2);
        p.line(x, ly, x + 22, ly);
        kit.label(p, {
          x: x + 30,
          y: ly,
          text: it.label,
          size: 11,
          align: "left",
          color: MUTED,
          alpha,
        });
      });
    }

    // ── RC schematic (battery → resistor → capacitor) ───────────────────
    // `flow` = is current flowing (stimulus applied)? Gated to P1+ so the
    // element is idle at P0 and the stimulus visibly begins at the equation beat.
    function drawRcSchematic(
      p: P5,
      x: number,
      y: number,
      w: number,
      h: number,
      alpha: number,
      flow: boolean,
    ) {
      if (alpha <= 0.01) return;
      const left = x;
      const right = x + w;
      const top = y;
      const bot = y + h;
      const segs: { a: [number, number]; b: [number, number] }[] = [
        { a: [left, top], b: [right, top] },
        { a: [right, top], b: [right, bot] },
        { a: [right, bot], b: [left, bot] },
      ];
      p.push();
      p.stroke(TEAL[0], TEAL[1], TEAL[2], alpha * 0.55 * 255);
      p.strokeWeight(1.5);
      segs.forEach((s) => p.line(s.a[0], s.a[1], s.b[0], s.b[1]));

      // battery on the left wire (two plates)
      const bx = left;
      const bcy = (top + bot) / 2;
      p.line(left, top, left, bcy - 16);
      p.line(left, bcy + 16, left, bot);
      p.strokeWeight(2);
      p.line(bx - 9, bcy - 8, bx + 9, bcy - 8); // long plate (+)
      p.strokeWeight(1.5);
      p.line(bx - 5, bcy + 4, bx + 5, bcy + 4); // short plate (−)
      p.pop();

      // resistor (zigzag) on the top wire
      const rN = 7;
      const rL = right - left;
      const rx0 = left + rL * 0.32;
      const rx1 = left + rL * 0.68;
      p.push();
      p.stroke(TEAL[0], TEAL[1], TEAL[2], alpha * 255);
      p.strokeWeight(1.5);
      p.line(left + 14, top, rx0, top);
      let px = rx0;
      const seg = (rx1 - rx0) / rN;
      for (let i = 0; i < rN; i++) {
        const ny = top + (i % 2 === 0 ? -8 : 8);
        p.line(px, i === 0 ? top : top + (i % 2 === 0 ? 8 : -8), px + seg / 2, ny);
        px += seg;
      }
      p.line(px, top + (rN % 2 === 0 ? 8 : -8), rx1, top);
      p.line(rx1, top, right, top);
      p.pop();

      // capacitor (two plates) on the right wire
      const ccx = right;
      const ccy = (top + bot) / 2;
      p.push();
      p.stroke(TEAL[0], TEAL[1], TEAL[2], alpha * 255);
      p.strokeWeight(2);
      p.line(ccx - 14, ccy - 8, ccx + 14, ccy - 8);
      p.line(ccx - 14, ccy + 8, ccx + 14, ccy + 8);
      p.pop();

      kit.label(p, { x: (rx0 + rx1) / 2, y: top - 20, text: "R", size: 14, color: TEAL, alpha, weight: "bold" });
      kit.label(p, { x: ccx + 28, y: ccy, text: "C", size: 14, align: "left", color: TEAL, alpha, weight: "bold" });
      kit.label(p, { x: bx - 22, y: bcy, text: "V₀", size: 13, align: "right", color: MUTED, alpha });

      // flowing current dashes around the loop — only when the stimulus is on
      if (flow) {
        const dotCount = 26;
        const perimPts: [number, number][] = [];
        const push = (a: [number, number], b: [number, number], steps: number) => {
          for (let i = 0; i < steps; i++) {
            perimPts.push([lerp(a[0], b[0], i / steps), lerp(a[1], b[1], i / steps)]);
          }
        };
        push([left, top], [right, top], 10);
        push([right, top], [right, bot], 6);
        push([right, bot], [left, bot], 10);
        push([left, bot], [left, top], 6);
        const n = perimPts.length;
        p.noStroke();
        for (let i = 0; i < dotCount; i++) {
          const f = ((i / dotCount + dressClock * 0.18) % 1) * n;
          const idx = Math.floor(f) % n;
          const a = 0.7 * (0.4 + 0.6 * Math.sin((i / dotCount) * Math.PI));
          p.fill(AMBER[0], AMBER[1], AMBER[2], a * alpha * 255);
          p.circle(perimPts[idx][0], perimPts[idx][1], 3.4);
        }
        kit.label(p, {
          x: (left + right) / 2,
          y: bot + 16,
          text: "i(t) →",
          size: 10,
          mono: true,
          upper: true,
          color: AMBER,
          alpha,
        });
      }
    }

    // ── scope frame: teal graticule + axes (always on, P0+) ──────────────
    function drawScopeFrame(
      p: P5,
      scope: { x: number; y: number; w: number; h: number },
      xLabel: string,
    ) {
      const r = ease.outCubic(reveals.frame);
      // inner scope panel (slightly darker than paper)
      p.push();
      p.noStroke();
      p.fill(8, 8, 10, 0.9 * r * 255);
      p.rect(scope.x - 6, scope.y - 6, scope.w + 12, scope.h + 12, 6);
      p.pop();
      // fine teal graticule
      p.push();
      const cols = 10;
      const rows = 6;
      p.stroke(TEAL[0], TEAL[1], TEAL[2], 0.08 * r * 255);
      p.strokeWeight(1);
      for (let i = 1; i < cols; i++) {
        const gx = scope.x + (scope.w * i) / cols;
        p.line(gx, scope.y, gx, scope.y + scope.h);
      }
      for (let i = 1; i < rows; i++) {
        const gy = scope.y + (scope.h * i) / rows;
        p.line(scope.x, gy, scope.x + scope.w, gy);
      }
      p.pop();
      kit.axes(p, {
        x: scope.x,
        y: scope.y,
        w: scope.w,
        h: scope.h,
        reveal: reveals.frame,
        xLabel,
        yLabel: "VOLTAGE",
      });
    }

    // ── the p5 sketch ──────────────────────────────────────────────────
    const sketch = (p: P5) => {
      p.setup = () => {
        const c = p.createCanvas(
          container.clientWidth || 800,
          container.clientHeight || 480,
        );
        c.style("display", "block");
        kit.useFonts(p);
        lastMs = p.millis();
      };

      p.windowResized = () =>
        p.resizeCanvas(
          container.clientWidth || 800,
          container.clientHeight || 480,
        );

      p.draw = () => {
        const now = p.millis();
        const dt = Math.min(0.05, Math.max(0, (now - lastMs) / 1000));
        lastMs = now;
        dressClock += dt;

        // Advance the phase-gated trace clock toward (and capped at) this
        // beat's target. P0 holds it at 0 (empty scope); each later beat lets
        // it run a little (P1) or all the way (P2/P3) across the window.
        const target = phaseTargetClock();
        if (traceClock < target) {
          traceClock = Math.min(target, traceClock + dt);
        } else if (traceClock > target) {
          // scrubbing backward: snap down so the trace shortens with the beat
          traceClock = target;
        }
        const traceFrac = clamp01(traceClock / SWEEP_SECONDS);

        // Reveal eases unlock cumulatively by phase.
        const targets = {
          frame: 1, // scope is always present
          equation: phase >= 1 ? 1 : 0,
          trace: phase >= 2 ? 1 : phase >= 1 ? 0.6 : 0,
          readout: phase >= 3 ? 1 : 0,
        };
        const k = 1 - Math.pow(0.0015, dt); // frame-rate-independent approach
        reveals.frame += (targets.frame - reveals.frame) * k;
        reveals.equation += (targets.equation - reveals.equation) * k;
        reveals.trace += (targets.trace - reveals.trace) * k;
        reveals.readout += (targets.readout - reveals.readout) * k;

        const { W, H, scope } = dims();
        const mode = Math.round(params.mode);

        kit.grid(p, { reveal: 1 });

        // title + mode tag
        kit.label(p, {
          x: 28,
          y: 30,
          text: content.title ?? sim.title,
          size: 15,
          align: "left",
          color: palette.fg,
          weight: "bold",
        });
        const modeName =
          mode === MODE_FOURIER
            ? "FOURIER SYNTHESIS"
            : mode === MODE_AP
              ? "ACTION POTENTIAL"
              : "RC CIRCUIT";
        kit.label(p, {
          x: 28,
          y: 50,
          text: modeName,
          size: 10,
          upper: true,
          mono: true,
          align: "left",
          color: AMBER,
        });
        kit.phaseDots(p, {
          x: W - 28 - phaseCount * 20,
          y: 26,
          total: phaseCount,
          current: phase,
        });

        const xLabel = mode === MODE_AP ? "TIME (ms)" : "TIME";
        drawScopeFrame(p, scope, xLabel);

        // equation overlay: placed below the scope, opacity gated to P1+
        renderEquation(mode);
        eqEl.style.left = `${Math.round(scope.x)}px`;
        eqEl.style.top = `${Math.round(scope.y + scope.h + 34)}px`;
        const eqScale = Math.min(1, scope.w / 460);
        eqEl.style.transform = `scale(${eqScale.toFixed(3)})`;
        eqEl.style.opacity = `${ease.outCubic(reveals.equation).toFixed(3)}`;

        if (mode === MODE_RC) {
          drawRc(p, W, H, scope, traceFrac);
        } else if (mode === MODE_FOURIER) {
          drawFourier(p, W, H, scope, traceFrac);
        } else {
          drawAp(p, W, H, scope, traceFrac);
        }
      };

      // RC mode renderer
      function drawRc(
        p: P5,
        W: number,
        H: number,
        scope: { x: number; y: number; w: number; h: number },
        traceFrac: number,
      ) {
        const Rk = params.R; // kΩ
        const Cuf = params.C; // µF
        const tauS = Rk * 1e3 * (Cuf * 1e-6); // seconds
        const windowS = Math.max(tauS * 8, 0.4); // show ~4τ each half
        const pts = rcPoints(tauS, windowS, traceFrac, 240);

        // schematic upper-left — the idle ELEMENT shows from P0 (frame), the
        // current FLOW turns on at P1 (equation beat = stimulus applied).
        const schAlpha = ease.outCubic(reveals.frame);
        const flowing = phase >= 1;
        const sw = Math.min(W * 0.24, 220);
        const sh = Math.min(H * 0.18, 130);
        drawRcSchematic(
          p,
          28,
          Math.max(74, scope.y - sh - 10),
          sw,
          sh,
          schAlpha,
          flowing,
        );

        // V₀ dashed asymptote — part of the bare scope reference, P0+
        const r = ease.outCubic(reveals.frame);
        if (r > 0.2) {
          p.push();
          p.stroke(MUTED[0], MUTED[1], MUTED[2], 0.3 * r * 255);
          p.strokeWeight(1);
          const yInf = sy(scope, 1);
          for (let xx = scope.x; xx < scope.x + scope.w; xx += 8) {
            p.line(xx, yInf, xx + 4, yInf);
          }
          p.pop();
          kit.label(p, {
            x: scope.x + scope.w - 4,
            y: yInf - 12,
            text: "V₀",
            size: 11,
            align: "right",
            color: MUTED,
            alpha: r,
          });
        }

        // the trace itself — its LENGTH is the real build state (pts truncated)
        drawTrace(p, scope, pts, AMBER, ease.outCubic(reveals.trace), 1.5);

        // live head dot rides the leading edge of the built trace (P1+, faint)
        if (reveals.equation > 0.4 && pts.length > 1) {
          const head = pts[pts.length - 1];
          glowDot(p, sx(scope, head.x), sy(scope, head.y), AMBER, ease.outCubic(reveals.trace) * 0.9 + 0.1);
        }

        // readouts + legend — STRICTLY P3 (τ not shown before)
        const ra = ease.outCubic(reveals.readout);
        if (ra > 0.01) {
          const tauMs = tauS * 1000;
          readout(p, scope.x, scope.y - 64, "Time constant τ = RC", `${tauMs.toFixed(0)} ms`, AMBER, ra);
          readout(p, scope.x + scope.w * 0.42, scope.y - 64, "5τ to settle", `${(tauMs * 5).toFixed(0)} ms`, TEAL, ra);
          legend(
            p,
            scope.x + scope.w * 0.78,
            scope.y - 60,
            [
              { color: AMBER, label: "Capacitor V(t)" },
              { color: TEAL, label: "Current i(t)" },
            ],
            ra,
          );
        }
      }

      // Fourier mode renderer
      function drawFourier(
        p: P5,
        _W: number,
        _H: number,
        scope: { x: number; y: number; w: number; h: number },
        traceFrac: number,
      ) {
        const N = Math.round(params.numHarmonics);
        const cycles = 2;
        const { sum, harmonics, odds } = fourierData(N, cycles, traceFrac, 360);

        // zero line — bare scope reference, P0+
        const r = ease.outCubic(reveals.frame);
        if (r > 0.2) {
          p.push();
          p.stroke(MUTED[0], MUTED[1], MUTED[2], 0.25 * r * 255);
          p.strokeWeight(1);
          const y0 = sy(scope, 0.5);
          p.line(scope.x, y0, scope.x + scope.w, y0);
          p.pop();
        }

        // individual harmonics (faint blue), revealed with the equation beat
        const ha = ease.outCubic(reveals.equation) * 0.5;
        if (ha > 0.01) {
          const show = Math.min(harmonics.length, 6); // don't clutter past 6
          for (let i = 0; i < show; i++) {
            drawTrace(p, scope, harmonics[i], BLUE, ha * (1 - i / (show + 1)), 1);
          }
        }

        // partial sum (amber) — its length builds with the trace clock
        drawTrace(p, scope, sum, AMBER, ease.outCubic(reveals.trace), 1.5);

        if (reveals.equation > 0.4 && sum.length > 1) {
          const head = sum[sum.length - 1];
          glowDot(p, sx(scope, head.x), sy(scope, head.y), AMBER, ease.outCubic(reveals.trace) * 0.9 + 0.1);
        }

        // readouts — STRICTLY P3
        const ra = ease.outCubic(reveals.readout);
        if (ra > 0.01) {
          const f0 = 50; // nominal fundamental (Hz) for the readout
          readout(p, scope.x, scope.y - 64, "Harmonics summed", `${N}`, AMBER, ra);
          readout(p, scope.x + scope.w * 0.3, scope.y - 64, "Fundamental f₀", `${f0} Hz`, TEAL, ra);
          readout(p, scope.x + scope.w * 0.6, scope.y - 64, "Highest harmonic", `${odds[odds.length - 1] * f0} Hz`, BLUE, ra);
          legend(
            p,
            scope.x + scope.w * 0.82,
            scope.y - 60,
            [
              { color: AMBER, label: "Partial sum" },
              { color: BLUE, label: "Harmonics" },
            ],
            ra,
          );
        }
      }

      // Action-potential mode renderer
      function drawAp(
        p: P5,
        _W: number,
        _H: number,
        scope: { x: number; y: number; w: number; h: number },
        traceFrac: number,
      ) {
        const stim = params.stimulus;
        const windowS = 1.0; // ~10 ms scaled
        const { pts, fires, peakMv, norm } = apData(stim, windowS, traceFrac, 300);

        const r = ease.outCubic(reveals.frame);
        // threshold + rest reference lines — revealed with the equation beat
        const la = ease.outCubic(reveals.equation);
        if (la > 0.01) {
          const drawRef = (mv: number, color: RGB, txt: string) => {
            const yy = sy(scope, norm(mv));
            p.push();
            p.stroke(color[0], color[1], color[2], 0.4 * la * 255);
            p.strokeWeight(1);
            for (let xx = scope.x; xx < scope.x + scope.w; xx += 8) p.line(xx, yy, xx + 4, yy);
            p.pop();
            kit.label(p, {
              x: scope.x + 4,
              y: yy - 9,
              text: txt,
              size: 10,
              mono: true,
              align: "left",
              color,
              alpha: la,
            });
          };
          drawRef(AP_THRESHOLD, PINK, "THRESHOLD −55 mV");
          drawRef(AP_REST, MUTED, "REST −70 mV");
        }

        const traceColor = fires ? AMBER : palette.fgMuted;
        drawTrace(p, scope, pts, traceColor, ease.outCubic(reveals.trace), 1.5);

        if (reveals.equation > 0.4 && pts.length > 1) {
          const head = pts[pts.length - 1];
          glowDot(p, sx(scope, head.x), sy(scope, head.y), traceColor, ease.outCubic(reveals.trace) * 0.9 + 0.1);
        }

        // stimulus marker arrow at injection time — the stimulus applied at P1
        const sa = ease.outCubic(reveals.equation);
        if (sa > 0.01) {
          const ix = sx(scope, 0.18);
          p.push();
          p.stroke(TEAL[0], TEAL[1], TEAL[2], 0.7 * sa * 255);
          p.strokeWeight(1.5);
          p.line(ix, scope.y + scope.h, ix, scope.y + scope.h + 14);
          p.noStroke();
          p.fill(TEAL[0], TEAL[1], TEAL[2], 0.7 * sa * 255);
          p.triangle(ix - 4, scope.y + scope.h + 4, ix + 4, scope.y + scope.h + 4, ix, scope.y + scope.h - 2);
          p.pop();
          kit.label(p, { x: ix, y: scope.y + scope.h + 24, text: "STIM", size: 9, upper: true, mono: true, color: TEAL, alpha: sa });
        }
        void r;

        // readouts — STRICTLY P3
        const ra = ease.outCubic(reveals.readout);
        if (ra > 0.01) {
          readout(p, scope.x, scope.y - 64, "Peak potential", `${peakMv.toFixed(0)} mV`, fires ? AMBER : MUTED, ra);
          readout(p, scope.x + scope.w * 0.34, scope.y - 64, "Stimulus", `${stim.toFixed(1)} µA`, TEAL, ra);
          readout(p, scope.x + scope.w * 0.62, scope.y - 64, "Outcome", fires ? "SPIKE" : "SUBTHRESHOLD", fires ? AMBER : PINK, ra);
          legend(
            p,
            scope.x + scope.w * 0.84,
            scope.y - 60,
            [
              { color: AMBER, label: "Membrane V" },
              { color: PINK, label: "Threshold" },
            ],
            ra,
          );
        }
      }
    };

    const inst = new libs.p5(sketch, container);

    return {
      setPhase(n: number) {
        const next = Math.max(0, Math.min(phaseCount - 1, Math.floor(n)));
        // Scrubbing back to the bare scope resets the build so it replays.
        if (next < phase) traceClock = Math.min(traceClock, PHASE_WINDOW_FRAC[Math.min(next, PHASE_WINDOW_FRAC.length - 1)] * SWEEP_SECONDS);
        phase = next;
      },
      setParam(key: string, value: number) {
        if (!(key in params) || !Number.isFinite(value)) return;
        params[key] = value;
        // Mode switch needs a fresh equation; the trace keeps its build state.
        if (key === "mode") renderedEqForMode = -1;
      },
      dispose() {
        inst.remove();
        eqEl.remove();
      },
    };
  },
};

export default sim;
