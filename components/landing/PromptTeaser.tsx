"use client";

/**
 * Landing teaser: a faux command line that auto-types evocative questions, holds,
 * erases, and cycles — so the empty state moves and previews what you can ask
 * without a static list. Click it to open the palette. The typewriter runs only
 * on the client (in an effect), so SSR renders an empty line and never mismatches.
 */

import { useEffect, useRef, useState } from "react";

const PROMPTS = [
  "how a black hole bends the light around it",
  "why a traffic jam forms out of nothing",
  "how a neuron fires, then resets",
  "what a transformer head pays attention to",
  "how a Fed rate cut reaches your mortgage",
  "how a virus burns through a population",
  "how a wing actually generates lift",
];

export default function PromptTeaser({ onActivate }: { onActivate: () => void }) {
  const [text, setText] = useState("");
  const idx = useRef(0);
  const ch = useRef(0);
  const mode = useRef<"typing" | "holding" | "deleting">("typing");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const full = PROMPTS[idx.current % PROMPTS.length];
      if (mode.current === "typing") {
        ch.current += 1;
        setText(full.slice(0, ch.current));
        if (ch.current >= full.length) {
          mode.current = "holding";
          timer = setTimeout(tick, 2000);
          return;
        }
        timer = setTimeout(tick, 34 + Math.random() * 46);
      } else if (mode.current === "holding") {
        mode.current = "deleting";
        timer = setTimeout(tick, 30);
      } else {
        ch.current -= 2;
        setText(full.slice(0, Math.max(0, ch.current)));
        if (ch.current <= 0) {
          mode.current = "typing";
          idx.current += 1;
          ch.current = 0;
          timer = setTimeout(tick, 320);
          return;
        }
        timer = setTimeout(tick, 16);
      }
    };
    timer = setTimeout(tick, 700);
    return () => clearTimeout(timer);
  }, []);

  return (
    <button
      type="button"
      className="prompt-teaser"
      onClick={onActivate}
      aria-label="Open the command palette to ask a question"
    >
      <span className="pt-prefix">try</span>
      <span className="pt-text">{text}</span>
      <span className="pt-caret" aria-hidden="true" />
    </button>
  );
}
