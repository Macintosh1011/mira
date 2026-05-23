"use client";

import { EXAMPLE_QUERIES } from "@/lib/examples";
import { IconSparkle, IconArrowReturn } from "./icons";

interface HomeHeroProps {
  onOpenPalette: () => void;
  onPick: (query: string) => void;
}

const accentMap = {
  yellow: "var(--c-yellow)",
  green: "var(--c-green)",
  blue: "var(--c-blue)",
  terra: "var(--c-terra)",
} as const;

/**
 * The empty state: brand statement, the Cmd+K entry, and a gallery of example
 * queries. Clicking a card fires it directly; the big bar opens the palette.
 */
export default function HomeHero({ onOpenPalette, onPick }: HomeHeroProps) {
  return (
    <div className="anim-fade-up mx-auto flex w-full max-w-3xl flex-col items-center px-6 py-16 text-center sm:py-24">
      <span className="label">The visualization layer for thinking</span>

      <h1 className="mt-5 font-serif text-5xl leading-[1.05] tracking-[-0.02em] text-ink sm:text-7xl">
        Speak an idea.
        <br />
        <span className="italic text-ink-dim">Watch it think.</span>
      </h1>

      <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-dim sm:text-lg">
        Mira turns a single sentence into a narrated, animated explanation that
        renders live in your browser. Ask a follow-up and the scene morphs.
      </p>

      {/* fake command bar — opens the real palette */}
      <button
        onClick={onOpenPalette}
        className="glass group mt-10 flex w-full max-w-lg items-center gap-3 rounded-2xl px-5 py-4 text-left transition-colors hover:border-coral/30"
      >
        <IconSparkle className="shrink-0 text-coral" />
        <span className="flex-1 font-serif text-lg text-ink-faint">
          Describe an idea to visualize…
        </span>
        <kbd className="flex items-center gap-1 rounded-md border border-[var(--hairline-strong)] bg-white/[0.03] px-2 py-1 font-mono text-[11px] text-ink-dim">
          ⌘K
        </kbd>
      </button>

      {/* gallery */}
      <div className="mt-12 w-full">
        <div className="mb-4 flex items-center justify-center gap-3">
          <span className="h-px w-8 bg-[var(--hairline-strong)]" />
          <span className="label">Try one of these</span>
          <span className="h-px w-8 bg-[var(--hairline-strong)]" />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {EXAMPLE_QUERIES.map((ex) => (
            <button
              key={ex.query}
              onClick={() => onPick(ex.query)}
              className="glass group relative overflow-hidden rounded-xl p-4 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--hairline-strong)]"
            >
              <span
                className="absolute inset-x-0 top-0 h-[3px] opacity-70 transition-opacity group-hover:opacity-100"
                style={{ background: accentMap[ex.accent] }}
              />
              <div className="flex items-center justify-between">
                <span className="label">{ex.domain}</span>
                <IconArrowReturn className="text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <p className="mt-2 font-serif text-[15px] leading-snug text-ink">
                {ex.query}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
