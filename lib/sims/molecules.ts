/**
 * molecules — a literal, interactive chemical-reaction simulation.
 *
 * The reaction modeled is the canonical combustion of hydrogen:
 *
 *     2 H₂ + O₂  →  2 H₂O          ΔH < 0 (exothermic)
 *
 * Reactant molecules (H₂ = two teal H atoms on a bond, O₂ = two red O atoms on
 * a bond) drift and vibrate in a box, bouncing elastically off the walls and
 * off each other. When an H₂ and an O₂ collide with relative kinetic energy
 * above the activation barrier Eₐ, the O₂ bond breaks into reactive O radicals
 * (the transition state); each O radical that then meets an H₂ above a small
 * barrier forms a bent H₂O molecule. Collisions below the barrier just bounce —
 * shown as a brief terracotta "no-reaction" spark; successful ones flash accent.
 * The catalyst slider lowers Eₐ (the hump), temperature raises the mean
 * collision energy, concentration adds molecules. All three visibly change how
 * fast product builds up.
 *
 * The scene unfolds like a video — nothing is shown all at once. Each beat
 * gates the physics clock AND the annotations, exactly mirroring traffic-jam.ts
 * and epidemic.ts:
 *
 *   P0  bare reactants drifting + vibrating in the box. The reaction clock is
 *       frozen for products — molecules just bounce. No collision highlight,
 *       no energy diagram, no equation, no plot, no readouts.
 *   P1  the activation event: the first H₂+O₂ collision that clears the barrier
 *       is found and held under a pulsing amber ring ("activated complex"). Still
 *       NO products, NO energy diagram, NO equation, NO plot.
 *   P2  bonds break and reform — reactions now fire, H₂O builds, and the live
 *       concentration curves fill in. Energy diagram + equation still hidden.
 *   P3  the energy-vs-reaction-coordinate diagram (Eₐ hump + ΔH drop labeled),
 *       the balanced equation + the Arrhenius rate law k = A·e^(−Eₐ/RT) (KaTeX
 *       overlay), and the readouts (T, rate k, % converted, catalyst).
 *
 * Contract: default-exports a `Sim` (id "molecules"). `create` mounts a p5
 * instance, runs its own deterministic physics, and returns a SceneController.
 * setPhase gates which physics/overlays/annotations are live (reactants →
 * activation → rearrangement → products+diagram); setParam tunes temperature /
 * concentration / catalyst live; dispose tears down p5 + the KaTeX overlay node.
 * Deterministic: a seeded PRNG drives all placement/velocity and physics
 * advances on a fixed dt, so the same inputs reproduce the same run.
 *
 * p5 2.x safe: uses only createCanvas/background/push/pop/translate/scale/rotate/
 * circle/line/rect/triangle/beginShape+vertex/endShape/text/fill/stroke. No
 * removed APIs (curve/quadraticVertex/etc.) — curves are sampled manually.
 */
import type {
  ControlSpec,
  SceneContent,
  SceneController,
  Sim,
  SimLibs,
} from "@/lib/types";
import type { RGB } from "@/lib/kit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type P5 = any;

// ── tunable knobs (one slider each) ───────────────────────────────────────
const CONTROLS: ControlSpec[] = [
  { key: "temperature", label: "Temperature", min: 300, max: 1500, step: 10, default: 600, unit: "K" },
  { key: "concentration", label: "Concentration", min: 0.4, max: 2, step: 0.1, default: 1, unit: "×" },
  { key: "catalyst", label: "Catalyst", min: 0, max: 1, step: 0.05, default: 0, unit: "" },
];

// ── chemistry constants (scaled to read well on screen, not SI) ────────────
const EA_BASE = 1.0; // bare activation barrier (hump height above reactants)
const EA_FLOOR = 0.32; // barrier a full catalyst cannot push below
const DH = -0.62; // reaction enthalpy (products sit this far below reactants)
const O_RADICAL_BARRIER = 0.18; // small barrier for O• + H₂ → H₂O
const R_GAS = 0.55; // gas-constant analogue so k spans a nice range over T
const ARRHENIUS_A = 12; // pre-exponential factor for the rate readout
const REACTION_COORD = 0.42; // where the transition-state peak sits along x

// ── deterministic PRNG (mulberry32) ────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── molecule model ──────────────────────────────────────────────────────
type Kind = "H2" | "O2" | "O" | "H2O";

interface Mol {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ang: number;
  spin: number;
  phase: number; // vibration phase offset
  alive: boolean;
  born: number; // sim-time it appeared (drives a brief reveal pop)
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Spark {
  x: number;
  y: number;
  t: number; // 0..1 life remaining
  reacted: boolean; // true = successful (accent flash), false = bounce (warn)
}

// The single collision frozen under the spotlight at P1 (the activation event):
// the midpoint of the first H₂+O₂ pair that clears the barrier. Held until the
// reaction is allowed to actually fire (P2), where it converts into products.
interface Activation {
  x: number;
  y: number;
  found: boolean;
}

const sim: Sim = {
  id: "molecules",
  title: "Reaction Kinetics",
  controls: CONTROLS,
  create(
    container: HTMLElement,
    libs: SimLibs,
    content: SceneContent,
  ): SceneController {
    const kit = libs.kit;
    const { palette, ease } = kit;

    // Element colors — within Mira palette discipline.
    const C_H: RGB = palette.teal; // hydrogen → teal
    const C_O: RGB = palette.deepRed; // oxygen → deep red
    const C_BOND: RGB = palette.fgMuted; // bonds → muted gray hairline
    const C_PRODUCT: RGB = palette.blue; // H₂O oxygen tinted blue
    const C_ACCENT: RGB = palette.accent; // active / reaction flash
    const C_WARN: RGB = palette.terracotta; // bounced collision

    // ── design space ──────────────────────────────────────────────────────
    const VW = 1600;
    const VH = 900;

    // Live parameters (seeded from content overrides, else control defaults).
    const params: Record<string, number> = {};
    for (const c of CONTROLS) params[c.key] = content.params?.[c.key] ?? c.default;

    let phase = 0;
    const totalPhases = Math.max(4, content.phases?.length ?? 4);
    const phaseSub = (i: number): string =>
      (content.phases?.[i]?.sublabel ?? content.phases?.[i]?.label ?? "").toString();

    // ── reaction box layout (left ~55% of the design space) ────────────────
    const box: Box = { x: 90, y: 150, w: 820, h: 660 };

    const R_H = 13;
    const R_O = 22;
    const BOND_H2 = 30; // H–H separation
    const BOND_O2 = 50; // O–O separation
    const BOND_OH = 34; // O–H separation in water

    // ── deterministic world ────────────────────────────────────────────────
    let rng = mulberry32(0x5eed1234);
    let mols: Mol[] = [];
    const sparks: Spark[] = [];
    const activation: Activation = { x: 0, y: 0, found: false };
    let activationPulse = 0; // sim-time the activation was first highlighted

    let history: { t: number; h2: number; o2: number; h2o: number }[] = [];
    let initialReactant = 1; // H₂ count at t=0 (conversion + plot scaling)
    let simTime = 0;
    let lastSample = 0;
    let reactionCount = 0; // total H₂O molecules formed
    let rateEMA = 0; // rolling H₂O-per-second estimate
    let diagramOpenedAt = -1; // sim-time the P3 energy diagram first drew on

    function speedForT(): number {
      // mean molecular speed ∝ sqrt(T) (kinetic theory feel)
      return 0.9 + Math.sqrt(params.temperature / 600) * 1.7;
    }

    function spawnReactants(): void {
      // Re-seed the PRNG so the run is reproducible across every (re)spawn —
      // including scrubbing the phase back to the start.
      rng = mulberry32(0x5eed1234);
      mols = [];
      history = [];
      sparks.length = 0;
      activation.found = false;
      activationPulse = 0;
      diagramOpenedAt = -1;
      simTime = 0;
      lastSample = 0;
      reactionCount = 0;
      rateEMA = 0;
      const conc = params.concentration;
      const nH2 = Math.round(14 * conc); // 2:1 H₂:O₂ stoichiometry
      const nO2 = Math.round(7 * conc);
      initialReactant = nH2;
      const place = (kind: Kind): Mol => {
        const pad = kind === "O2" ? R_O + BOND_O2 / 2 : R_H + BOND_H2 / 2;
        return {
          kind,
          x: box.x + pad + rng() * (box.w - 2 * pad),
          y: box.y + pad + rng() * (box.h - 2 * pad),
          vx: (rng() - 0.5) * 2,
          vy: (rng() - 0.5) * 2,
          ang: rng() * Math.PI * 2,
          spin: (rng() - 0.5) * 0.04,
          phase: rng() * Math.PI * 2,
          alive: true,
          born: 0,
        };
      };
      for (let i = 0; i < nH2; i++) mols.push(place("H2"));
      for (let i = 0; i < nO2; i++) mols.push(place("O2"));
      retemperature();
    }

    function retemperature(): void {
      const target = speedForT();
      for (const m of mols) {
        if (!m.alive) continue;
        const sp = Math.hypot(m.vx, m.vy) || 0.001;
        const scale = target / sp;
        m.vx *= scale;
        m.vy *= scale;
      }
    }

    // Activation barrier, lowered by the catalyst (never below the floor).
    function activationEnergy(): number {
      return Math.max(EA_FLOOR, EA_BASE - params.catalyst * (EA_BASE - EA_FLOOR));
    }

    // Arrhenius rate constant k = A·e^(−Eₐ/RT), in the sim's energy units.
    function arrheniusK(): number {
      const ea = activationEnergy();
      return ARRHENIUS_A * Math.exp(-ea / (R_GAS * (params.temperature / 600)));
    }

    function radiusOf(m: Mol): number {
      if (m.kind === "O2") return R_O + BOND_O2 / 2;
      if (m.kind === "O") return R_O;
      if (m.kind === "H2O") return R_O + BOND_OH * 0.5;
      return R_H + BOND_H2 / 2; // H2
    }

    function massOf(m: Mol): number {
      if (m.kind === "H2") return 2;
      if (m.kind === "O2") return 32;
      if (m.kind === "O") return 16;
      return 18; // H2O
    }

    // ── physics step (fixed dt) ─────────────────────────────────────────────
    const DT = 1 / 60;

    type PairKind = "H2_O2" | "H2_O" | null;
    function pairKind(a: Kind, b: Kind): PairKind {
      if ((a === "H2" && b === "O2") || (a === "O2" && b === "H2")) return "H2_O2";
      if ((a === "H2" && b === "O") || (a === "O" && b === "H2")) return "H2_O";
      return null;
    }

    function morphTo(m: Mol, kind: Kind, x: number, y: number): void {
      m.kind = kind;
      m.x = x;
      m.y = y;
      m.born = simTime;
      // fresh thermal velocity (exothermic kick on newly formed water)
      const sp = speedForT() * (kind === "H2O" ? 1.25 : 1);
      const a = rng() * Math.PI * 2;
      m.vx = Math.cos(a) * sp;
      m.vy = Math.sin(a) * sp;
      m.spin = (rng() - 0.5) * 0.05;
    }

    // Apply a successful reaction. Returns true if it consumed the pair.
    function reactProduct(a: Mol, b: Mol, pair: PairKind): boolean {
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      if (pair === "H2_O2") {
        // energetic O₂ + H₂ → one H₂O forms now + one reactive O• spins off
        const o2 = a.kind === "O2" ? a : b;
        const h2 = a.kind === "O2" ? b : a;
        morphTo(o2, "H2O", cx - 18, cy);
        morphTo(h2, "O", cx + 28, cy);
        reactionCount++;
        sparks.push({ x: cx, y: cy, t: 1, reacted: true });
        return true;
      }
      if (pair === "H2_O") {
        // O• + H₂ → H₂O ; the H₂ partner is consumed into the new water
        const o = a.kind === "O" ? a : b;
        const h2 = a.kind === "O" ? b : a;
        morphTo(o, "H2O", cx, cy);
        h2.alive = false;
        reactionCount++;
        sparks.push({ x: cx, y: cy, t: 1, reacted: true });
        return true;
      }
      return false;
    }

    function counts(): { H2: number; O2: number; O: number; H2O: number } {
      const c = { H2: 0, O2: 0, O: 0, H2O: 0 };
      for (const m of mols) if (m.alive) c[m.kind]++;
      return c;
    }

    function step(): void {
      // P0: nothing reacts (bare reactants drift). P1: collisions are TESTED so
      // we can spotlight the first activated complex, but none are consumed —
      // products only form once bonds are allowed to break at P2.
      const reactive = phase >= 2;
      const seeking = phase >= 1; // P1 hunts for the activation event
      const ea = activationEnergy();

      // integrate motion + wall bounce
      for (const m of mols) {
        if (!m.alive) continue;
        m.x += m.vx;
        m.y += m.vy;
        m.ang += m.spin;
        const r = radiusOf(m);
        if (m.x < box.x + r) {
          m.x = box.x + r;
          m.vx = Math.abs(m.vx);
        } else if (m.x > box.x + box.w - r) {
          m.x = box.x + box.w - r;
          m.vx = -Math.abs(m.vx);
        }
        if (m.y < box.y + r) {
          m.y = box.y + r;
          m.vy = Math.abs(m.vy);
        } else if (m.y > box.y + box.h - r) {
          m.y = box.y + box.h - r;
          m.vy = -Math.abs(m.vy);
        }
      }

      // pairwise collisions (O(n²) — n is small, ~30 molecules)
      for (let i = 0; i < mols.length; i++) {
        const a = mols[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < mols.length; j++) {
          const b = mols[j];
          if (!b.alive) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          const minD = radiusOf(a) + radiusOf(b);
          if (dist >= minD || dist === 0) continue;

          const nx = dx / dist;
          const ny = dy / dist;
          const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;

          const pair = pairKind(a.kind, b.kind);
          let reacted = false;
          if (seeking && pair && rel < 0) {
            const ke = 0.5 * rel * rel * 0.18; // collision energy ∝ rel speed²
            const barrier = pair === "H2_O2" ? ea : O_RADICAL_BARRIER;
            const overBarrier = ke >= barrier;
            if (reactive && overBarrier) {
              // P2+: bonds break — the pair reacts into products.
              reacted = reactProduct(a, b, pair);
            } else if (!reactive && overBarrier && !activation.found && pair === "H2_O2") {
              // P1: spotlight the FIRST H₂+O₂ collision that clears the barrier
              // as the activation event. Freeze its location; do NOT consume the
              // molecules — they bounce so the moment reads as a held instant.
              activation.x = (a.x + b.x) / 2;
              activation.y = (a.y + b.y) / 2;
              activation.found = true;
              activationPulse = simTime;
            } else if (reactive && !overBarrier) {
              // approached fast enough to test but bounced off the barrier
              sparks.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: 1, reacted: false });
            }
          }

          if (!reacted) {
            if (rel < 0) {
              const m1 = massOf(a);
              const m2 = massOf(b);
              const imp = (2 * rel) / (m1 + m2);
              a.vx -= imp * m2 * nx;
              a.vy -= imp * m2 * ny;
              b.vx += imp * m1 * nx;
              b.vy += imp * m1 * ny;
            }
            const overlap = (minD - dist) / 2;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;
          }
        }
      }

      // cull dead molecules once per simulated second
      if (Math.floor(simTime + DT) > Math.floor(simTime)) {
        mols = mols.filter((m) => m.alive);
      }

      // decay sparks
      for (const s of sparks) s.t -= DT * 2.2;
      for (let k = sparks.length - 1; k >= 0; k--) if (sparks[k].t <= 0) sparks.splice(k, 1);

      simTime += DT;

      // Concentrations only start recording once products can form (P2+), so the
      // plot fills in WITH the rearrangement beat instead of pre-existing at P0.
      if (phase < 2) return;

      // sample concentrations ~4×/sec
      if (simTime - lastSample >= 0.25) {
        lastSample = simTime;
        const c = counts();
        const prevH2o = history.length ? history[history.length - 1].h2o : 0;
        history.push({ t: simTime, h2: c.H2, o2: c.O2, h2o: c.H2O });
        if (history.length > 240) history.shift();
        const inst = (c.H2O - prevH2o) / 0.25;
        rateEMA = rateEMA * 0.7 + inst * 0.3;
      }
    }

    // ── drawing helpers ─────────────────────────────────────────────────────
    function atom(p: P5, x: number, y: number, r: number, c: RGB, glow: number): void {
      if (glow > 0) {
        p.noStroke();
        for (let i = 3; i >= 1; i--) {
          const f = i / 3;
          p.fill(c[0], c[1], c[2], glow * 0.16 * (1 - f) * 255);
          p.circle(x, y, r * 2 + f * r * 2.2);
        }
      }
      p.noStroke();
      p.fill(c[0], c[1], c[2], 255);
      p.circle(x, y, r * 2);
      // tiny highlight for volume
      p.fill(255, 255, 255, 0.14 * 255);
      p.circle(x - r * 0.28, y - r * 0.3, r * 0.7);
    }

    function bond(p: P5, x1: number, y1: number, x2: number, y2: number, alpha: number): void {
      p.stroke(C_BOND[0], C_BOND[1], C_BOND[2], alpha * 255);
      p.strokeWeight(1.5);
      p.line(x1, y1, x2, y2);
    }

    function drawMolecule(p: P5, m: Mol): void {
      const reveal = ease.outCubic(Math.min(1, (simTime - m.born) / 0.35));
      const vib = Math.sin(simTime * 9 + m.phase) * 2.2; // bond vibration
      const ca = Math.cos(m.ang);
      const sa = Math.sin(m.ang);
      if (m.kind === "H2") {
        const half = (BOND_H2 / 2 + vib) * reveal;
        const x1 = m.x - ca * half;
        const y1 = m.y - sa * half;
        const x2 = m.x + ca * half;
        const y2 = m.y + sa * half;
        bond(p, x1, y1, x2, y2, 0.55 * reveal);
        atom(p, x1, y1, R_H * reveal, C_H, 0);
        atom(p, x2, y2, R_H * reveal, C_H, 0);
      } else if (m.kind === "O2") {
        const half = (BOND_O2 / 2 + vib) * reveal;
        const x1 = m.x - ca * half;
        const y1 = m.y - sa * half;
        const x2 = m.x + ca * half;
        const y2 = m.y + sa * half;
        // double-bond hint: two parallel hairlines
        const px = -sa * 4;
        const py = ca * 4;
        bond(p, x1 + px, y1 + py, x2 + px, y2 + py, 0.5 * reveal);
        bond(p, x1 - px, y1 - py, x2 - px, y2 - py, 0.5 * reveal);
        atom(p, x1, y1, R_O * reveal, C_O, 0);
        atom(p, x2, y2, R_O * reveal, C_O, 0);
      } else if (m.kind === "O") {
        // reactive radical — accent ring + glow
        atom(p, m.x, m.y, R_O * reveal, C_O, 0.7);
        p.noFill();
        p.stroke(C_ACCENT[0], C_ACCENT[1], C_ACCENT[2], 0.6 * 255 * reveal);
        p.strokeWeight(1.5);
        p.circle(m.x, m.y, R_O * 2.6);
      } else {
        // H₂O — bent molecule (HOH ≈ 104.5°). O at center, two H off-axis.
        const a1 = m.ang - 0.91;
        const a2 = m.ang + 0.91;
        const d = (BOND_OH + vib) * reveal;
        const hx1 = m.x + Math.cos(a1) * d;
        const hy1 = m.y + Math.sin(a1) * d;
        const hx2 = m.x + Math.cos(a2) * d;
        const hy2 = m.y + Math.sin(a2) * d;
        bond(p, m.x, m.y, hx1, hy1, 0.55 * reveal);
        bond(p, m.x, m.y, hx2, hy2, 0.55 * reveal);
        atom(p, m.x, m.y, R_O * reveal, C_PRODUCT, phase >= 3 ? 0.3 : 0);
        atom(p, hx1, hy1, R_H * reveal, C_H, 0);
        atom(p, hx2, hy2, R_H * reveal, C_H, 0);
      }
    }

    // Energy-vs-reaction-coordinate curve in DATA space (x 0..1, y energy).
    function energyCurve(): { x: number; y: number }[] {
      const ea = activationEnergy();
      const pts: { x: number; y: number }[] = [];
      const n = 60;
      for (let i = 0; i <= n; i++) {
        const x = i / n;
        let y: number;
        if (x <= REACTION_COORD) {
          y = ea * ease.smoothstep(x / REACTION_COORD);
        } else {
          const u = (x - REACTION_COORD) / (1 - REACTION_COORD);
          y = ea + (DH - ea) * ease.smoothstep(u);
        }
        pts.push({ x, y });
      }
      return pts;
    }

    // ── KaTeX overlay (balanced equation + Arrhenius rate) ──────────────────
    // Built directly from libs.katex (always injected) — independent of any
    // optional kit.equation helper that may not be registered in this build.
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;";
    const eqEl = document.createElement("div");
    eqEl.style.cssText =
      "position:absolute;color:#f4f4f5;font-size:20px;text-align:left;transform-origin:left top;opacity:0;transition:opacity .45s cubic-bezier(0.16,1,0.3,1);";
    const rateEl = document.createElement("div");
    rateEl.style.cssText =
      "position:absolute;color:#a1a1aa;font-size:15px;text-align:left;transform-origin:left top;opacity:0;transition:opacity .45s cubic-bezier(0.16,1,0.3,1);";
    overlay.appendChild(eqEl);
    overlay.appendChild(rateEl);
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.appendChild(overlay);

    const balancedEq = content.equation ?? "2\\,H_2 + O_2 \\;\\longrightarrow\\; 2\\,H_2O";
    try {
      eqEl.innerHTML = libs.katex.renderToString(balancedEq, {
        throwOnError: false, output: "html",
        displayMode: true,
      });
      rateEl.innerHTML = libs.katex.renderToString("k = A\\,e^{-E_a / RT}", {
        throwOnError: false, output: "html",
        displayMode: true,
      });
    } catch {
      eqEl.textContent = "2 H2 + O2 -> 2 H2O";
      rateEl.textContent = "k = A e^(-Ea/RT)";
    }

    function placeOverlay(scale: number, ox: number, oy: number): void {
      const ex = ox + 1010 * scale;
      eqEl.style.transform = `translate(${ex}px, ${oy + 86 * scale}px) scale(${scale})`;
      rateEl.style.transform = `translate(${ex}px, ${oy + 134 * scale}px) scale(${scale})`;
    }

    // ── right-panel: energy diagram + concentration plot + readouts ─────────
    function drawAxes(
      p: P5,
      x: number,
      y: number,
      w: number,
      h: number,
      xl: string,
      yl: string,
    ): void {
      p.push();
      p.stroke(255, 255, 255, 0.05 * 255);
      p.strokeWeight(1);
      for (let i = 1; i <= 4; i++) p.line(x, y + (h * i) / 4, x + w, y + (h * i) / 4);
      p.stroke(255, 255, 255, 0.16 * 255);
      p.strokeWeight(1.5);
      p.strokeCap(p.ROUND);
      p.line(x, y, x, y + h);
      p.line(x, y + h, x + w, y + h);
      p.pop();
      kit.label(p, { x: x + w / 2, y: y + h + 20, text: xl, size: 10, upper: true, mono: true, color: palette.fgMuted });
      p.push();
      p.translate(x - 26, y + h / 2);
      p.rotate(-Math.PI / 2);
      kit.label(p, { x: 0, y: 0, text: yl, size: 10, upper: true, mono: true, color: palette.fgMuted });
      p.pop();
    }

    function dash(
      p: P5,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      color: RGB,
      alpha: number,
    ): void {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ux = (x2 - x1) / (len || 1);
      const uy = (y2 - y1) / (len || 1);
      p.stroke(color[0], color[1], color[2], alpha * 255);
      p.strokeWeight(1);
      for (let d = 0; d < len; d += 11) {
        const e = Math.min(len, d + 6);
        p.line(x1 + ux * d, y1 + uy * d, x1 + ux * e, y1 + uy * e);
      }
    }

    function readout(
      p: P5,
      x: number,
      y: number,
      cap: string,
      value: string,
      unit: string,
      color: RGB,
    ): void {
      kit.label(p, { x, y: y - 18, text: cap, size: 10, upper: true, mono: true, color: palette.fgMuted, align: "left" });
      kit.label(p, { x, y, text: value + unit, size: 23, mono: true, weight: "bold", color, align: "left" });
    }

    function legendRow(p: P5, x: number, y: number, color: RGB, txt: string): void {
      p.noStroke();
      p.fill(color[0], color[1], color[2], 255);
      p.circle(x, y, 7);
      kit.label(p, { x: x + 8, y, text: txt, size: 11, mono: true, color: palette.fgMuted, align: "left" });
    }

    // The right panel is gated by beat, so the technical story arrives in order:
    //   P0/P1 — empty (focus stays on the molecules and the activation event).
    //   P2    — only the live concentration plot (concentrations begin shifting).
    //   P3    — energy diagram (Eₐ hump + ΔH) + readouts join the plot.
    function drawPanel(p: P5): void {
      if (phase < 2) return;
      const px = 1010;
      const panelW = 510;

      kit.label(p, {
        x: px,
        y: 64,
        text: phase >= 3 ? "Reaction energetics" : "Concentrations",
        size: 16,
        weight: "bold",
        color: palette.fg,
        align: "left",
      });

      // ENERGY DIAGRAM (P3 only) ────────────────────────────────────────────
      if (phase >= 3) {
        const exX = px;
        const exY = 200;
        const exW = panelW;
        const exH = 170;
        const ea = activationEnergy();
        const curve = energyCurve();
        const yMin = DH - 0.18;
        const yMax = EA_BASE + 0.18;
        drawAxes(p, exX, exY, exW, exH, "reaction coordinate", "energy");
        const sy = (yv: number) => exY + exH - ((yv - yMin) / (yMax - yMin)) * exH;
        const sx = (xv: number) => exX + xv * exW;
        dash(p, exX, sy(0), exX + exW, sy(0), palette.fgSubtle, 0.4);
        dash(p, exX, sy(DH), exX + exW, sy(DH), palette.fgSubtle, 0.4);

        // Curve draws on when the beat first opens, then holds.
        const reveal = ease.outCubic(kit.clamp01((simTime - diagramOpenedAt) / 0.8));
        p.push();
        p.noFill();
        p.stroke(C_ACCENT[0], C_ACCENT[1], C_ACCENT[2], 255);
        p.strokeWeight(1.5);
        p.strokeJoin(p.ROUND);
        p.beginShape();
        const upto = Math.floor(reveal * (curve.length - 1));
        for (let i = 0; i <= upto; i++) p.vertex(sx(curve[i].x), sy(curve[i].y));
        p.endShape();
        p.pop();

        if (reveal >= 1) {
          const peak = curve[Math.round(REACTION_COORD * (curve.length - 1))];
          const pkx = sx(peak.x);
          const pky = sy(peak.y);
          p.noStroke();
          p.fill(C_ACCENT[0], C_ACCENT[1], C_ACCENT[2], 255);
          p.circle(pkx, pky, 7);
          dash(p, pkx, sy(0), pkx, pky, C_ACCENT, 0.5);
          kit.label(p, {
            x: pkx + 10,
            y: (sy(0) + pky) / 2,
            text: "Ea " + ea.toFixed(2),
            size: 12,
            mono: true,
            color: C_ACCENT,
            align: "left",
          });
          kit.label(p, {
            x: exX + exW - 4,
            y: sy(DH) - 12,
            text: "ΔH " + DH.toFixed(2),
            size: 12,
            mono: true,
            color: palette.teal,
            align: "right",
          });
          kit.label(p, { x: exX + 2, y: sy(0) - 12, text: "reactants", size: 11, mono: true, color: palette.fgMuted, align: "left" });
          kit.label(p, { x: exX + exW - 2, y: sy(DH) + 16, text: "products", size: 11, mono: true, color: palette.fgMuted, align: "right" });
        }
      }

      // CONCENTRATION PLOT (P2+) ─────────────────────────────────────────────
      // Sits up high at P2 (it's the only panel content), then drops to make
      // room for the energy diagram at P3.
      const cX = px;
      const cY = phase >= 3 ? 470 : 220;
      const cW = panelW;
      const cH = 150;
      drawAxes(p, cX, cY, cW, cH, "time", "concentration");
      if (history.length >= 2) {
        const tMax = Math.max(8, history[history.length - 1].t);
        const nMax = Math.max(1, initialReactant);
        const plotSeries = (key: "h2" | "o2" | "h2o", color: RGB): void => {
          p.push();
          p.noFill();
          p.stroke(color[0], color[1], color[2], 255);
          p.strokeWeight(1.5);
          p.strokeJoin(p.ROUND);
          p.beginShape();
          for (const h of history) {
            p.vertex(cX + (h.t / tMax) * cW, cY + cH - (h[key] / nMax) * cH);
          }
          p.endShape();
          p.pop();
        };
        plotSeries("h2", C_H);
        plotSeries("o2", C_O);
        plotSeries("h2o", C_PRODUCT);
      }
      legendRow(p, cX + cW - 150, cY + 10, C_H, "H₂");
      legendRow(p, cX + cW - 100, cY + 10, C_O, "O₂");
      legendRow(p, cX + cW - 52, cY + 10, C_PRODUCT, "H₂O");

      // READOUTS (P3 only — incl. the % converted) ──────────────────────────
      if (phase >= 3) {
        const c = counts();
        const conv = initialReactant > 0 ? (1 - c.H2 / initialReactant) * 100 : 0;
        readout(p, px, 700, "Temperature", params.temperature.toFixed(0), "K", palette.fg);
        readout(p, px + 175, 700, "Rate k", arrheniusK().toFixed(2), " s⁻¹", C_ACCENT);
        readout(p, px + 350, 700, "Converted", Math.max(0, conv).toFixed(0), "%", palette.teal);
        readout(p, px, 790, "Reactions", String(reactionCount), "", C_PRODUCT);
        readout(
          p,
          px + 175,
          790,
          "Catalyst",
          (params.catalyst * 100).toFixed(0),
          "%",
          params.catalyst > 0 ? C_ACCENT : palette.fgSubtle,
        );
        readout(p, px + 350, 790, "Live rate", Math.max(0, rateEMA).toFixed(1), "/s", palette.fgMuted);
      }
    }

    function drawSparks(p: P5): void {
      for (const s of sparks) {
        const c = s.reacted ? C_ACCENT : C_WARN;
        const a = ease.outCubic(s.t);
        p.noStroke();
        for (let i = 3; i >= 1; i--) {
          const f = i / 3;
          p.fill(c[0], c[1], c[2], a * 0.22 * (1 - f) * 255);
          p.circle(s.x, s.y, (s.reacted ? 30 : 18) * (1 - s.t * 0.4) + f * 24);
        }
        p.stroke(c[0], c[1], c[2], a * 0.7 * 255);
        p.strokeWeight(1.5);
        const spokes = s.reacted ? 8 : 5;
        const rr = (s.reacted ? 22 : 13) * (1.2 - s.t);
        for (let i = 0; i < spokes; i++) {
          const ang = (i / spokes) * Math.PI * 2;
          p.line(
            s.x + Math.cos(ang) * rr * 0.4,
            s.y + Math.sin(ang) * rr * 0.4,
            s.x + Math.cos(ang) * rr,
            s.y + Math.sin(ang) * rr,
          );
        }
      }
    }

    // The P1 spotlight: a held, pulsing amber ring on the first H₂+O₂ collision
    // that clears the barrier — the activation event, frozen as a focal instant.
    function drawActivation(p: P5): void {
      if (phase !== 1 || !activation.found) return;
      const pulse = 0.5 + 0.5 * Math.sin((simTime - activationPulse) * 4);
      const baseR = 64;
      p.push();
      p.noFill();
      // soft halo
      for (let i = 3; i >= 1; i--) {
        const f = i / 3;
        p.stroke(C_ACCENT[0], C_ACCENT[1], C_ACCENT[2], (0.1 + 0.12 * pulse) * (1 - f) * 255);
        p.strokeWeight(1.5);
        p.circle(activation.x, activation.y, baseR * (1.1 + f * 0.9));
      }
      // crisp ring
      p.stroke(C_ACCENT[0], C_ACCENT[1], C_ACCENT[2], (0.7 + 0.3 * pulse) * 255);
      p.strokeWeight(1.5);
      p.circle(activation.x, activation.y, baseR);
      p.pop();
      kit.label(p, {
        x: activation.x,
        y: activation.y - baseR / 2 - 14,
        text: "activated complex",
        size: 12,
        upper: true,
        mono: true,
        color: C_ACCENT,
      });
      kit.label(p, {
        x: activation.x,
        y: activation.y + baseR / 2 + 18,
        text: "KE ≥ Ea",
        size: 11,
        mono: true,
        color: palette.fgMuted,
      });
    }

    // ── p5 sketch ────────────────────────────────────────────────────────
    let p5inst: P5 | null = null;

    const sketch = (p: P5) => {
      let W = container.clientWidth || 1280;
      let H = container.clientHeight || 720;

      p.setup = () => {
        const c = p.createCanvas(W, H);
        c.style("display", "block");
        kit.useFonts(p);
        spawnReactants();
      };

      p.windowResized = () => {
        W = container.clientWidth || W;
        H = container.clientHeight || H;
        p.resizeCanvas(W, H);
      };

      p.draw = () => {
        step();
        kit.grid(p);

        const scale = Math.min(W / VW, H / VH);
        const ox = W / 2 - (VW * scale) / 2;
        const oy = H / 2 - (VH * scale) / 2;

        p.push();
        p.translate(ox, oy);
        p.scale(scale);

        kit.label(p, {
          x: box.x,
          y: 64,
          text: content.title ?? "Reaction Kinetics",
          size: 18,
          weight: "bold",
          color: palette.fg,
          align: "left",
        });
        kit.label(p, {
          x: box.x,
          y: 92,
          text: phaseSub(phase) || "2 H₂ + O₂ → 2 H₂O",
          size: 12,
          upper: true,
          mono: true,
          color: palette.fgMuted,
          align: "left",
        });
        kit.phaseDots(p, { x: box.x, y: 116, total: totalPhases, current: phase, color: C_ACCENT });

        // reaction box frame
        p.push();
        p.noFill();
        p.stroke(255, 255, 255, 0.1 * 255);
        p.strokeWeight(1.5);
        p.rect(box.x, box.y, box.w, box.h, 10);
        p.pop();

        drawSparks(p); // glow under molecules
        drawActivation(p); // P1 spotlight, behind the molecules
        for (const m of mols) if (m.alive) drawMolecule(p, m);

        drawPanel(p);

        p.pop();

        placeOverlay(scale, ox, oy);
        // The equation + Arrhenius law belong to the final energetics beat (P3).
        const showEq = phase >= 3;
        eqEl.style.opacity = showEq ? "1" : "0";
        rateEl.style.opacity = showEq ? "1" : "0";
      };
    };

    p5inst = new libs.p5(sketch, container);

    return {
      setPhase: (n: number) => {
        const next = Math.max(0, Math.min(totalPhases - 1, Math.floor(n)));
        // Scrubbing back below the rearrangement beat should restore bare
        // reactants — respawn so products that already formed don't linger.
        if (next < 2 && reactionCount > 0) {
          phase = next;
          spawnReactants();
          return;
        }
        // Mark when the energetics diagram first opens so its curve draws on.
        if (next >= 3 && phase < 3) diagramOpenedAt = simTime;
        phase = next;
      },
      setParam: (key: string, value: number) => {
        if (!(key in params)) return;
        const prev = params[key];
        params[key] = value;
        if (key === "temperature") retemperature();
        // concentration change must alter the molecule count → re-seed the box
        if (key === "concentration" && Math.abs(prev - value) >= 0.05) {
          spawnReactants();
        }
        // catalyst & temperature also feed Eₐ / k immediately (read live)
      },
      dispose: () => {
        try {
          p5inst?.remove();
        } catch {
          /* p5 already torn down */
        }
        p5inst = null;
        overlay.remove();
      },
    };
  },
};

export default sim;
