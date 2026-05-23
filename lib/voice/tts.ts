"use client";

import type { NarrationCue } from "@/lib/types";

/**
 * Text-to-speech via the browser's SpeechSynthesis. No ElevenLabs key.
 * The Narrator schedules each NarrationCue against a playback clock: cues
 * fire when elapsed playback time crosses cue.startMs. Pause halts both the
 * clock and any in-flight utterance; resume continues from where we stopped.
 */

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined") return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  // Prefer a calm, natural en-US voice; fall back to any English voice.
  const preferred = [
    "Samantha",
    "Google US English",
    "Microsoft Aria",
    "Microsoft Jenny",
    "Daniel",
  ];
  for (const name of preferred) {
    const v = voices.find((vo) => vo.name.includes(name));
    if (v) return v;
  }
  return voices.find((v) => v.lang.startsWith("en")) ?? voices[0];
}

export function isTTSSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export class Narrator {
  private cues: NarrationCue[] = [];
  private fired = new Set<number>();
  private rafId: number | null = null;
  private startedAt = 0; // performance.now() when (re)started
  private offsetMs = 0; // accumulated playback time before current run
  private running = false;
  private rate = 1; // tempo multiplier — scales the clock and TTS speed
  private voice: SpeechSynthesisVoice | null = null;
  private muted = false;
  private onCue?: (index: number, cue: NarrationCue | null) => void;

  constructor() {
    if (isTTSSupported()) {
      this.voice = pickVoice();
      // voiceschanged fires async on first load in most browsers
      window.speechSynthesis.onvoiceschanged = () => {
        if (!this.voice) this.voice = pickVoice();
      };
    }
  }

  setCues(cues: NarrationCue[]) {
    this.cues = [...cues].sort((a, b) => a.startMs - b.startMs);
  }

  /** Notified when a cue activates (for caption highlighting). */
  setOnCue(cb: (index: number, cue: NarrationCue | null) => void) {
    this.onCue = cb;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted && isTTSSupported()) window.speechSynthesis.cancel();
  }

  /** Tempo multiplier. >1 plays faster, <1 slower. Re-anchors the clock. */
  setRate(rate: number) {
    if (rate <= 0) return;
    // fold elapsed-at-old-rate into the offset so the change is seamless
    if (this.running) {
      this.offsetMs += (performance.now() - this.startedAt) * this.rate;
      this.startedAt = performance.now();
    }
    this.rate = rate;
  }

  get elapsedMs(): number {
    if (!this.running) return this.offsetMs;
    return this.offsetMs + (performance.now() - this.startedAt) * this.rate;
  }

  start() {
    if (!isTTSSupported() || this.running) return;
    this.running = true;
    this.startedAt = performance.now();
    this.tick();
  }

  pause() {
    if (!this.running) return;
    this.offsetMs += (performance.now() - this.startedAt) * this.rate;
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (isTTSSupported()) window.speechSynthesis.cancel();
  }

  /** Reset the clock to the beginning (for replay or a new scene). */
  reset() {
    this.pause();
    this.offsetMs = 0;
    this.fired.clear();
    this.onCue?.(-1, null);
  }

  dispose() {
    this.reset();
    this.onCue = undefined;
    if (isTTSSupported()) window.speechSynthesis.onvoiceschanged = null;
  }

  private tick = () => {
    if (!this.running) return;
    const t = this.elapsedMs;

    for (let i = 0; i < this.cues.length; i++) {
      if (this.fired.has(i)) continue;
      if (t >= this.cues[i].startMs) {
        this.fired.add(i);
        this.onCue?.(i, this.cues[i]);
        this.speak(this.cues[i].text);
      }
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  private speak(text: string) {
    if (this.muted || !isTTSSupported() || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    // base 0.92 (deliberate), scaled by tempo, clamped to sane TTS range
    u.rate = Math.max(0.5, Math.min(2, 0.92 * this.rate));
    u.pitch = 1;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  }
}
