import type { RenderLibs, RenderModule } from "@/lib/types";

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
 * `code` is the BODY of `(container, libs) => () => void` per lib/types.ts.
 * We wrap it with `new Function("container","libs", code)`. This is only ever
 * compilation — execution (and its try/catch) lives in the render host so a
 * runtime throw can fall back to the safe sketch with the container intact.
 */
export function compileSceneCode(code: string): CompileResult {
  try {
    const fn = new Function("container", "libs", code) as (
      container: HTMLElement,
      libs: RenderLibs,
    ) => () => void;

    return { ok: true, module: fn };
  } catch (err) {
    return {
      ok: false,
      module: () => () => {},
      error: err instanceof Error ? err.message : "Failed to compile scene code.",
    };
  }
}
