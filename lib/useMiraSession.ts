"use client";

import { useCallback, useRef, useState } from "react";
import type {
  GenerateEvent,
  NarrationCue,
  Renderer,
  ScenePlan,
} from "@/lib/types";
import { streamGenerate, type GenerateHandle } from "@/lib/sse";

export type Phase =
  | "idle"
  | "planning"
  | "coding"
  | "narrating"
  | "verifying"
  | "ready"
  | "error";

export interface VerifyState {
  status: "ok" | "warn" | "block";
  note?: string;
}

export interface SessionState {
  phase: Phase;
  query: string | null;
  plan: ScenePlan | null;
  /** Live-accumulating generated code (streams in as chunks). */
  code: string;
  renderer: Renderer;
  narration: NarrationCue[];
  verify: VerifyState | null;
  error: string | null;
  sceneId: string | null;
  /** Indices of plan phases whose code has finished. */
  completedPhases: number;
  /** Bumped on every successful done → forces a fresh render mount. */
  renderRev: number;
}

const initial: SessionState = {
  phase: "idle",
  query: null,
  plan: null,
  code: "",
  renderer: "2d",
  narration: [],
  verify: null,
  error: null,
  sceneId: null,
  completedPhases: 0,
  renderRev: 0,
};

export function useMiraSession() {
  const [state, setState] = useState<SessionState>(initial);
  const handleRef = useRef<GenerateHandle | null>(null);

  const reset = useCallback(() => {
    handleRef.current?.abort();
    handleRef.current = null;
    setState(initial);
  }, []);

  const generate = useCallback((query: string, mutate = false) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    handleRef.current?.abort();

    setState((prev) => ({
      ...initial,
      renderRev: prev.renderRev, // keep render revision monotonic
      phase: "planning",
      query: trimmed,
      // a mutate keeps the prior plan title visible until the new one lands
      plan: mutate ? prev.plan : null,
    }));

    const prevSceneId = mutate ? state.sceneId ?? undefined : undefined;

    handleRef.current = streamGenerate(
      {
        query: trimmed,
        mode: mutate ? "mutate" : "new",
        previousSceneId: prevSceneId,
      },
      {
        onEvent: (event: GenerateEvent) => {
          setState((prev) => applyEvent(prev, event));
        },
        onError: (message) => {
          setState((prev) =>
            prev.phase === "ready"
              ? prev // a late error after success — keep the scene
              : { ...prev, phase: "error", error: message },
          );
        },
      },
    );
  }, [state.sceneId]);

  return { state, generate, reset };
}

function applyEvent(prev: SessionState, event: GenerateEvent): SessionState {
  switch (event.type) {
    case "plan":
      return {
        ...prev,
        phase: "coding",
        plan: event.plan,
        sceneId: event.plan.id,
      };

    case "code_chunk":
      return { ...prev, phase: "coding", code: prev.code + event.delta };

    case "code_done":
      return {
        ...prev,
        phase: "narrating",
        code: event.code,
        renderer: event.renderer,
        sceneId: event.sceneId,
        completedPhases: Math.max(prev.completedPhases, prev.completedPhases + 1),
      };

    case "narration":
      return { ...prev, narration: [...prev.narration, event.cue] };

    case "verify":
      return {
        ...prev,
        phase: "verifying",
        verify: { status: event.status, note: event.note },
      };

    case "error":
      // a soft error mid-stream — surface it but don't wipe a usable scene
      return prev.code
        ? { ...prev, verify: { status: "warn", note: event.message } }
        : { ...prev, phase: "error", error: event.message };

    case "done":
      return {
        ...prev,
        phase: "ready",
        sceneId: event.bundle.sceneId,
        code: event.bundle.code,
        renderer: event.bundle.renderer,
        narration: event.bundle.narration,
        renderRev: prev.renderRev + 1,
      };

    default:
      return prev;
  }
}
