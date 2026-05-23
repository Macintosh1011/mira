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

// A minimal valid silent WAV (44-byte header + a few empty samples). Played on
// the reusable element inside the user gesture so play() actually resolves and
// the autoplay grant is captured; a sourceless element's play() would reject.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";

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
  // In-flight (or settled) prefetch promises: resolve to the object URL, or
  // null if /api/tts failed. voiceCue awaits these so it never robot-falls-back
  // on a cue whose real audio is merely still loading.
  private prefetches = new Map<number, Promise<string | null>>();
  private abort: AbortController | null = null; // cancels in-flight prefetches
  private currentAudio: HTMLAudioElement | null = null; // the playing element
  // A single reusable, gesture-unlocked element. Primed by unlock() inside a
  // user gesture so later programmatic play() calls aren't autoplay-blocked.
  private playbackEl: HTMLAudioElement | null = null;
  // Generation token: bumped on setCues/reset so a late prefetch-await from a
  // stale scene can't speak over the current one.
  private generation = 0;

  // How long voiceCue will wait on an in-flight prefetch before falling back.
  private static readonly PREFETCH_WAIT_MS = 4000;

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
    this.generation += 1;
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

  /**
   * Prime audio playback from within a real user gesture (e.g. the submit
   * click/Enter). Browsers grant autoplay to an element that the user "started"
   * during a gesture; by playing a muted element here we carry that grant
   * forward so later programmatic play() of prefetched ElevenLabs clips is
   * allowed. Must be called synchronously inside the gesture handler.
   */
  unlock() {
    if (typeof Audio === "undefined") return;
    const el = this.getPlaybackEl();
    // Play a tiny silent clip inside the gesture to obtain the autoplay grant;
    // a sourceless element's play() would reject. Muted so it's inaudible.
    el.muted = true;
    el.src = SILENT_WAV;
    const p = el.play();
    if (p && typeof p.then === "function") {
      p.then(
        () => {
          el.pause();
          el.muted = false;
        },
        () => {
          // Grant denied (rare from inside a gesture). voiceCue still attempts
          // play() per cue and only robot-falls-back on a real rejection.
        },
      );
    } else {
      el.pause();
      el.muted = false;
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
    this.generation += 1; // invalidate any pending prefetch-awaits
    this.offsetMs = 0;
    this.fired.clear();
    this.onCue?.(-1, null);
  }

  dispose() {
    this.reset();
    this.cancelPrefetch();
    if (this.playbackEl) {
      this.playbackEl.pause();
      this.playbackEl.removeAttribute("src");
      this.playbackEl.load();
      this.playbackEl = null;
    }
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
        void this.voiceCue(i, this.cues[i].text);
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
      this.prefetches.set(i, this.fetchCueAudio(i, cue.text, controller.signal));
    });
  }

  private async fetchCueAudio(
    index: number,
    text: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal,
      });
      if (!res.ok) return null; // -> SpeechSynthesis fallback at cue time
      const blob = await res.blob();
      if (signal.aborted) return null;
      const url = URL.createObjectURL(blob);
      this.audioUrls.set(index, url);
      return url;
    } catch {
      // aborted or network error -> SpeechSynthesis fallback at cue time
      return null;
    }
  }

  private cancelPrefetch() {
    this.abort?.abort();
    this.abort = null;
    this.prefetches.clear();
    for (const url of this.audioUrls.values()) URL.revokeObjectURL(url);
    this.audioUrls.clear();
  }

  private stopAudio() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      // Drop the source but keep the element: it holds the gesture autoplay
      // grant, so reusing it lets the next cue play without another gesture.
      this.currentAudio.removeAttribute("src");
      this.currentAudio.load();
      this.currentAudio = null;
    }
    if (hasSpeechSynthesis()) window.speechSynthesis.cancel();
  }

  /**
   * Voice a cue: ElevenLabs prefetched audio if available, else SpeechSynthesis.
   * If the cue's prefetch is still in flight, wait on it (capped) rather than
   * robot-falling-back on audio that's moments away. Only fall back when the
   * prefetch genuinely failed/errored or playback itself rejects.
   */
  private async voiceCue(index: number, text: string) {
    if (this.muted || !text) return;
    const gen = this.generation;

    let url: string | null = this.audioUrls.get(index) ?? null;
    if (!url) {
      const pending = this.prefetches.get(index);
      if (pending) {
        url = await this.awaitCapped(pending, Narrator.PREFETCH_WAIT_MS);
      }
    }

    // Bail if the scene changed (reset/new cues) while we were awaiting, or if
    // the user muted in the meantime — don't speak over the next scene.
    if (gen !== this.generation || this.muted) return;

    if (url) {
      this.playUrl(url, text);
      return;
    }
    this.speak(text); // prefetch genuinely failed -> real fallback
  }

  /** Resolve `p`, but give up (resolve null) after `ms` so the cue isn't stuck. */
  private awaitCapped(
    p: Promise<string | null>,
    ms: number,
  ): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
  }

  /** Play a prefetched object URL through the gesture-unlocked element. */
  private playUrl(url: string, text: string) {
    const el = this.getPlaybackEl();
    el.muted = false;
    el.playbackRate = Math.max(0.5, Math.min(2, this.rate));
    el.src = url;
    this.currentAudio = el;
    el.play().catch(() => this.speak(text)); // play() still rejected -> fallback
  }

  /** The single reusable element that carries the gesture autoplay grant. */
  private getPlaybackEl(): HTMLAudioElement {
    if (!this.playbackEl) {
      this.playbackEl = new Audio();
      this.playbackEl.preload = "auto";
    }
    return this.playbackEl;
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
