"use client";

import { useCallback, useEffect, useState } from "react";
import { useMiraSession } from "@/lib/useMiraSession";
import CommandPalette from "@/components/CommandPalette";
import HomeHero from "@/components/HomeHero";
import SceneStage from "@/components/SceneStage";
import GenerationPanel from "@/components/GenerationPanel";
import { IconSparkle, IconWarn } from "@/components/icons";

export default function Page() {
  const { state, generate, reset } = useMiraSession();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const hasScene = state.phase === "ready" && !!state.code;
  const isGenerating =
    state.phase !== "idle" &&
    state.phase !== "ready" &&
    state.phase !== "error";

  // global Cmd+K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = useCallback(
    (query: string) => {
      setPaletteOpen(false);
      // a query while a scene is live is a follow-up → mutate
      generate(query, hasScene);
    },
    [generate, hasScene],
  );

  return (
    <div className="relative flex min-h-dvh flex-col">
      <TopBar
        onOpenPalette={() => setPaletteOpen(true)}
        onReset={hasScene || state.phase === "error" ? reset : undefined}
        query={state.query}
      />

      <main className="flex flex-1 flex-col">
        {/* IDLE — hero + gallery */}
        {state.phase === "idle" && (
          <HomeHero onOpenPalette={() => setPaletteOpen(true)} onPick={submit} />
        )}

        {/* ERROR */}
        {state.phase === "error" && (
          <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full border border-coral/40 bg-coral/10 text-coral">
              <IconWarn className="h-5 w-5" />
            </span>
            <h2 className="mt-4 font-serif text-2xl text-ink">
              The engine stumbled
            </h2>
            <p className="mt-2 text-sm text-ink-dim">{state.error}</p>
            <button
              onClick={() => state.query && generate(state.query)}
              className="mt-6 rounded-full bg-coral px-5 py-2.5 text-sm font-medium text-paper transition-transform hover:scale-105 active:scale-95"
            >
              Try again
            </button>
          </div>
        )}

        {/* GENERATING + READY share the stage layout so the scene appears
            beneath the streaming panel and persists once ready. */}
        {(isGenerating || hasScene) && (
          <SceneLayout
            showStage={hasScene}
            generationPanel={
              isGenerating ? <GenerationPanel state={state} /> : null
            }
            stage={
              hasScene ? (
                <SceneStage
                  key={state.renderRev}
                  title={state.plan?.title ?? state.query ?? "Untitled scene"}
                  code={state.code}
                  renderer={state.renderer}
                  narration={state.narration}
                  renderRev={state.renderRev}
                />
              ) : null
            }
          />
        )}
      </main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSubmit={submit}
        hasScene={hasScene}
      />
    </div>
  );
}

/**
 * Desktop and mobile differ here, not just by breakpoint:
 *  - Desktop: stage fills a tall centered column; generation panel floats
 *    over it as an overlay card so the surface is visible behind streaming.
 *  - Mobile: full-bleed stacked layout, stage on top, panel as a sheet.
 */
function SceneLayout({
  stage,
  generationPanel,
  showStage,
}: {
  stage: React.ReactNode;
  generationPanel: React.ReactNode;
  showStage: boolean;
}) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-6 pt-3 sm:px-6 sm:pb-10">
      {showStage ? (
        <div className="anim-fade-up flex flex-1 flex-col">{stage}</div>
      ) : (
        // generation-only: ambient stage placeholder behind the streaming panel
        <div className="relative flex min-h-[68vh] flex-1 items-center justify-center">
          <div className="absolute inset-0 rounded-2xl border border-[var(--hairline)] bg-[var(--paper-raised)]" />
          <div className="relative z-10 w-full px-4">{generationPanel}</div>
        </div>
      )}
    </div>
  );
}

function TopBar({
  onOpenPalette,
  onReset,
  query,
}: {
  onOpenPalette: () => void;
  onReset?: () => void;
  query: string | null;
}) {
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-[var(--hairline)] bg-[var(--paper)]/70 px-4 py-3 backdrop-blur-xl sm:px-6">
      <button
        onClick={onReset}
        disabled={!onReset}
        className="flex items-center gap-2 disabled:cursor-default"
      >
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-coral to-amber text-paper">
          <IconSparkle className="h-4 w-4" />
        </span>
        <span className="font-serif text-lg tracking-tight text-ink">Mira</span>
      </button>

      {/* current query breadcrumb (desktop) */}
      {query && (
        <span className="hidden min-w-0 flex-1 truncate px-4 text-center font-serif text-sm italic text-ink-faint sm:block">
          “{query}”
        </span>
      )}

      <button
        onClick={onOpenPalette}
        className="flex items-center gap-2 rounded-full border border-[var(--hairline-strong)] px-3 py-1.5 text-sm text-ink-dim transition-colors hover:border-coral/40 hover:text-ink"
      >
        <span className="hidden sm:inline">Ask</span>
        <kbd className="rounded border border-[var(--hairline-strong)] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">
          ⌘K
        </kbd>
      </button>
    </header>
  );
}
