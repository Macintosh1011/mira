"use client";

import { useEffect, useRef, useState } from "react";
import type { RenderLibs, RenderModule } from "@/lib/types";
import { loadRenderLibs } from "./libs";
import { compileSceneCode } from "./compile";
import { fallbackModule } from "./fallback";

export type RenderStatus = "loading" | "live" | "fallback";

interface RenderHostProps {
  /** SceneBundle.code body, or null to show the ambient fallback field. */
  code: string | null;
  /** Bump to force a clean remount (e.g. replay, or new scene with same code). */
  remountKey?: number;
  /** When false, the scene is torn down (paused) and the surface is frozen. */
  playing: boolean;
  onStatusChange?: (status: RenderStatus) => void;
}

/**
 * Owns the live render surface. Loads p5/three/gsap client-side, compiles the
 * generated code, and mounts it into a container. Any compile OR runtime throw
 * falls back to a hand-written p5 sketch so the stage is never blank.
 *
 * Pausing tears the scene down (animations are self-driven via rAF inside the
 * mounted module; there's no shared clock to freeze), and resuming remounts it.
 */
export default function RenderHost({
  code,
  remountKey = 0,
  playing,
  onStatusChange,
}: RenderHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const libsRef = useRef<RenderLibs | null>(null);
  const [libsReady, setLibsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadRenderLibs().then((libs) => {
      if (cancelled) return;
      libsRef.current = libs;
      setLibsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const libs = libsRef.current;
    if (!container || !libs || !libsReady) return;

    // Paused: nothing mounted, surface frozen on the poster behind it.
    if (!playing) {
      onStatusChange?.("loading");
      return;
    }

    container.innerHTML = "";
    let cleanup: (() => void) | null = null;

    const mount = (module: RenderModule, status: RenderStatus) => {
      try {
        cleanup = module(container, libs);
        onStatusChange?.(status);
      } catch {
        // Runtime throw from generated code → wipe and run the safe sketch.
        container.innerHTML = "";
        try {
          cleanup = fallbackModule(container, libs);
        } catch {
          cleanup = null;
        }
        onStatusChange?.("fallback");
      }
    };

    if (code && code.trim()) {
      const compiled = compileSceneCode(code);
      if (compiled.ok) {
        mount(compiled.module, "live");
      } else {
        mount(fallbackModule, "fallback");
      }
    } else {
      // No generated code yet — ambient field, not an error state.
      mount(fallbackModule, "fallback");
    }

    return () => {
      try {
        cleanup?.();
      } catch {
        /* cleanup of broken module — ignore */
      }
      if (container) container.innerHTML = "";
    };
  }, [code, remountKey, playing, libsReady, onStatusChange]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 h-full w-full overflow-hidden [&_canvas]:!h-full [&_canvas]:!w-full [&_canvas]:object-cover"
      aria-hidden
    />
  );
}
