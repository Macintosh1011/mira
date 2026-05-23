import type { RenderLibs, RenderModule, SceneController } from "@/lib/types";

export interface CompileResult {
  ok: boolean;
  /** The mount function, ready to call with (container, libs). */
  module: RenderModule;
  /** Set when compilation (not execution) failed. */
  error?: string;
}

/**
 * Turn a SceneBundle.code string into a callable RenderModule.
 *
 * `code` is the BODY of `(container, libs) => SceneController` per lib/types.ts.
 * We wrap it with `new Function("container","libs", code)`. This is only ever
 * compilation — execution (and its try/catch) lives in the render host so a
 * runtime throw can fall back to the safe sketch with the container intact.
 */
export function compileSceneCode(code: string): CompileResult {
  try {
    const fn = new Function("container", "libs", code) as RenderModule;
    return { ok: true, module: fn };
  } catch (err) {
    return {
      ok: false,
      module: () => ({ setPhase: () => {}, dispose: () => {} }),
      error: err instanceof Error ? err.message : "Failed to compile scene code.",
    };
  }
}

/**
 * Run a render module and normalize whatever it returns into a SceneController.
 * New scenes return `{ setPhase, dispose }`; legacy bodies (hand-authored cache
 * bundles on the old contract) return a bare cleanup function — treat that as a
 * no-op setPhase plus that function as dispose, so both shapes drive uniformly.
 */
export function mountModule(
  module: RenderModule,
  container: HTMLElement,
  libs: RenderLibs,
): SceneController {
  const result = module(container, libs);
  if (typeof result === "function") {
    return { setPhase: () => {}, dispose: result };
  }
  if (result && typeof result.dispose === "function") {
    return {
      setPhase: typeof result.setPhase === "function" ? result.setPhase : () => {},
      dispose: result.dispose,
    };
  }
  // Module returned nothing usable — give a safe inert controller.
  return { setPhase: () => {}, dispose: () => {} };
}
