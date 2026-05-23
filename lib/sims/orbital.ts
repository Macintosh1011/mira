/**
 * Orbital / gravity sim — real Newtonian two-body gravity in 3D (three.js),
 * unfolded like a video: one orbital regime per narration beat.
 *
 * A teal central body and an amber-trailed orbiting body integrated with
 * F = G·M·m / r² (velocity Verlet, symplectic so bound orbits stay closed,
 * with a small Plummer softening through the plunge). The initial tangential
 * velocity decides the conic: v = √(GM/r) → circle, below → inward ellipse,
 * between circular and escape → ellipse, ≥ √(2GM/r) → escape hyperbola — the
 * Kepler behaviour the sliders drive live.
 *
 * The story is GATED BY PHASE so nothing dumps at once:
 *   P0 — bodies placed, the orbiter held at release. Calm. No math, no readouts.
 *   P1 — a stable circle: the trail builds, v_c = √(GM/r) appears with speed +
 *        radius readouts.
 *   P2 — an eccentric ellipse: equal-areas wedges sweep (Kepler's 2nd law), the
 *        period readout joins.
 *   P3 — escape: a higher launch velocity throws the body onto a hyperbola;
 *        the F = GMm/r² force law + the v_esc = √(2GM/r) threshold appear and
 *        state reads ESCAPE.
 *
 * Escape never empties the stage: real physics integrates freely, but the
 * DRAWN position is soft-capped to a visible radius (the body parks on its
 * asymptote at the frame edge) and the camera gently dollies out as the orbiter
 * recedes, so the hyperbolic departure stays in frame the whole way.
 */
import type {
  ControlSpec,
  SceneContent,
  SceneController,
  Sim,
  SimLibs,
} from "@/lib/types";

// ── colors (three.js wants its own; values mirror the kit palette) ──────────

const AMBER: readonly [number, number, number] = [0xef / 255, 0xc5 / 255, 0x40 / 255];
const TEAL: readonly [number, number, number] = [49, 192, 177]; // kit.flatSphere takes 0..255
const BLUE: readonly [number, number, number] = [37, 107, 185];
const BG_HEX = 0x0c0c0e; // near-black, kept per the strict theme

// ── controls ────────────────────────────────────────────────────────────────
// `velocity` is a fraction of the local circular speed v_c = √(GM/r0): 1.0 =
// circle, <1 = inward ellipse / plunge, >1 (up to √2 ≈ 1.414) = outward
// ellipse, ≥ √2 = escape. Physical and legible regardless of G / mass.

const CONTROLS: ControlSpec[] = [
  { key: "mass", label: "Central mass", min: 0.5, max: 4, step: 0.05, default: 1, unit: "M" },
  { key: "velocity", label: "Initial velocity", min: 0.25, max: 1.55, step: 0.01, default: 1, unit: "vc" },
  { key: "G", label: "Gravity G", min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: "eccentricity", label: "Eccentricity", min: 0, max: 0.85, step: 0.01, default: 0 },
];

// Per-phase launch velocity factor (×v_c). setPhase relaunches to its regime:
// hold at release → circle → eccentric ellipse → escape hyperbola.
const PHASE_VELOCITY = [1.0, 1.0, 0.74, 1.45];
const PHASE_COUNT = PHASE_VELOCITY.length;
const DEFAULT_PHASE_LABELS = [
  "Released",
  "Stable circle",
  "Eccentric ellipse",
  "Escape velocity",
];

// ── physics constants ───────────────────────────────────────────────────────

const R0 = 3.2; // base orbital radius (world units)
const SOFTEN2 = 0.02; // Plummer softening² — finite accel through plunge
const SUBSTEPS = 12; // physics substeps per rendered frame
// Sim-seconds advanced per rendered frame, split across substeps. Tuned so a
// circular orbit completes in ~7 real-seconds at 60fps (period ≈ 36 sim-s),
// which reads as live motion inside a narration beat. Fixed → deterministic,
// frame-rate independent.
const SIM_PER_FRAME = 0.09;
const DT = SIM_PER_FRAME / SUBSTEPS;
const TRAIL_LEN = 620; // ring-buffer length of the comet trail
const CORE_R = 0.55; // central-body radius (= "swallowed" threshold)

// ── framing: keep the orbiter on screen, even on escape ──────────────────────
// Beyond DISPLAY_SOFT the drawn radius is logarithmically compressed so the
// body asymptotes toward DISPLAY_MAX (the frame edge) instead of flying off.
// Physics is untouched — only what we DRAW is squeezed.
const DISPLAY_SOFT = 4.4; // world units where compression begins
const DISPLAY_MAX = 6.4; // hard ceiling on the drawn radius (parks at frame edge)
const CAM_NEAR = 8.6; // camera z when the orbit is tight
const CAM_FAR = 13.0; // camera z dollied out for the escape (visR ≈ 7.4)

const Sim: Sim = {
  id: "orbital",
  title: "Orbital Gravity",
  controls: CONTROLS,
  create(
    container: HTMLElement,
    libs: SimLibs,
    content: SceneContent,
  ): SceneController {
    const THREE = libs.THREE;
    const gsap = libs.gsap;
    const kit = libs.kit;

    // ── scene / camera / renderer (kit helper, framed to fill the stage) ────
    const s3 = kit.scene3d(THREE, container, { distance: 11, fov: 46 });
    const scene = s3.scene;
    const camera = s3.camera;
    camera.position.set(0, 7.4, CAM_NEAR); // look down onto the XZ orbital plane
    camera.lookAt(0, 0, 0);
    // Live-tracked dolly distance; eased toward a target each frame so the
    // escape zoom-out is smooth and the orbit stays nicely framed.
    let camDist = CAM_NEAR;

    scene.fog = new THREE.Fog(BG_HEX, 18, 38);
    scene.background = new THREE.Color(BG_HEX);

    // Extra fill beyond the kit's hemisphere so the flat faces read with depth.
    const key = new THREE.DirectionalLight(0xffffff, 0.5);
    key.position.set(4, 8, 6);
    scene.add(key);

    // ── faint reference grid plane on the orbital plane ─────────────────────
    const grid = new THREE.GridHelper(20, 20, 0xffffff, 0xffffff);
    const gridMat = grid.material as {
      opacity: number;
      transparent: boolean;
      depthWrite: boolean;
      dispose: () => void;
    };
    gridMat.opacity = 0.06;
    gridMat.transparent = true;
    gridMat.depthWrite = false;
    grid.position.y = -0.001;
    scene.add(grid);

    // ── bodies (flat-shaded, no PBR) ────────────────────────────────────────
    const central = kit.flatSphere(THREE, CORE_R, TEAL, false);
    scene.add(central);
    const halo = kit.flatSphere(THREE, CORE_R * 1.7, TEAL, true);
    const haloMat = halo.material as { transparent: boolean; opacity: number };
    haloMat.transparent = true;
    haloMat.opacity = 0.18;
    scene.add(halo);

    const body = kit.flatSphere(THREE, 0.26, BLUE, false);
    scene.add(body);

    // ── moving comet trail (amber, head-bright via per-vertex alpha) ────────
    const trailPos = new Float32Array(TRAIL_LEN * 3);
    const trailAlpha = new Float32Array(TRAIL_LEN);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setAttribute("aAlpha", new THREE.BufferAttribute(trailAlpha, 1));
    const trailMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(AMBER[0], AMBER[1], AMBER[2]) } },
      vertexShader:
        "attribute float aAlpha; varying float vAlpha;" +
        "void main(){ vAlpha = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader:
        "uniform vec3 uColor; varying float vAlpha;" +
        "void main(){ if(vAlpha<=0.0) discard; gl_FragColor = vec4(uColor, vAlpha); }",
    });
    const trail = new THREE.Line(trailGeo, trailMat);
    trail.frustumCulled = false;
    scene.add(trail);

    // ── predicted-conic ghost path (one full orbit, faint amber) ────────────
    const ghostGeo = new THREE.BufferGeometry();
    const ghostMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(AMBER[0], AMBER[1], AMBER[2]),
      transparent: true,
      opacity: 0.16,
    });
    const ghost = new THREE.Line(ghostGeo, ghostMat);
    ghost.frustumCulled = false;
    scene.add(ghost);

    // ── equal-areas wedges (Kepler 2nd law, phase 2 only) ───────────────────
    const sweepGroup = new THREE.Group();
    scene.add(sweepGroup);
    const sweepMeshes: Array<{
      geometry: { dispose: () => void };
      material: { dispose: () => void; opacity: number };
    }> = [];

    // ── HTML overlay: equation + live readouts + phase label ────────────────
    const overlay = buildOverlay(container, libs, content);

    // ── physics state ────────────────────────────────────────────────────────
    const state = {
      mass: 1,
      G: 1,
      velFactor: 1, // ×v_c
      ecc: 0, // launch-point bias that stretches the ellipse
      px: R0, py: 0, pz: 0,
      vx: 0, vy: 0, vz: 0,
      escaped: false,
      swallowed: false,
      held: false, // P0: orbiter placed but not yet released
      period: 0,
      lastCrossT: -1,
      simT: 0,
      sweepEnabled: false,
      lastSweepT: 0,
      sweepPrev: null as { x: number; z: number } | null,
    };

    const GM = () => state.G * state.mass;
    const circularSpeed = (r: number) => Math.sqrt(GM() / r);
    const launchRadius = () => R0 * (1 + state.ecc * 0.9);

    // ── trail ring buffer ─────────────────────────────────────────────────────
    let trailHead = 0;
    let trailCount = 0;
    function pushTrail(x: number, y: number, z: number): void {
      trailHead = (trailHead + 1) % TRAIL_LEN;
      trailPos[trailHead * 3] = x;
      trailPos[trailHead * 3 + 1] = y;
      trailPos[trailHead * 3 + 2] = z;
      if (trailCount < TRAIL_LEN) trailCount++;
      for (let i = 0; i < TRAIL_LEN; i++) {
        const back = (trailHead - i + TRAIL_LEN) % TRAIL_LEN; // 0 = head
        trailAlpha[i] =
          back < trailCount
            ? Math.pow(1 - back / Math.max(1, trailCount), 1.6) * 0.95
            : 0;
      }
      trailGeo.attributes.position.needsUpdate = true;
      trailGeo.attributes.aAlpha.needsUpdate = true;
    }
    function resetTrail(): void {
      trailHead = 0;
      trailCount = 0;
      trailAlpha.fill(0);
      trailGeo.attributes.aAlpha.needsUpdate = true;
    }

    // ── display-space framing ─────────────────────────────────────────────────
    // Soft-cap a world radius so the drawn point asymptotes to DISPLAY_MAX
    // instead of leaving the viewport. Returns the per-axis scale to apply to
    // (x,y,z). Identity inside DISPLAY_SOFT; logarithmic compression beyond it.
    function displayScale(r: number): number {
      if (r <= DISPLAY_SOFT || r <= 1e-6) return 1;
      const over = r - DISPLAY_SOFT;
      const span = DISPLAY_MAX - DISPLAY_SOFT;
      // Saturating curve: drawnR → DISPLAY_MAX as over → ∞.
      const drawnR = DISPLAY_SOFT + span * (1 - Math.exp(-over / span));
      return drawnR / r;
    }
    function drawPos(x: number, y: number, z: number): [number, number, number] {
      const r = Math.hypot(x, y, z);
      const k = displayScale(r);
      return [x * k, y * k, z * k];
    }

    // ── equal-areas wedges ────────────────────────────────────────────────────
    function clearSweeps(): void {
      for (const m of sweepMeshes) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sweepGroup.remove(m as any);
        m.geometry.dispose();
        m.material.dispose();
      }
      sweepMeshes.length = 0;
    }
    function addSweepWedge(ax: number, az: number, bx: number, bz: number): void {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array([0, 0, 0, ax, 0, az, bx, 0, bz]), 3),
      );
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(AMBER[0], AMBER[1], AMBER[2]),
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      sweepGroup.add(mesh);
      sweepMeshes.push(mesh);
      gsap.to(mat, { opacity: 0.22, duration: 0.6, ease: "power2.out" });
    }

    // ── analytic conic for the ghost path ────────────────────────────────────
    function rebuildGhost(): void {
      const r0 = launchRadius();
      const v = circularSpeed(r0) * state.velFactor;
      const mu = GM();
      const energy = 0.5 * v * v - mu / r0; // specific orbital energy
      const h = r0 * v; // specific angular momentum (tangential launch)
      const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (mu * mu)));
      const p = (h * h) / mu; // semi-latus rectum
      const pts: number[] = [];
      if (energy >= -1e-4) {
        // open conic: sample true anomaly within the branch, then display-cap so
        // the predicted hyperbola stays inside the frame like the live body.
        const nuMax = e > 1 ? Math.acos(-1 / e) - 0.02 : Math.PI - 0.02;
        const N = 220;
        for (let i = -N; i <= N; i++) {
          const nu = (i / N) * nuMax;
          const r = p / (1 + e * Math.cos(nu));
          if (r <= 0 || r > 60) continue;
          const [gx, , gz] = drawPos(r * Math.cos(nu), 0, r * Math.sin(nu));
          pts.push(gx, 0, gz);
        }
      } else {
        const N = 360;
        for (let i = 0; i <= N; i++) {
          const nu = (i / N) * Math.PI * 2;
          const r = p / (1 + e * Math.cos(nu));
          const [gx, , gz] = drawPos(r * Math.cos(nu), 0, r * Math.sin(nu));
          pts.push(gx, 0, gz);
        }
      }
      ghostGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
      ghostGeo.computeBoundingSphere();
    }

    // Seed launch: radius launchRadius(), purely tangential velocity (+Z at +X).
    // `hold` (P0) places the body at rest so the opening beat reads calm.
    function reseed(hold = false): void {
      const r0 = launchRadius();
      state.px = r0; state.py = 0; state.pz = 0;
      const v = hold ? 0 : circularSpeed(r0) * state.velFactor;
      state.vx = 0; state.vy = 0; state.vz = v;
      state.held = hold;
      state.escaped = false;
      state.swallowed = false;
      state.period = 0;
      state.lastCrossT = -1;
      state.simT = 0;
      state.lastSweepT = 0;
      state.sweepPrev = null;
      body.scale.setScalar(1);
      clearSweeps();
      resetTrail();
      if (!hold) rebuildGhost();
      else ghostGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([]), 3));
    }

    // ── integrator: velocity Verlet, substepped ──────────────────────────────
    function accel(x: number, y: number, z: number): [number, number, number] {
      const r2 = x * x + y * y + z * z + SOFTEN2;
      const inv = -GM() / (r2 * Math.sqrt(r2)); // -GM / r³
      return [inv * x, inv * y, inv * z];
    }

    function step(): void {
      if (state.swallowed || state.held) return;
      for (let s = 0; s < SUBSTEPS; s++) {
        const [ax, ay, az] = accel(state.px, state.py, state.pz);
        const nx = state.px + state.vx * DT + 0.5 * ax * DT * DT;
        const ny = state.py + state.vy * DT + 0.5 * ay * DT * DT;
        const nz = state.pz + state.vz * DT + 0.5 * az * DT * DT;
        const [ax2, ay2, az2] = accel(nx, ny, nz);
        state.vx += 0.5 * (ax + ax2) * DT;
        state.vy += 0.5 * (ay + ay2) * DT;
        state.vz += 0.5 * (az + az2) * DT;
        const prevZ = state.pz;
        state.px = nx; state.py = ny; state.pz = nz;
        state.simT += DT;

        const r = Math.hypot(state.px, state.py, state.pz);
        if (r < CORE_R * 0.92) {
          state.swallowed = true;
          break;
        }
        if (r > DISPLAY_MAX * 0.98) state.escaped = true;

        // period: detect crossing of +X half-plane moving +Z (one full loop)
        if (!state.escaped && state.px > 0 && prevZ < 0 && state.pz >= 0) {
          if (state.lastCrossT >= 0) state.period = state.simT - state.lastCrossT;
          state.lastCrossT = state.simT;
        }

        // equal-areas: drop a wedge every fixed time interval while enabled
        if (state.sweepEnabled && !state.escaped) {
          if (state.sweepPrev === null) {
            state.sweepPrev = { x: state.px, z: state.pz };
            state.lastSweepT = state.simT;
          } else if (state.simT - state.lastSweepT >= 0.34 && sweepMeshes.length < 16) {
            addSweepWedge(state.sweepPrev.x, state.sweepPrev.z, state.px, state.pz);
            state.sweepPrev = { x: state.px, z: state.pz };
            state.lastSweepT = state.simT;
          }
        }
      }
    }

    // ── phase control ─────────────────────────────────────────────────────────
    let currentPhase = -1;
    function setPhase(phaseIndex: number): void {
      const n = Math.max(0, Math.min(PHASE_COUNT - 1, Math.floor(phaseIndex)));
      if (n === currentPhase) return;
      currentPhase = n;

      const wantSweep = n === 2;
      if (wantSweep) {
        state.sweepEnabled = true;
        state.sweepPrev = null;
        state.lastSweepT = state.simT;
      } else if (state.sweepEnabled) {
        state.sweepEnabled = false;
        clearSweeps();
      }

      state.velFactor = PHASE_VELOCITY[n];
      // Eccentric beat biases the launch point so the ellipse visibly stretches;
      // every other beat launches clean from R0.
      state.ecc = n === 2 ? 0.32 : 0;
      reseed(n === 0); // P0 holds at release
      overlay.setPhase(n);
    }

    // ── live params ───────────────────────────────────────────────────────────
    function setParam(k: string, value: number): void {
      switch (k) {
        case "mass": state.mass = value; break;
        case "velocity": state.velFactor = value; break;
        case "G": state.G = value; break;
        case "eccentricity": state.ecc = value; break;
        default: return;
      }
      // A live knob releases the body even on the opening beat, so tuning shows
      // its effect immediately rather than against a frozen scene. reseed clears
      // the old wedges; re-arm the sweep so they redraw on the new trajectory.
      reseed(false);
      if (state.sweepEnabled) {
        state.sweepPrev = null;
        state.lastSweepT = state.simT;
      }
    }

    // ── render loop ───────────────────────────────────────────────────────────
    let raf = 0;
    let last = performance.now();

    function frame(now: number): void {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      step();

      // Draw the body at its display-capped position so escape stays in frame.
      const [dx, dy, dz] = drawPos(state.px, state.py, state.pz);
      body.position.set(dx, dy, dz);
      if (!state.swallowed && !state.held) pushTrail(dx, dy, dz);

      if (state.swallowed) {
        const sc = Math.max(0, body.scale.x - dt * 4);
        body.scale.setScalar(sc);
        if (sc < 0.02) reseed(false); // never leave the stage empty
      } else if (body.scale.x < 1) {
        body.scale.setScalar(Math.min(1, body.scale.x + dt * 4));
      }

      central.rotation.y += 0.004;
      halo.rotation.y -= 0.0022;
      halo.rotation.x += 0.0011;

      const r = Math.hypot(state.px, state.py, state.pz);
      const speed = Math.hypot(state.vx, state.vy, state.vz);
      const vEsc = Math.SQRT2 * circularSpeed(r);

      // Dolly the camera out only once the orbiter pushes past the soft cap
      // (i.e. it's actually departing), then ease back in once it loops home.
      // Bound circles/ellipses stay inside DISPLAY_SOFT, so the camera holds
      // steady through P0–P2 and the zoom-out reads as the escape itself.
      const reach = Math.min(1, Math.max(0, (r - DISPLAY_SOFT) / (DISPLAY_MAX - DISPLAY_SOFT)));
      const targetDist = CAM_NEAR + (CAM_FAR - CAM_NEAR) * reach;
      camDist += (targetDist - camDist) * Math.min(1, dt * 2.5);
      camera.position.set(0, camDist * (7.4 / CAM_NEAR), camDist);
      camera.lookAt(0, 0, 0);

      overlay.update({
        speed: state.held ? 0 : speed,
        radius: r,
        period: state.period,
        escaped: !state.held && (state.escaped || speed >= vEsc - 1e-3),
        held: state.held,
      });

      s3.render();
      raf = requestAnimationFrame(frame);
    }

    // ── boot ──────────────────────────────────────────────────────────────────
    if (content?.params) {
      for (const c of CONTROLS) {
        const v = content.params[c.key];
        if (typeof v === "number") {
          if (c.key === "mass") state.mass = v;
          else if (c.key === "velocity") state.velFactor = v;
          else if (c.key === "G") state.G = v;
          else if (c.key === "eccentricity") state.ecc = v;
        }
      }
    }
    setPhase(0);
    raf = requestAnimationFrame(frame);

    const onResize = () => s3.resize();
    window.addEventListener("resize", onResize);

    // ── teardown ────────────────────────────────────────────────────────────────
    function dispose(): void {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      clearSweeps();
      central.geometry.dispose(); central.material.dispose();
      halo.geometry.dispose(); halo.material.dispose();
      body.geometry.dispose(); body.material.dispose();
      trailGeo.dispose(); trailMat.dispose();
      ghostGeo.dispose(); ghostMat.dispose();
      grid.geometry.dispose(); gridMat.dispose();
      if (typeof key.dispose === "function") key.dispose();
      overlay.dispose();
      s3.dispose();
    }

    return { setPhase, setParam, dispose };
  },
};

// ── HTML overlay (equation via katex + live readouts, gated by phase) ─────────

interface Overlay {
  update: (d: {
    speed: number;
    radius: number;
    period: number;
    escaped: boolean;
    held: boolean;
  }) => void;
  setPhase: (n: number) => void;
  dispose: () => void;
}

function buildOverlay(container: HTMLElement, libs: SimLibs, content: SceneContent): Overlay {
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }

  const root = document.createElement("div");
  root.style.cssText =
    "position:absolute;inset:0;pointer-events:none;font-family:Menlo,Monaco,Consolas,monospace;color:#f4f4f5;z-index:2;";

  // Render KaTeX exactly once per call, HTML output, inline. The caller decides
  // WHEN each line exists, so there is no double render.
  const renderEq = (tex: string): string => {
    if (libs.katex && typeof libs.katex.renderToString === "function") {
      try {
        return libs.katex.renderToString(tex, {
          throwOnError: false,
          output: "html",
          displayMode: false,
        });
      } catch {
        return "";
      }
    }
    return "";
  };

  // equation card (top-left) — body filled per phase, never all at once.
  const eqCard = document.createElement("div");
  eqCard.style.cssText =
    "position:absolute;top:18px;left:18px;padding:12px 14px;background:rgba(20,20,24,0.55);" +
    "border:1px solid rgba(255,255,255,0.07);border-radius:10px;backdrop-filter:blur(6px);" +
    "font-size:15px;line-height:1.7;color:#a1a1aa;opacity:0;" +
    "transition:opacity 420ms cubic-bezier(0.16,1,0.3,1);";
  root.appendChild(eqCard);

  // readouts card (top-right) — rows revealed per phase.
  const readCard = document.createElement("div");
  readCard.style.cssText =
    "position:absolute;top:18px;right:18px;padding:12px 14px;min-width:168px;background:rgba(20,20,24,0.55);" +
    "border:1px solid rgba(255,255,255,0.07);border-radius:10px;backdrop-filter:blur(6px);opacity:0;" +
    "transition:opacity 420ms cubic-bezier(0.16,1,0.3,1);";
  const row = (label: string, id: string): string =>
    `<div data-row="${id}" style="display:flex;justify-content:space-between;gap:18px;font-size:12px;margin:3px 0;">` +
    `<span style="color:#a1a1aa;">${label}</span>` +
    `<span id="${id}" style="color:#efc540;font-weight:700;">—</span></div>`;
  readCard.innerHTML =
    `<div style="color:#52525b;font-size:10px;letter-spacing:0.14em;margin-bottom:8px;">READOUTS</div>` +
    row("speed", "ro-speed") +
    row("radius", "ro-radius") +
    row("period", "ro-period") +
    row("state", "ro-state");
  root.appendChild(readCard);

  // phase track (bottom-left): dashes + the current beat label.
  const phaseWrap = document.createElement("div");
  phaseWrap.style.cssText =
    "position:absolute;bottom:18px;left:18px;display:flex;align-items:center;gap:10px;";
  const dotsEl = document.createElement("div");
  dotsEl.style.cssText = "display:flex;gap:4px;";
  for (let i = 0; i < PHASE_COUNT; i++) {
    const seg = document.createElement("span");
    seg.style.cssText =
      "width:16px;height:2px;border-radius:1px;background:#52525b;transition:background 300ms ease;";
    dotsEl.appendChild(seg);
  }
  const phaseEl = document.createElement("div");
  phaseEl.style.cssText =
    "font-size:11px;letter-spacing:0.16em;color:#efc540;text-transform:uppercase;";
  phaseWrap.appendChild(dotsEl);
  phaseWrap.appendChild(phaseEl);
  root.appendChild(phaseWrap);

  // title (bottom-right, subtle)
  const titleEl = document.createElement("div");
  titleEl.style.cssText =
    "position:absolute;bottom:18px;right:18px;font-size:11px;letter-spacing:0.12em;color:#52525b;text-transform:uppercase;";
  titleEl.textContent = content?.title ?? "Orbital gravity";
  root.appendChild(titleEl);

  container.appendChild(root);

  const find = (id: string) => root.querySelector<HTMLElement>("#" + id);
  const findRow = (id: string) => root.querySelector<HTMLElement>(`[data-row="${id}"]`);
  const elSpeed = find("ro-speed");
  const elRadius = find("ro-radius");
  const elPeriod = find("ro-period");
  const elState = find("ro-state");
  const rowPeriod = findRow("ro-period");
  const phases = content?.phases ?? [];

  // Pre-rendered equation lines (each rendered ONCE here, swapped in per phase).
  const FORCE_LAW =
    `<div style="color:#52525b;font-size:10px;letter-spacing:0.14em;margin-bottom:6px;">NEWTONIAN GRAVITY</div>` +
    `<div>${renderEq(content?.equation || "F = \\dfrac{G\\,M\\,m}{r^{2}}")}</div>`;
  const CIRC_SPEED =
    `<div style="color:#52525b;font-size:10px;letter-spacing:0.14em;margin-bottom:6px;">CIRCULAR SPEED</div>` +
    `<div>${renderEq("v_{c} = \\sqrt{\\dfrac{G\\,M}{r}}")}</div>`;
  const KEPLER_2 =
    `<div style="color:#52525b;font-size:10px;letter-spacing:0.14em;margin-bottom:6px;">KEPLER · EQUAL AREAS</div>` +
    `<div>${renderEq("\\dfrac{dA}{dt} = \\tfrac{1}{2}\\,r^{2}\\dot\\theta = \\text{const}")}</div>`;
  const ESCAPE_SET =
    `<div style="color:#52525b;font-size:10px;letter-spacing:0.14em;margin-bottom:6px;">ESCAPE</div>` +
    `<div style="margin-bottom:2px;">${renderEq("F = \\dfrac{G\\,M\\,m}{r^{2}}")}</div>` +
    `<div>${renderEq("v_{esc} = \\sqrt{\\dfrac{2\\,G\\,M}{r}}")}</div>`;
  const EQ_BY_PHASE = ["", CIRC_SPEED, KEPLER_2, ESCAPE_SET];

  return {
    update(d) {
      if (d.held) {
        if (elSpeed) elSpeed.textContent = "at rest";
        if (elRadius) elRadius.textContent = d.radius.toFixed(2);
        return;
      }
      if (elSpeed) elSpeed.textContent = d.speed.toFixed(2);
      if (elRadius) elRadius.textContent = d.radius.toFixed(2);
      if (elPeriod) elPeriod.textContent = d.period > 0 ? d.period.toFixed(2) + "s" : "—";
      if (elState) {
        elState.textContent = d.escaped ? "ESCAPE" : "BOUND";
        elState.style.color = d.escaped ? "#ef7f39" : "#31c0b1";
      }
    },
    setPhase(n) {
      // Equation: nothing at P0, then exactly one line per regime.
      eqCard.innerHTML = EQ_BY_PHASE[n] ?? "";
      eqCard.style.opacity = n >= 1 ? "1" : "0";

      // Readouts: hidden at P0, revealed from P1; period only from the ellipse
      // beat (it has no meaning for a fresh circle or an unbound escape), state
      // row meaningful from the escape beat but harmless earlier (reads BOUND).
      readCard.style.opacity = n >= 1 ? "1" : "0";
      // Period is meaningful only once the ellipse beat starts measuring it.
      if (rowPeriod) rowPeriod.style.display = n >= 2 ? "flex" : "none";

      // phase track
      const segs = dotsEl.children;
      for (let i = 0; i < segs.length; i++) {
        (segs[i] as HTMLElement).style.background = i <= n ? "#efc540" : "#52525b";
      }
      const label = phases[n]?.label ?? DEFAULT_PHASE_LABELS[n] ?? "";
      phaseEl.textContent = `${n + 1}/${PHASE_COUNT} · ${label}`;
    },
    dispose() {
      root.remove();
    },
  };
}

export default Sim;
