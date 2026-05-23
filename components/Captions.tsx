"use client";

import type { NarrationCue } from "@/lib/types";

interface CaptionsProps {
  cues: NarrationCue[];
  activeIndex: number;
}

/**
 * Narration captions. The currently-spoken cue is foregrounded; the next line
 * sits faded beneath it as a teaser (hidden on mobile to keep the band tight).
 */
export default function Captions({ cues, activeIndex }: CaptionsProps) {
  if (cues.length === 0) return null;

  const idx = activeIndex < 0 ? 0 : Math.min(activeIndex, cues.length - 1);
  const active = activeIndex < 0 ? null : cues[idx];
  const next = cues[idx + 1];

  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="mb-2 flex items-center gap-2">
        <span className="label">Narration</span>
        <span className="font-mono text-[10px] text-ink-faint">
          {activeIndex < 0 ? "—" : `${idx + 1} / ${cues.length}`}
        </span>
      </div>

      <p
        key={idx}
        className="anim-fade-up font-serif text-lg leading-relaxed text-ink sm:text-xl"
      >
        {active ? active.text : (
          <span className="text-ink-faint italic">
            Press play to begin the narrated walkthrough.
          </span>
        )}
      </p>

      {next && (
        <p className="mt-2 hidden font-serif text-base leading-relaxed text-ink-faint/70 sm:block">
          {next.text}
        </p>
      )}
    </div>
  );
}
