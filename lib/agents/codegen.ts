/**
 * Code-gen agent: ScenePlan -> a single render-module body string.
 *
 * The output is the BODY of `(container, libs) => () => void` (see RenderModule
 * in lib/types.ts). The render host does `new Function("container","libs",code)`
 * and calls the returned cleanup on unmount. So the string MUST:
 *   - use only `container` and `libs` ({ p5, THREE, gsap }) as inputs,
 *   - mount into `container`,
 *   - return a cleanup function,
 *   - contain NO import/export/markdown fences (libs are injected).
 *
 * We stream raw deltas to the UI (code_chunk events) while accumulating, then
 * sanitize the full string before emitting code_done. This is the single most
 * important integration contract in the system, so the prompt carries the full
 * contract plus one 2D and one 3D worked example, and we defensively strip the
 * common failure modes (fences, stray imports) after the fact.
 */
import { generateStream, ThinkingLevel, type GenOptions } from "@/lib/gemini";
import type { ScenePlan, Renderer } from "@/lib/types";
import { planRenderer } from "./orchestrator";

const AESTHETIC = `AESTHETIC (Ciechanowski / 3Blue1Brown house style, non-negotiable):
- Near-black paper background: #0e0c0d.
- Soft, muted palette ONLY: terracotta #d98a6a, muted yellow #e8c468, sage #8fb08a, dusty blue #7aa2c2, off-white #e8e2d8 for text.
- Thin strokes: 1.5px. Never harsh, never pure white on black.
- Slow, eased motion. Prefer gsap or smooth lerps; nothing jittery or fast.
- Flat shading on 3D (MeshBasicMaterial or flat-lit), no glossy/metal materials, no harsh point lights.
- Looks composed even when paused. Label things with small text where it helps understanding.
- Generous spacing, centered composition, responsive to container size.`;

const CONTRACT = `OUTPUT CONTRACT (read carefully, this is non-negotiable):
You output the BODY of a JavaScript function with this exact signature:
    (container, libs) => () => void
- \`container\` is an HTMLElement you mount into. Read container.clientWidth / clientHeight for sizing; default to 960x600 if zero.
- \`libs\` is { p5, THREE, gsap }. Use ONLY these libraries. They are already loaded; do NOT import or require anything.
- Your code MUST end by returning a cleanup function that fully tears down: remove the canvas/renderer DOM node, cancel any requestAnimationFrame loop, kill gsap tweens, dispose three.js geometry/materials.
- Output RAW JavaScript only. No markdown fences. No \`import\`/\`export\`/\`require\`. No surrounding function wrapper, no \`function mount(...)\`, just the statements that go INSIDE the body. The host wraps it.
- The very last statement must be \`return <cleanupFn>;\`.
- Do not reference window/document globals beyond what you create inside container (you may use requestAnimationFrame, cancelAnimationFrame, setTimeout, Math, performance).`;

const EXAMPLE_2D = `EXAMPLE (2D, p5 instance mode) — the SHAPE your output must take:
const W = container.clientWidth || 960, H = container.clientHeight || 600;
const sketch = (p) => {
  let t = 0;
  p.setup = () => { p.createCanvas(W, H); p.frameRate(60); };
  p.draw = () => {
    p.background(14, 12, 13);
    t += 0.01;
    p.noFill();
    p.stroke(217, 138, 106);
    p.strokeWeight(1.5);
    p.push();
    p.translate(W / 2, H / 2);
    p.beginShape();
    for (let a = 0; a < p.TWO_PI; a += 0.05) {
      const r = 120 + 24 * Math.sin(a * 3 + t);
      p.vertex(Math.cos(a) * r, Math.sin(a) * r);
    }
    p.endShape(p.CLOSE);
    p.pop();
  };
};
const inst = new libs.p5(sketch, container);
return () => inst.remove();`;

const EXAMPLE_3D = `EXAMPLE (3D, three.js, flat shading) — the SHAPE your output must take:
const W = container.clientWidth || 960, H = container.clientHeight || 600;
const THREE = libs.THREE;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0c0d);
const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
camera.position.set(0, 0, 6);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(W, H);
container.appendChild(renderer.domElement);
const geo = new THREE.IcosahedronGeometry(1.6, 1);
const mat = new THREE.MeshBasicMaterial({ color: 0x7aa2c2, wireframe: true });
const mesh = new THREE.Mesh(geo, mat);
scene.add(mesh);
let raf = 0;
const loop = () => { mesh.rotation.y += 0.004; mesh.rotation.x += 0.002; renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
loop();
return () => {
  cancelAnimationFrame(raf);
  geo.dispose(); mat.dispose();
  renderer.dispose();
  renderer.domElement.remove();
};`;

function systemFor(renderer: Renderer): string {
  const example = renderer === "3d" ? EXAMPLE_3D : EXAMPLE_2D;
  const lib = renderer === "3d" ? "three.js (libs.THREE)" : "p5.js (libs.p5)";
  return `You are the code-generation agent for Mira. You write a single self-contained ${lib} animation as the body of a render module.

${CONTRACT}

${AESTHETIC}

${example}

Write ALL phases of the plan into ONE module: drive them by an internal timeline (elapsed time or phase index) so the scene progresses through the beats on one canvas/renderer. Do not create one canvas per phase. Produce ONLY the function body.`;
}

function buildPrompt(plan: ScenePlan): string {
  const phases = plan.phases
    .map(
      (ph, i) =>
        `${i + 1}. [${ph.id}] (${ph.approxDurationMs}ms) ${ph.intent}`,
    )
    .join("\n");
  return `Title: ${plan.title}

Phases to animate, in order, on a single timeline:
${phases}

Total runtime ~${plan.phases.reduce((s, p) => s + p.approxDurationMs, 0)}ms. Output the render-module body now.`;
}

function buildMutatePrompt(plan: ScenePlan, previousCode: string): string {
  return `You are EVOLVING an existing Mira render module, not rewriting it. Keep the structure, palette, and timeline of the previous code; change only what the new plan requires.

Previous render-module body:
${previousCode}

New plan to morph toward:
${plan.phases.map((ph, i) => `${i + 1}. [${ph.id}] (${ph.approxDurationMs}ms) ${ph.intent}`).join("\n")}

Output the full UPDATED render-module body (same contract, raw JS, returns cleanup). Preserve as much of the prior code as possible.`;
}

/**
 * Remove the model's most common contract violations:
 *  - markdown code fences,
 *  - a leading "(container, libs) => {" / "function mount" wrapper,
 *  - import/export/require lines.
 * We do NOT try to fully parse JS; the render host's new Function() is the real
 * validator. This just catches the predictable junk so valid output runs.
 */
export function sanitizeCode(raw: string): string {
  let code = raw.trim();

  // Strip a single wrapping ```js / ``` fence if present.
  const fence = code.match(/^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/);
  if (fence) code = fence[1].trim();
  // Defensive: strip any stray fence lines anywhere.
  code = code.replace(/^```[a-zA-Z]*\s*$/gm, "").trim();

  // Strip a leading arrow/function wrapper the model sometimes adds, e.g.
  // "(container, libs) => {" ... "}"  or  "function mount(container, libs) {" ... "}".
  const wrapper = code.match(
    /^(?:(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\w*\s*\([^)]*\)\s*\{|\([^)]*\)\s*=>\s*\{)\s*([\s\S]*)\}\s*;?\s*$/,
  );
  if (wrapper && /\breturn\b/.test(wrapper[1])) {
    code = wrapper[1].trim();
  }

  // Drop any import/export/require statements (libs are injected).
  code = code
    .split("\n")
    .filter((line) => {
      const l = line.trim();
      if (/^import[\s{('"*]/.test(l)) return false;
      if (/^export\s+(default\s+|\{|const|function|class)/.test(l)) return false;
      if (/\brequire\s*\(/.test(l)) return false;
      return true;
    })
    .join("\n")
    .trim();

  return code;
}

/** Cheap structural check: does it look like a runnable module body? */
export function looksRunnable(code: string): boolean {
  if (code.length < 40) return false;
  if (!/\breturn\b/.test(code)) return false;
  if (!/\b(container|libs)\b/.test(code)) return false;
  // Must reference at least one injected lib.
  if (!/libs\.(p5|THREE|gsap)/.test(code)) return false;
  return true;
}

export interface CodegenInput {
  plan: ScenePlan;
  abortSignal?: AbortSignal;
  /** Present on mutate: the prior runnable code to evolve. */
  previousCode?: string;
  /** Called with each raw streamed delta for SSE code_chunk events. */
  onDelta?: (delta: string) => void;
}

export interface CodegenResult {
  code: string;
  renderer: Renderer;
}

export async function generateCode(
  input: CodegenInput,
): Promise<CodegenResult> {
  const { plan, abortSignal, previousCode, onDelta } = input;
  const renderer = planRenderer(plan);

  const prompt =
    previousCode && previousCode.trim()
      ? buildMutatePrompt(plan, previousCode)
      : buildPrompt(plan);

  const opts: GenOptions = {
    systemInstruction: systemFor(renderer),
    thinkingLevel: ThinkingLevel.LOW,
    temperature: 0.6,
    maxOutputTokens: 8192,
    abortSignal,
  };

  let accumulated = "";
  for await (const delta of generateStream(prompt, opts)) {
    accumulated += delta;
    onDelta?.(delta);
  }

  const code = sanitizeCode(accumulated);
  return { code, renderer };
}
