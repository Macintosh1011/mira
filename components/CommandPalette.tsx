"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { Mic, CornerDownLeft, History } from "lucide-react";
import type { Familiarity } from "@/lib/useMiraSession";

export type AgentState = "idle" | "active" | "done" | "failed";
export type PalettePhase =
  | "active"
  | "listening"
  | "generating"
  | "playing"
  | "paused"
  | "morphing";

const AGENT_LABELS = ["plan", "gen", "voice", "check"] as const;

const FAMILIARITY_OPTIONS: { value: Familiarity; label: string }[] = [
  { value: "novice", label: "Beginner" },
  { value: "familiar", label: "Familiar" },
  { value: "expert", label: "Expert" },
];

function AgentActivityRow({ states }: { states: AgentState[] }) {
  return (
    <div className="agents">
      {AGENT_LABELS.map((label, i) => {
        const s = states[i] ?? "idle";
        return (
          <div className={`agent ${s}`} key={label}>
            <span className={`agent-dot ${s}`} />
            <span className="agent-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function FamiliarityToggle({
  value,
  onChange,
}: {
  value: Familiarity;
  onChange: (v: Familiarity) => void;
}) {
  return (
    <div
      className="familiarity"
      role="radiogroup"
      aria-label="Explanation level"
    >
      <span className="fam-label">level</span>
      <div className="fam-seg">
        {FAMILIARITY_OPTIONS.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              className={`fam-opt ${active ? "active" : ""}`}
              tabIndex={-1}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RecentQueries({
  items,
  onPick,
}: {
  items: string[];
  onPick: (q: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="recent">
      <div className="recent-label">
        <History size={12} strokeWidth={1.5} />
        Recent
      </div>
      {items.map((q, i) => (
        <div
          key={i}
          className="recent-item"
          onClick={() => onPick(q)}
          title={q}
        >
          <span className="ri-dot" />
          <span className="ri-text">{q}</span>
        </div>
      ))}
    </div>
  );
}

interface Hint {
  keys: string[];
  label: string;
}

const FOOTER_HINTS: Record<PalettePhase, Hint[]> = {
  active: [
    { keys: ["⏎"], label: "submit" },
    { keys: ["⇧", "⏎"], label: "newline" },
    { keys: ["esc"], label: "close" },
  ],
  listening: [{ keys: ["esc"], label: "cancel" }],
  generating: [{ keys: ["esc"], label: "cancel" }],
  playing: [
    { keys: ["space"], label: "pause" },
    { keys: ["⌘", "K"], label: "follow-up" },
  ],
  paused: [
    { keys: ["space"], label: "play" },
    { keys: ["⌘", "K"], label: "follow-up" },
  ],
  morphing: [
    { keys: ["⏎"], label: "submit" },
    { keys: ["⇧", "⏎"], label: "newline" },
    { keys: ["esc"], label: "cancel" },
  ],
};

function PaletteFooter({ hints }: { hints: Hint[] }) {
  return (
    <div className="footer">
      <div className="footer-group">
        {hints.map((h, i) => (
          <span className="footer-item" key={i}>
            {h.keys.map((k, j) => (
              <span key={j} className="kbd">
                {k}
              </span>
            ))}
            <span style={{ marginLeft: 4 }}>{h.label}</span>
          </span>
        ))}
      </div>
      <div className="footer-group" style={{ color: "var(--fg-subtle)" }}>
        <span className="footer-item" style={{ opacity: 0.7 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              background: "var(--accent)",
              display: "inline-block",
            }}
          />
          mira
        </span>
      </div>
    </div>
  );
}

interface CommandPaletteProps {
  visible: boolean;
  dismissing: boolean;
  phase: PalettePhase;
  inputValue: string;
  micActive: boolean;
  showAgents: boolean;
  agentStates: AgentState[];
  showRecent: boolean;
  recents: string[];
  showFamiliarity: boolean;
  familiarity: Familiarity;
  onFamiliarityChange: (v: Familiarity) => void;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onMicToggle: () => void;
  onPickRecent: (q: string) => void;
}

// Auto-grow ceiling: the textarea climbs to ~5 lines then scrolls.
const TEXTAREA_MAX_PX = 132;

export default function CommandPalette({
  visible,
  dismissing,
  phase,
  inputValue,
  micActive,
  showAgents,
  agentStates,
  showRecent,
  recents,
  showFamiliarity,
  familiarity,
  onFamiliarityChange,
  onInputChange,
  onSubmit,
  onMicToggle,
  onPickRecent,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (visible) inputRef.current?.focus();
  }, [visible]);

  // Auto-grow: reset to content height (capped), so the row grows with the
  // question and scrolls past the ceiling. Layout effect so there's no flash
  // of the wrong height before paint.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_PX)}px`;
  }, [inputValue, visible]);

  const armed = inputValue.trim().length > 0;
  const hints = FOOTER_HINTS[phase] ?? FOOTER_HINTS.active;
  const showDivider = showFamiliarity || showAgents || showRecent;
  const inputDisabled = phase === "generating" || phase === "listening";

  return (
    <div
      className={`palette-wrap ${visible ? "show" : ""} ${
        dismissing ? "dismissing" : ""
      }`}
    >
      <div className="palette">
        <div className="palette-input-row">
          <button
            className={`mic-btn ${micActive ? "active" : ""}`}
            tabIndex={-1}
            onClick={onMicToggle}
            aria-label="Toggle voice input"
          >
            <Mic size={20} strokeWidth={1.5} />
          </button>
          <textarea
            ref={inputRef}
            className="palette-input"
            value={inputValue}
            rows={1}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              // Enter (or ⌘/Ctrl+Enter) submits; Shift+Enter inserts a newline.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (armed) onSubmit();
              }
            }}
            placeholder="Speak or type a question…"
            spellCheck={false}
            readOnly={inputDisabled}
            aria-label="Question"
          />
          <span
            className={`submit-cue ${armed ? "armed" : ""}`}
            title="Submit"
            onClick={() => armed && onSubmit()}
            style={{ cursor: armed ? "pointer" : "default" }}
          >
            <CornerDownLeft size={14} strokeWidth={1.5} />
          </span>
        </div>

        {showDivider && <div className="palette-divider" />}

        {showFamiliarity && (
          <FamiliarityToggle
            value={familiarity}
            onChange={onFamiliarityChange}
          />
        )}

        {showFamiliarity && (showAgents || showRecent) && (
          <div className="palette-divider" />
        )}

        {showAgents && <AgentActivityRow states={agentStates} />}

        {showAgents && showRecent && <div className="palette-divider" />}

        {showRecent && <RecentQueries items={recents} onPick={onPickRecent} />}

        <PaletteFooter hints={hints} />
      </div>
    </div>
  );
}
