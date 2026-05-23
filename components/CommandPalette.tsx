"use client";

import { useEffect, useRef, useState } from "react";
import { EXAMPLE_QUERIES } from "@/lib/examples";
import { isSTTSupported, startDictation, type STTHandle } from "@/lib/voice/stt";
import {
  IconMic,
  IconArrowReturn,
  IconSparkle,
  IconClose,
} from "./icons";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (query: string) => void;
  /** True once a scene exists — switches placeholder to follow-up framing. */
  hasScene: boolean;
}

const accentMap = {
  yellow: "var(--c-yellow)",
  green: "var(--c-green)",
  blue: "var(--c-blue)",
  terra: "var(--c-terra)",
} as const;

/** Thin gate: only mount the panel while open so its state starts fresh. */
export default function CommandPalette(props: CommandPaletteProps) {
  if (!props.open) return null;
  return <PalettePanel {...props} />;
}

function PalettePanel({ onClose, onSubmit, hasScene }: CommandPaletteProps) {
  const [value, setValue] = useState("");
  const [listening, setListening] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const sttRef = useRef<STTHandle | null>(null);
  const sttOk = isSTTSupported();

  // Filter examples by the current text (so it doubles as a search).
  const matches = EXAMPLE_QUERIES.filter((e) =>
    `${e.domain} ${e.query}`.toLowerCase().includes(value.toLowerCase()),
  );

  // focus on mount; stop any dictation when the panel unmounts (close)
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => sttRef.current?.stop();
  }, []);

  const fire = (q: string) => {
    const query = q.trim();
    if (!query) return;
    sttRef.current?.stop();
    setListening(false);
    setValue("");
    onSubmit(query);
  };

  const toggleMic = () => {
    if (!sttOk) return;
    if (listening) {
      sttRef.current?.stop();
      setListening(false);
      return;
    }
    setListening(true);
    sttRef.current = startDictation({
      onTranscript: (text, isFinal) => {
        setValue(text);
        if (isFinal) {
          setListening(false);
          // small beat so the user sees the transcript land, then fire
          setTimeout(() => fire(text), 350);
        }
      },
      onError: () => setListening(false),
      onEnd: () => setListening(false),
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (value.trim()) fire(value);
      else if (matches[active]) fire(matches[active].query);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center sm:px-4 sm:pt-[16vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* scrim */}
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px] anim-fade-up" />

      {/* mobile: full-bleed top sheet. desktop: centered floating card. */}
      <div
        className="glass-raised anim-fade-up relative z-10 flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-none shadow-[0_40px_120px_-20px_rgba(0,0,0,0.8)] sm:h-auto sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Ask Mira"
      >
        {/* input row */}
        <div className="flex items-center gap-3 px-5 py-4">
          <IconSparkle className="shrink-0 text-coral" />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={
              listening
                ? "Listening…"
                : hasScene
                  ? "Ask a follow-up to morph the scene…"
                  : "Describe an idea to visualize…"
            }
            className="min-w-0 flex-1 bg-transparent font-serif text-lg text-ink placeholder:text-ink-faint focus:outline-none sm:text-xl"
            aria-label="Query"
          />

          <button
            onClick={toggleMic}
            disabled={!sttOk}
            title={sttOk ? "Speak your idea" : "Voice input not supported here"}
            className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-colors ${
              listening
                ? "anim-mic border-coral/60 bg-coral text-paper"
                : "border-hairline-strong text-ink-dim hover:border-coral/40 hover:text-coral disabled:opacity-30 disabled:hover:border-hairline-strong disabled:hover:text-ink-dim"
            }`}
            aria-pressed={listening}
            aria-label="Toggle voice input"
          >
            <IconMic />
          </button>

          <button
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-white/5 hover:text-ink sm:hidden"
            aria-label="Close"
          >
            <IconClose />
          </button>
        </div>

        <div className="h-px w-full bg-[var(--hairline)]" />

        {/* examples / matches */}
        <div className="scroll-thin flex-1 overflow-y-auto p-2 sm:max-h-[46vh] sm:flex-none">
          <div className="px-3 pb-1 pt-2">
            <span className="label">
              {value ? "Matches" : hasScene ? "Or start fresh" : "Try one of these"}
            </span>
          </div>
          {matches.length === 0 ? (
            <div className="px-3 py-6 text-sm text-ink-faint">
              Press <Kbd>↵</Kbd> to visualize{" "}
              <span className="text-ink-dim">“{value}”</span>
            </div>
          ) : (
            matches.map((ex, i) => (
              <button
                key={ex.query}
                onMouseEnter={() => setActive(i)}
                onClick={() => fire(ex.query)}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                  i === active ? "bg-white/[0.055]" : "hover:bg-white/[0.03]"
                }`}
              >
                <span
                  className="mt-0.5 h-8 w-[3px] shrink-0 rounded-full"
                  style={{ background: accentMap[ex.accent] }}
                />
                <span className="min-w-0 flex-1">
                  <span className="label block">{ex.domain}</span>
                  <span className="mt-0.5 block truncate font-serif text-[15px] text-ink">
                    {ex.query}
                  </span>
                </span>
                <IconArrowReturn
                  className={`shrink-0 text-ink-faint transition-opacity ${
                    i === active ? "opacity-100" : "opacity-0"
                  }`}
                />
              </button>
            ))
          )}
        </div>

        {/* footer hint */}
        <div className="flex items-center justify-between border-t border-[var(--hairline)] px-5 py-2.5">
          <div className="flex items-center gap-3 text-[11px] text-ink-faint">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd> visualize
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>esc</Kbd> close
            </span>
          </div>
          <span className="label hidden sm:inline">Mira</span>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded border border-[var(--hairline-strong)] bg-white/[0.03] px-1.5 font-mono text-[10px] text-ink-dim">
      {children}
    </kbd>
  );
}
