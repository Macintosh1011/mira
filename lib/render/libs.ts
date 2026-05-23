"use client";

import type { RenderLibs } from "@/lib/types";

/**
 * p5 / three / gsap all touch `window` at import time, so they can only load
 * in the browser. We dynamic-import them lazily and cache the resolved libs
 * bundle so every scene shares one instance.
 */
let cache: RenderLibs | null = null;
let pending: Promise<RenderLibs> | null = null;

export async function loadRenderLibs(): Promise<RenderLibs> {
  if (cache) return cache;
  if (pending) return pending;

  pending = (async () => {
    const [p5Mod, threeMod, gsapMod] = await Promise.all([
      import("p5"),
      import("three"),
      import("gsap"),
    ]);

    cache = {
      p5: p5Mod.default,
      THREE: threeMod,
      gsap: gsapMod.gsap ?? gsapMod.default,
    };
    return cache;
  })();

  return pending;
}
