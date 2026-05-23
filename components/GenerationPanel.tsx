"use client";

import type { Phase, SessionState } from "@/lib/useMiraSession";
import { IconCheck, IconWarn } from "./icons";

interface GenerationPanelProps {
  state: SessionState;
}

const STEPS: { key: Phase; label: string }[] = [
  { key: "planning", label: "Planning the scene" },
  { key: "coding", label: "Writing the animation" },
  { key: "narrating", label: "Composing narration" },
  { key: "verifying", label: "Verifying against narration" },
];

const ORDER: Record<Phase, number> = {
  idle: 0,
  planning: 1,
  coding: 2,
  narrating: 3,
  verifying: 4,
  ready: 5,
  error: 5,
};

/**
 * The streaming surface. Shows the plan appearing, then per-phase render
 * progress ("rendering scene 1…"), then the verifier verdict. Lives over the
 * stage while the engine works; the parent hides it once phase === "ready".
 */
export default function GenerationPanel({ state }: GenerationPanelProps) {
  const { phase, plan, completedPhases, verify } = state;
  const current = ORDER[phase];

  return (
    <div className="glass anim-fade-up mx-auto w-full max-w-md rounded-2xl p-6">
      <div className="flex items-center gap-2">
        <span className="anim-pulse h-1.5 w-1.5 rounded-full bg-coral" />
        <span className="label">Generating</span>
      </div>

      <h3 className="mt-3 font-serif text-2xl leading-tight text-ink">
        {plan?.title ?? (
          <span className="shimmer inline-block h-7 w-3/4 rounded" />
        )}
      </h3>

      {/* step ladder */}
      <ol className="mt-5 space-y-2.5">
        {STEPS.map((step, i) => {
          const stepOrder = ORDER[step.key];
          const done = current > stepOrder || phase === "ready";
          const live = current === stepOrder && phase !== "ready";
          return (
            <li key={step.key} className="flex items-center gap-3">
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] transition-colors ${
                  done
                    ? "border-transparent bg-[var(--c-green)] text-paper"
                    : live
                      ? "border-coral text-coral"
                      : "border-[var(--hairline-strong)] text-ink-faint"
                }`}
              >
                {done ? (
                  <IconCheck />
                ) : live ? (
                  <span className="anim-spin block h-2.5 w-2.5 rounded-full border border-coral border-t-transparent" />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={`text-sm transition-colors ${
                  done
                    ? "text-ink-dim"
                    : live
                      ? "text-ink"
                      : "text-ink-faint"
                }`}
              >
                {step.label}
                {live && step.key === "coding" && plan && (
                  <span className="text-ink-faint">
                    {" "}
                    · scene {Math.min(completedPhases + 1, plan.phases.length)} of{" "}
                    {plan.phases.length}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {/* phase chips */}
      {plan && plan.phases.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-1.5">
          {plan.phases.map((p, i) => (
            <span
              key={p.id}
              className={`rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors ${
                i < completedPhases
                  ? "border-[var(--c-green)]/40 text-[var(--c-green)]"
                  : "border-[var(--hairline-strong)] text-ink-faint"
              }`}
              title={p.intent}
            >
              {p.renderer.toUpperCase()} · {p.intent.slice(0, 28)}
              {p.intent.length > 28 ? "…" : ""}
            </span>
          ))}
        </div>
      )}

      {/* verifier verdict */}
      {verify && verify.status !== "ok" && (
        <div
          className={`mt-5 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
            verify.status === "block"
              ? "border-coral/40 bg-coral/10 text-coral"
              : "border-amber/40 bg-amber/10 text-amber"
          }`}
        >
          <IconWarn className="mt-0.5 shrink-0" />
          <span>{verify.note ?? "The verifier flagged this scene."}</span>
        </div>
      )}
    </div>
  );
}
