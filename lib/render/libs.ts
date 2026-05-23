"use client";

import type { SimLibs } from "@/lib/types";
import { createKit } from "@/lib/kit";

/**
 * p5 / three / gsap all touch `window` at import time, so they can only load
 * in the browser. We dynamic-import them lazily and cache the resolved libs
 * bundle so every scene shares one instance.
 *
 * Returns a `SimLibs` (RenderLibs + katex). Legacy code-string modules accept
 * the narrower RenderLibs and structurally ignore the extra `katex` field;
 * Sims receive the full bundle for equation rendering.
 */
let cache: SimLibs | null = null;
let pending: Promise<SimLibs> | null = null;

export async function loadRenderLibs(): Promise<SimLibs> {
  if (cache) return cache;
  if (pending) return pending;

  pending = (async () => {
    const [p5Mod, threeMod, gsapMod, katexMod] = await Promise.all([
      import("p5"),
      import("three"),
      import("gsap"),
      import("katex"),
    ]);

    cache = {
      p5: p5Mod.default,
      THREE: threeMod,
      gsap: gsapMod.gsap ?? gsapMod.default,
      kit: createKit(),
      katex: katexMod.default ?? katexMod,
    };
    return cache;
  })();

  return pending;
}
