/**
 * Orbital / gravity sim — real Newtonian two-body gravity in 3D (three.js).
 *
 * A central body and an orbiting body integrated with F = G·M·m / r², traced
 * with an amber comet trail in the XZ plane over a faint reference grid. The
 * initial tangential velocity decides the conic: too slow → plunge, v = √(GM/r)
 * → circle, between circular and escape → ellipse, ≥ √(2GM/r) → escape
 * hyperbola — literal Kepler behaviour the sliders drive live.
 *
 * Integrator: velocity Verlet (symplectic, energy-conserving so bound orbits
 * stay closed) with a fixed micro-timestep and a substep loop, so the motion is
 * deterministic and frame-rate independent. A small Plummer softening keeps the
 * acceleration finite through a near-radial plunge.
 *
 * Beats (setPhase, 1:1 with narration): stable circle → eccentric ellipse →
 * equal-areas / period (Kepler's 2nd law wedges) → escape velocity.
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
const BG_HEX = 0x0c0c0e;

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

// Per-phase velocity factor + which overlays are on; setPhase relaunches to it.
const PHASE_VELOCITY = [1.0, 0.78, 0.78, 1.42];
const DEFAULT_PHASE_LABELS = ["Stable circle", "Eccentric ellipse", "Equal areas · period", "Escape velocity"];

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
    camera.position.set(0, 7.4, 8.6); // look down onto the XZ orbital plane
    camera.lookAt(0, 0, 0);

    scene.fog = new THREE.Fog(BG_HEX, 16, 32);

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
        // open conic: sample true anomaly within the branch
        const nuMax = e > 1 ? Math.acos(-1 / e) - 0.02 : Math.PI - 0.02;
        const N = 220;
        for (let i = -N; i <= N; i++) {
          const nu = (i / N) * nuMax;
          const r = p / (1 + e * Math.cos(nu));
          if (r <= 0 || r > 60) continue;
          pts.push(r * Math.cos(nu), 0, r * Math.sin(nu));
        }
      } else {
        const N = 360;
        for (let i = 0; i <= N; i++) {
          const nu = (i / N) * Math.PI * 2;
          const r = p / (1 + e * Math.cos(nu));
          pts.push(r * Math.cos(nu), 0, r * Math.sin(nu));
        }
      }
      ghostGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
      ghostGeo.computeBoundingSphere();
    }

    // Seed launch: radius launchRadius(), purely tangential velocity (+Z at +X).
    function reseed(): void {
      const r0 = launchRadius();
      state.px = r0; state.py = 0; state.pz = 0;
      const v = circularSpeed(r0) * state.velFactor;
      state.vx = 0; state.vy = 0; state.vz = v;
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
      rebuildGhost();
    }

    // ── integrator: velocity Verlet, substepped ──────────────────────────────
    function accel(x: number, y: number, z: number): [number, number, number] {
      const r2 = x * x + y * y + z * z + SOFTEN2;
      const inv = -GM() / (r2 * Math.sqrt(r2)); // -GM / r³
      return [inv * x, inv * y, inv * z];
    }

    function step(): void {
      if (state.swallowed) return;
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
        if (r > 26) state.escaped = true;

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
      const n = Math.max(0, Math.min(PHASE_VELOCITY.length - 1, Math.floor(phaseIndex)));
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
      state.ecc = 0;
      reseed();
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
      reseed();
    }

    // ── render loop ───────────────────────────────────────────────────────────
    let raf = 0;
    let last = performance.now();

    function frame(now: number): void {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      step();

      body.position.set(state.px, state.py, state.pz);
      if (!state.swallowed) pushTrail(state.px, state.py, state.pz);

      if (state.swallowed) {
        const sc = Math.max(0, body.scale.x - dt * 4);
        body.scale.setScalar(sc);
        if (sc < 0.02) reseed(); // never leave the stage empty
      } else if (body.scale.x < 1) {
        body.scale.setScalar(Math.min(1, body.scale.x + dt * 4));
      }

      central.rotation.y += 0.004;
      halo.rotation.y -= 0.0022;
      halo.rotation.x += 0.0011;

      const r = Math.hypot(state.px, state.py, state.pz);
      const speed = Math.hypot(state.vx, state.vy, state.vz);
      const vEsc = Math.SQRT2 * circularSpeed(r);
      overlay.update({
        speed,
        radius: r,
        period: state.period,
        escaped: state.escaped || speed >= vEsc - 1e-3,
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
    reseed();
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

// ── HTML overlay (equation via katex + live readouts) ─────────────────────────

interface Overlay {
  update: (d: { speed: number; radius: number; period: number; escaped: boolean }) => void;
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

  const renderEq = (tex: string): string => {
    if (libs.katex && typeof libs.katex.renderToString === "function") {
      try {
        return libs.katex.renderToString(tex, { throwOnError: false, output: "html", displayMode: false });
      } catch {
        return tex;
      }
    }
    return tex;
  };

  // equation card (top-left)
  const eqCard = document.createElement("div");
  eqCard.style.cssText =
    "position:absolute;top:18px;left:18px;padding:12px 14px;background:rgba(20,20,24,0.62);" +
    "border:1px solid rgba(255,255,255,0.08);border-radius:10px;backdrop-filter:blur(6px);" +
    "font-size:15px;line-height:1.7;color:#a1a1aa;";
  const extra = content?.equation ? `<div style="margin-top:2px;">${renderEq(content.equation)}</div>` : "";
  eqCard.innerHTML =
    `<div style="color:#52525b;font-size:10px;letter-spacing:0.14em;margin-bottom:6px;">NEWTONIAN GRAVITY</div>` +
    `<div style="margin-bottom:2px;">${renderEq("F = \\dfrac{G\\,M\\,m}{r^{2}}")}</div>` +
    `<div>${renderEq("v_{c} = \\sqrt{\\dfrac{G\\,M}{r}}")}</div>` +
    extra;
  root.appendChild(eqCard);

  // readouts card (top-right)
  const readCard = document.createElement("div");
  readCard.style.cssText =
    "position:absolute;top:18px;right:18px;padding:12px 14px;min-width:168px;background:rgba(20,20,24,0.62);" +
    "border:1px solid rgba(255,255,255,0.08);border-radius:10px;backdrop-filter:blur(6px);";
  const row = (label: string, id: string): string =>
    `<div style="display:flex;justify-content:space-between;gap:18px;font-size:12px;margin:3px 0;">` +
    `<span style="color:#a1a1aa;">${label}</span>` +
    `<span id="${id}" style="color:#efc540;font-weight:700;">—</span></div>`;
  readCard.innerHTML =
    `<div style="color:#52525b;font-size:10px;letter-spacing:0.14em;margin-bottom:8px;">READOUTS</div>` +
    row("speed", "ro-speed") +
    row("radius", "ro-radius") +
    row("period", "ro-period") +
    row("state", "ro-state");
  root.appendChild(readCard);

  // phase label (bottom-left)
  const phaseEl = document.createElement("div");
  phaseEl.style.cssText =
    "position:absolute;bottom:18px;left:18px;font-size:11px;letter-spacing:0.16em;color:#efc540;text-transform:uppercase;";
  root.appendChild(phaseEl);

  // title (bottom-right, subtle)
  const titleEl = document.createElement("div");
  titleEl.style.cssText =
    "position:absolute;bottom:18px;right:18px;font-size:11px;letter-spacing:0.12em;color:#52525b;text-transform:uppercase;";
  titleEl.textContent = content?.title ?? "Orbital gravity";
  root.appendChild(titleEl);

  container.appendChild(root);

  const find = (id: string) => root.querySelector<HTMLElement>("#" + id);
  const elSpeed = find("ro-speed");
  const elRadius = find("ro-radius");
  const elPeriod = find("ro-period");
  const elState = find("ro-state");
  const phases = content?.phases ?? [];
  const phaseCount = Math.max(PHASE_VELOCITY.length, phases.length);

  return {
    update(d) {
      if (elSpeed) elSpeed.textContent = d.speed.toFixed(2);
      if (elRadius) elRadius.textContent = d.radius.toFixed(2);
      if (elPeriod) elPeriod.textContent = d.period > 0 ? d.period.toFixed(2) + "s" : "—";
      if (elState) {
        elState.textContent = d.escaped ? "ESCAPE" : "BOUND";
        elState.style.color = d.escaped ? "#ef7f39" : "#31c0b1";
      }
    },
    setPhase(n) {
      const label = phases[n]?.label ?? DEFAULT_PHASE_LABELS[n] ?? "";
      phaseEl.textContent = `${n + 1}/${phaseCount} · ${label}`;
    },
    dispose() {
      root.remove();
    },
  };
}

export default Sim;
