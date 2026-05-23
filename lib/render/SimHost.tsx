"use client";

import { useEffect, useRef, useState } from "react";
import type {
  SceneContent,
  SceneController,
  SimLibs,
} from "@/lib/types";
import { loadRenderLibs } from "./libs";
import { getSim } from "@/lib/sims";
import { fallbackModule } from "./fallback";

export type SimStatus = "loading" | "live" | "fallback";

interface SimHostProps {
  /** Registry id of the sim to mount (SceneBundle.simId). */
  simId: string;
  /** Structured per-beat content + initial params + equation for the sim. */
  content: SceneContent;
  /** Bump to force a clean remount (replay, or new scene with same simId). */
  remountKey?: number;
  /** When false, the scene is torn down (paused) and the surface freezes. */
  playing: boolean;
  /**
   * External, narration-driven phase index. Driven into the controller via
   * setPhase WITHOUT remounting, so easing within a beat stays smooth. The
   * mounted sim reveals cumulatively up to this beat.
   */
  phase?: number;
  /**
   * Live control values keyed by ControlSpec.key. Each change is diffed against
   * the previous map and pushed into the controller via setParam — no remount.
   */
  params?: Record<string, number>;
  onStatusChange?: (status: SimStatus) => void;
}

/**
 * Render surface for the interactive-simulation path. Resolves a `Sim` from the
 * registry by id, calls `create(container, libs, content)`, and drives the
 * returned controller: `setPhase` on the narration beat, `setParam` per slider
 * change. Mirrors RenderHost's mount discipline — phase/param changes never
 * remount (that would restart the sim's rAF and kill the ease).
 *
 * Falls back to the ambient field if the sim id is unknown, its module hasn't
 * landed yet, or `create` throws — the stage is never blank during a demo.
 */
export default function SimHost({
  simId,
  content,
  remountKey = 0,
  playing,
  phase = 0,
  params,
  onStatusChange,
}: SimHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const libsRef = useRef<SimLibs | null>(null);
  const controllerRef = useRef<SceneController | null>(null);
  // Latest phase, read at mount so a sim mounting mid-playback lands on the
  // right beat immediately (kept in sync by the phase effect, never in render).
  const phaseRef = useRef(phase);
  // Last-applied param map, so the param effect only pushes actual deltas.
  const appliedParamsRef = useRef<Record<string, number>>({});
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

  // Mount / teardown. Deliberately does NOT depend on `phase` or `params` — a
  // beat or slider change drives the controller, it must not remount.
  useEffect(() => {
    const container = containerRef.current;
    const libs = libsRef.current;
    if (!container || !libs || !libsReady) return;

    // Paused: tear down, surface freezes on the poster behind it.
    if (!playing) {
      onStatusChange?.("loading");
      return;
    }

    let disposed = false;
    onStatusChange?.("loading");
    container.innerHTML = "";
    appliedParamsRef.current = {};

    const mountFallback = () => {
      container.innerHTML = "";
      try {
        const result = fallbackModule(container, libs);
        controllerRef.current =
          typeof result === "function"
            ? { setPhase: () => {}, dispose: result }
            : result;
      } catch {
        controllerRef.current = null;
      }
      onStatusChange?.("fallback");
    };

    getSim(simId).then((sim) => {
      if (disposed || !containerRef.current) return;
      if (!sim) {
        mountFallback();
        return;
      }
      try {
        const controller = sim.create(container, libs, content);
        controllerRef.current = controller;
        // Land on the current beat at mount (sim may mount mid-playback).
        try {
          controller.setPhase(Math.max(0, phaseRef.current));
        } catch {
          /* setPhase of a broken sim — ignore */
        }
        // Seed initial params: content.params overrides, falling back to each
        // control's default. Records what's applied so the param effect diffs.
        if (controller.setParam) {
          for (const ctrl of sim.controls) {
            const v = content.params?.[ctrl.key] ?? ctrl.default;
            try {
              controller.setParam(ctrl.key, v);
            } catch {
              /* setParam of a broken sim — ignore */
            }
            appliedParamsRef.current[ctrl.key] = v;
          }
        }
        onStatusChange?.("live");
      } catch {
        // create() threw → safe ambient field, container intact.
        mountFallback();
      }
    });

    return () => {
      disposed = true;
      try {
        controllerRef.current?.dispose();
      } catch {
        /* dispose of broken sim — ignore */
      }
      controllerRef.current = null;
      if (container) container.innerHTML = "";
    };
    // content is intentionally read at mount only; a content change ships with a
    // remountKey bump from the session, so we don't re-mount on its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simId, remountKey, playing, libsReady, onStatusChange]);

  // Drive the external phase into the live sim without remounting.
  useEffect(() => {
    phaseRef.current = phase;
    try {
      controllerRef.current?.setPhase(Math.max(0, phase));
    } catch {
      /* setPhase of a broken sim — ignore */
    }
  }, [phase]);

  // Push changed params into the live sim without remounting. Diffs against the
  // last-applied map so only real changes call through.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!params || !controller?.setParam) return;
    for (const key in params) {
      const value = params[key];
      if (appliedParamsRef.current[key] === value) continue;
      try {
        controller.setParam(key, value);
      } catch {
        /* setParam of a broken sim — ignore */
      }
      appliedParamsRef.current[key] = value;
    }
  }, [params]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 h-full w-full overflow-hidden [&_canvas]:!h-full [&_canvas]:!w-full [&_canvas]:object-cover"
      aria-hidden
    />
  );
}
