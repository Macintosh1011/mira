/**
 * Code-gen agent: ScenePlan -> a single render-module body string.
 *
 * STRATEGY: the model is a COMPOSITOR, not a painter. It does NOT draw beautiful
 * animation from scratch (unreliable). Instead it arranges a hand-built library
 * of high-quality primitives (lib/kit) injected as `libs.kit`. The reference
 * aesthetic lives in the kit; the model's job is layout, timeline, and which
 * primitives to call. The system prompt below hands it the full kit API surface
 * plus two gold-standard example bodies that reach reference quality, and tells
 * it to generate "in exactly this style".
 *
 * The output is the BODY of `(container, libs) => () => void` (see RenderModule
 * in lib/types.ts). The render host does `new Function("container","libs",code)`
 * and calls the returned cleanup on unmount. So the string MUST:
 *   - use only `container` and `libs` ({ p5, THREE, gsap, kit }) as inputs,
 *   - mount into `container`,
 *   - return a cleanup function,
 *   - contain NO import/export/markdown fences (libs are injected).
 *
 * We stream raw deltas to the UI (code_chunk events) while accumulating, then
 * sanitize the full string before emitting code_done. We defensively strip the
 * common failure modes (fences, stray imports). The SSE contract is unchanged.
 */
import { generateStream, ThinkingLevel, type GenOptions } from "@/lib/gemini";
import type { ScenePlan, Renderer } from "@/lib/types";
import { planRenderer } from "./orchestrator";
import { FED_RATE_CUT_BODY, NN_CLASSIFIER_BODY, ORBIT_3D_BODY } from "@/lib/kit/examples";

const CONTRACT = `OUTPUT CONTRACT (non-negotiable):
You output the BODY of a JavaScript function with this exact signature:
    (container, libs) => () => void
- \`container\` is an HTMLElement you mount into. Read container.clientWidth / clientHeight; default to 1280x720 if zero.
- \`libs\` is { p5, THREE, gsap, kit }. They are already loaded; do NOT import or require anything.
- Your code MUST end with \`return <cleanupFn>;\` that fully tears down: remove the canvas/renderer DOM node, cancel any requestAnimationFrame loop, kill gsap tweens, dispose three.js geometry/materials.
- Output RAW JavaScript only. No markdown fences. No import/export/require. No surrounding function wrapper, no \`function mount(...)\` — just the statements that go INSIDE the body. The host wraps it.
- Do not touch window/document beyond what you create inside container (you may use requestAnimationFrame, cancelAnimationFrame, setTimeout, Math, performance, window.devicePixelRatio, window resize listeners that you remove in cleanup).`;

const AESTHETIC = `AESTHETIC (the Mira house style — already baked into the kit, keep it):
- Tinted near-black paper #0c0c0e (kit.palette.bg). PURE BLACK #000 IS BANNED.
- Text ~95% white #f4f4f5 (kit.palette.fg). PURE WHITE #fff IS BANNED.
- One accent: yellow #efc540 (kit.palette.accent), reserved for active states / values / highlights — never a flat fill, never decoration. Topic colors for multi-series: terracotta, teal, blue, pink, deepRed (all on kit.palette).
- Strokes 1.5px, never harsh. Quintic / smoothstep easing (kit.ease.*). Flat shading on 3D.
- Composed even when paused. Small labels where they aid understanding. Generous spacing, centered composition.`;

// The full API surface. The model picks from THESE; it should only drop to raw
// p5 for things no primitive covers.
const KIT_API = `KIT API (libs.kit) — PREFER these primitives; every drawing call takes the live p5 instance \`p\` first:

  palette: { bg, surface, fg, fgMuted, fgSubtle, accent, terracotta, teal, blue, pink, deepRed, hairline, hairlineStrong }  // RGB tuples [r,g,b] 0..255
  ease:    { linear, quintic, smoothstep, smootherstep, outCubic, outQuint, inOutCubic, overshoot }  // each (t:0..1)=>0..1

  // paint + math helpers
  fill(p, rgb, alpha=1)                       // alpha 0..1
  stroke(p, rgb, alpha=1, weight=1.5)
  hexToRgb("#rrggbb") -> rgb
  clamp01(x) ; lerp(a,b,t)
  useFonts(p)                                 // call once in p.setup

  // backgrounds & scaffolding
  grid(p, { reveal=1, cell=100, wash=accent })          // paints bg + radial accent wash + faint sub-grid. Call FIRST each frame.
  phaseDots(p, { x, y, total, current, label?, color? }) // bottom-left phase timeline

  // typography
  label(p, { x, y, text, size=13, upper?, color=fg, mono?, align="center", alpha=1, weight? })
  valueFlip(p, { x, y, from, to, t, size=28, color=accent, align? })   // t 0..1 crossfades from->to
  deltaTri(p, { x, y, dir:"up"|"down", size=11, color=accent, reveal=1 })

  // node-graph vocabulary (the Fed topic): a stacked-circle "card"
  node(p, { x, y, r, label?, sublabel?, value?, color=accent, reveal=1, settle=1, delta?:"up"|"down"|null })
       // hero ring at 18% alpha (brightens with settle) + inner card + uppercase sublabel + big mono value + label below.
       // If you crossfade the value, omit \`value\` and overlay valueFlip at center.
  flowEdge(p, { x1, y1, x2, y2, t, color=accent, reveal=1, active=true })  // faint base line + flowing accent dash; t = seconds clock
  signal(p, { x1, y1, x2, y2, t, color=accent, reveal=1 })                 // brighter/faster dashed pulse along a path
  gauge(p, { x, y, from:number, to:number, t, label?, unit?, color?, decimals? })  // labeled numeric readout that flips

  // network vocabulary (the NN topic)
  neuron(p, { x, y, r=11, active?, settled?, winner?, label?, color=accent, reveal=1 })  // active/winner glow, settled=muted gray
  neuronLayer(p, { x, ys:number[], active?:bool[], settled?:bool[], labels?:string[], title?, sublabel?, r=11, color?, reveal=1 })
  connectBundle(p, { from:{x,y}[], to:{x,y}[], inset=12, reveal=1 })       // faint full bundle of base edges between two columns
  pixelGrid(p, { x, y, cell, data:number[][], reveal=1, color=accent, frame? })  // 0/1 (or 0..1) matrix; cells light up in scan order
  confidenceBar(p, { x, y, w=80, value:0..1, color=accent, showPct=true })

  // chart vocabulary
  axes(p, { x, y, w, h, reveal=1, xLabel?, yLabel? })
  plotLine(p, { x, y, w, h, points:{x,y}[], t, color=accent, head=true })  // points normalized 0..1; t = draw-on progress

  // 3D (flat shaded) — for genuinely spatial scenes only
  scene3d(THREE, container, { fov=50, distance=6, bg? }) -> { scene, camera, renderer, render(), resize(), dispose() }
  flatSphere(THREE, r, rgb, wire=false) -> Mesh    // Lambert flatShading, or wireframe
  flatLine(THREE, pts:number[][], rgb) -> Line`;

const TIMELINE_GUIDE = `TIMELINE: write ALL phases into ONE module on a single self-driven clock (use p.millis() inside the p5 sketch, or performance.now() for 3D). Compute a phase index from elapsed time and a per-phase \`local\` progress 0..1 eased with kit.ease.outCubic. Reveal CUMULATIVELY: once a beat appears it stays; later beats reveal on top. Pass that progress as \`reveal\` / \`settle\` / \`t\` into kit primitives — do NOT invent your own tween system. Use a seconds clock (p.millis()/1000) for flowEdge/signal dash flow. Design the layout in a 1600x900 space and scale-to-fit the container (see examples), so coordinates stay readable.`;

function systemFor(renderer: Renderer): string {
  if (renderer === "3d") {
    return `You are the code-generation agent for Mira. You COMPOSE a self-contained three.js scene as the body of a render module, using the injected kit's flat-shaded 3D helpers.

${CONTRACT}

${AESTHETIC}

${KIT_API}

Use kit.scene3d / kit.flatSphere / kit.flatLine for the scene; drop to raw libs.THREE only for shapes the kit lacks. Drive motion with an rAF loop. Generate in EXACTLY the style of this example:

${ORBIT_3D_BODY}

${TIMELINE_GUIDE}

Produce ONLY the function body.`;
  }
  return `You are the code-generation agent for Mira. You are a COMPOSITOR: you do not draw from scratch, you arrange the injected kit's hand-built primitives (libs.kit) into a scene. The reference aesthetic lives in the kit — your job is layout, timeline, and which primitives to call.

${CONTRACT}

${AESTHETIC}

${KIT_API}

${TIMELINE_GUIDE}

Generate in EXACTLY the style of these two gold-standard examples. Reuse the same patterns: kit.grid first, a 1600x900 scale-to-fit transform, cumulative phase reveals, kit primitives for every visual element.

=== EXAMPLE A: node-graph (Fed rate cut) ===
${FED_RATE_CUT_BODY}

=== EXAMPLE B: network (NN classifier) ===
${NN_CLASSIFIER_BODY}

Now compose a NEW scene for the requested topic in this style. Prefer kit primitives; only drop to raw p5 (via the \`p\` instance) for something no primitive covers, and even then keep the exact palette/strokes/easing from kit. Produce ONLY the function body.`;
}

function buildPrompt(plan: ScenePlan): string {
  const phases = plan.phases
    .map((ph, i) => `${i + 1}. [${ph.id}] (${ph.approxDurationMs}ms) ${ph.intent}`)
    .join("\n");
  return `Title: ${plan.title}

Phases to animate, in order, on a single timeline:
${phases}

Total runtime ~${plan.phases.reduce((s, p) => s + p.approxDurationMs, 0)}ms.

Choose the kit vocabulary that fits the topic (node-graph, network, chart, or a mix). Output the render-module body now.`;
}

function buildMutatePrompt(plan: ScenePlan, previousCode: string): string {
  return `You are EVOLVING an existing Mira render module, not rewriting it. Keep its structure, the kit primitives it uses, palette, and timeline; change only what the new plan requires. Stay a compositor — keep composing from libs.kit.

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
  // Must reference at least one injected lib (kit counts — it's the happy path).
  if (!/libs\.(p5|THREE|gsap|kit)/.test(code)) return false;
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
    // MINIMAL thinking lands more single-shot successes inside the code budget;
    // the deterministic generic scene is the safety net under it.
    thinkingLevel: ThinkingLevel.MINIMAL,
    temperature: 0.55,
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
