"use client";

import type { NarrationCue } from "@/lib/types";

/**
 * Text-to-speech via ElevenLabs streaming, with the browser's SpeechSynthesis
 * as a fallback. The Narrator schedules each NarrationCue against a playback
 * clock: cues fire when elapsed playback time crosses cue.startMs.
 *
 * Voicing: on setCues we prefetch each cue's audio from /api/tts (ElevenLabs
 * proxy) into an object URL so there's no network latency at cue time. At cue
 * time we play the prefetched audio through an HTMLAudioElement. If a cue's
 * prefetch failed or /api/tts errored, that cue is voiced via SpeechSynthesis
 * so narration never goes silent. Pause halts both the clock and the current
 * audio; resume continues from where we stopped.
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

function hasSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function isTTSSupported(): boolean {
  // ElevenLabs (fetch + HTMLAudioElement) is effectively always available in
  // the browser; SpeechSynthesis is the fallback. Either is enough to narrate.
  if (typeof window === "undefined") return false;
  return typeof Audio !== "undefined" || hasSpeechSynthesis();
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

  // ElevenLabs prefetch state, all keyed by cue index.
  private audioUrls = new Map<number, string>(); // object URLs for ready cues
  private abort: AbortController | null = null; // cancels in-flight prefetches
  private currentAudio: HTMLAudioElement | null = null; // the playing element

  constructor() {
    if (hasSpeechSynthesis()) {
      this.voice = pickVoice();
      // voiceschanged fires async on first load in most browsers
      window.speechSynthesis.onvoiceschanged = () => {
        if (!this.voice) this.voice = pickVoice();
      };
    }
  }

  setCues(cues: NarrationCue[]) {
    this.cancelPrefetch();
    this.cues = [...cues].sort((a, b) => a.startMs - b.startMs);
    this.prefetch();
  }

  /** Notified when a cue activates (for caption highlighting). */
  setOnCue(cb: (index: number, cue: NarrationCue | null) => void) {
    this.onCue = cb;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.stopAudio();
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
    // tempo also affects the currently-playing ElevenLabs audio
    if (this.currentAudio) {
      this.currentAudio.playbackRate = Math.max(0.5, Math.min(2, rate));
    }
  }

  get elapsedMs(): number {
    if (!this.running) return this.offsetMs;
    return this.offsetMs + (performance.now() - this.startedAt) * this.rate;
  }

  start() {
    if (!isTTSSupported() || this.running) return;
    this.running = true;
    this.startedAt = performance.now();
    if (this.currentAudio && this.currentAudio.paused) {
      void this.currentAudio.play().catch(() => {});
    }
    this.tick();
  }

  pause() {
    if (!this.running) return;
    this.offsetMs += (performance.now() - this.startedAt) * this.rate;
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.currentAudio) this.currentAudio.pause();
    if (hasSpeechSynthesis()) window.speechSynthesis.cancel();
  }

  /** Reset the clock to the beginning (for replay or a new scene). */
  reset() {
    this.pause();
    this.stopAudio();
    this.offsetMs = 0;
    this.fired.clear();
    this.onCue?.(-1, null);
  }

  dispose() {
    this.reset();
    this.cancelPrefetch();
    this.onCue = undefined;
    if (hasSpeechSynthesis()) window.speechSynthesis.onvoiceschanged = null;
  }

  private tick = () => {
    if (!this.running) return;
    const t = this.elapsedMs;

    for (let i = 0; i < this.cues.length; i++) {
      if (this.fired.has(i)) continue;
      if (t >= this.cues[i].startMs) {
        this.fired.add(i);
        this.onCue?.(i, this.cues[i]);
        this.voiceCue(i, this.cues[i].text);
      }
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  /** Prefetch ElevenLabs audio for every cue into object URLs. */
  private prefetch() {
    if (typeof window === "undefined" || typeof fetch === "undefined") return;
    const controller = new AbortController();
    this.abort = controller;
    this.cues.forEach((cue, i) => {
      if (!cue.text) return;
      void this.fetchCueAudio(i, cue.text, controller.signal);
    });
  }

  private async fetchCueAudio(
    index: number,
    text: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal,
      });
      if (!res.ok) return; // leaves cue unprefetched -> SpeechSynthesis fallback
      const blob = await res.blob();
      if (signal.aborted) return;
      this.audioUrls.set(index, URL.createObjectURL(blob));
    } catch {
      // aborted or network error -> cue falls back to SpeechSynthesis at fire time
    }
  }

  private cancelPrefetch() {
    this.abort?.abort();
    this.abort = null;
    for (const url of this.audioUrls.values()) URL.revokeObjectURL(url);
    this.audioUrls.clear();
  }

  private stopAudio() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = "";
      this.currentAudio = null;
    }
    if (hasSpeechSynthesis()) window.speechSynthesis.cancel();
  }

  /** Voice a cue: ElevenLabs prefetched audio if ready, else SpeechSynthesis. */
  private voiceCue(index: number, text: string) {
    if (this.muted || !text) return;
    const url = this.audioUrls.get(index);
    if (url) {
      const audio = new Audio(url);
      audio.playbackRate = Math.max(0.5, Math.min(2, this.rate));
      this.currentAudio = audio;
      audio.play().catch(() => this.speak(text)); // autoplay/decode fail -> fallback
      return;
    }
    this.speak(text);
  }

  private speak(text: string) {
    if (this.muted || !hasSpeechSynthesis() || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    // base 0.92 (deliberate), scaled by tempo, clamped to sane TTS range
    u.rate = Math.max(0.5, Math.min(2, 0.92 * this.rate));
    u.pitch = 1;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  }
}
