"use client";

import { useEffect, useRef, useState } from "react";
import type { RenderLibs, RenderModule, SceneController } from "@/lib/types";
import { loadRenderLibs } from "./libs";
import { compileSceneCode, mountModule } from "./compile";
import { fallbackModule } from "./fallback";

export type RenderStatus = "loading" | "live" | "fallback";

interface RenderHostProps {
  /** SceneBundle.code body, or null to show the ambient fallback field. */
  code: string | null;
  /** Bump to force a clean remount (e.g. replay, or new scene with same code). */
  remountKey?: number;
  /** When false, the scene is torn down (paused) and the surface is frozen. */
  playing: boolean;
  /**
   * External, narration-driven phase index. The mounted scene reveals
   * cumulatively up to this beat. Phase BOUNDARIES come from here (voice sync);
   * the scene only eases WITHIN a beat off its own rAF. Changing `phase` does
   * NOT remount — it calls the controller's setPhase so easing stays smooth.
   */
  phase?: number;
  onStatusChange?: (status: RenderStatus) => void;
}

/**
 * Owns the live render surface. Loads p5/three/gsap client-side, compiles the
 * generated code, mounts it into a container, and drives its phase from the
 * external `phase` prop. Any compile OR runtime throw falls back to a
 * hand-written p5 sketch so the stage is never blank.
 *
 * Pausing tears the scene down (animations are self-driven via rAF inside the
 * mounted module; there's no shared clock to freeze), and resuming remounts it.
 */
export default function RenderHost({
  code,
  remountKey = 0,
  playing,
  phase = 0,
  onStatusChange,
}: RenderHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const libsRef = useRef<RenderLibs | null>(null);
  const controllerRef = useRef<SceneController | null>(null);
  // Latest phase, read at mount time so a scene mounting mid-playback lands on
  // the correct beat immediately (not always phase 0). Kept in sync by the
  // phase-driven effect below (never written during render).
  const phaseRef = useRef(phase);
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

  // Mount / teardown. Deliberately does NOT depend on `phase` — a phase change
  // must not remount the scene (that would restart its rAF and kill the ease).
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

    const mount = (module: RenderModule, status: RenderStatus) => {
      try {
        const controller = mountModule(module, container, libs);
        controllerRef.current = controller;
        // Land on the current beat at mount (scene may mount mid-playback).
        try {
          controller.setPhase(Math.max(0, phaseRef.current));
        } catch {
          /* setPhase of a broken module — ignore */
        }
        onStatusChange?.(status);
      } catch {
        // Runtime throw from generated code → wipe and run the safe sketch.
        container.innerHTML = "";
        try {
          controllerRef.current = mountModule(fallbackModule, container, libs);
        } catch {
          controllerRef.current = null;
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
        controllerRef.current?.dispose();
      } catch {
        /* dispose of broken module — ignore */
      }
      controllerRef.current = null;
      if (container) container.innerHTML = "";
    };
  }, [code, remountKey, playing, libsReady, onStatusChange]);

  // Drive the external phase into the live scene without remounting. Also keep
  // phaseRef current so a (re)mount lands on the right beat immediately.
  useEffect(() => {
    phaseRef.current = phase;
    try {
      controllerRef.current?.setPhase(Math.max(0, phase));
    } catch {
      /* setPhase of a broken module — ignore */
    }
  }, [phase]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 h-full w-full overflow-hidden [&_canvas]:!h-full [&_canvas]:!w-full [&_canvas]:object-cover"
      aria-hidden
    />
  );
}
