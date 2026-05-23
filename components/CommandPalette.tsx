"use client";

import { useEffect, useRef } from "react";
import { Mic, CornerDownLeft, History } from "lucide-react";

export type AgentState = "idle" | "active" | "done" | "failed";
export type PalettePhase =
  | "active"
  | "listening"
  | "generating"
  | "playing"
  | "paused"
  | "morphing";

const AGENT_LABELS = ["plan", "gen", "voice", "check"] as const;

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
    { keys: ["⌘", "⏎"], label: "submit" },
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
    { keys: ["⌘", "⏎"], label: "submit" },
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
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onMicToggle: () => void;
  onPickRecent: (q: string) => void;
}

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
  onInputChange,
  onSubmit,
  onMicToggle,
  onPickRecent,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) inputRef.current?.focus();
  }, [visible]);

  const armed = inputValue.trim().length > 0;
  const hints = FOOTER_HINTS[phase] ?? FOOTER_HINTS.active;
  const showDivider = showAgents || showRecent;
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
          <input
            ref={inputRef}
            className="palette-input"
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && armed) {
                e.preventDefault();
                onSubmit();
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

        {showAgents && <AgentActivityRow states={agentStates} />}

        {showAgents && showRecent && <div className="palette-divider" />}

        {showRecent && <RecentQueries items={recents} onPick={onPickRecent} />}

        <PaletteFooter hints={hints} />
      </div>
    </div>
  );
}
