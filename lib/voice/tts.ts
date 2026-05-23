"use client";

import type { NarrationCue } from "@/lib/types";

/**
 * Sequential text-to-speech via ElevenLabs (with the browser's SpeechSynthesis
 * as a fallback). The Narrator is the single playback clock: cues play one after
 * another, and the ACTUAL audio drives advancement.
 *
 * Sequence: start() plays cue 0; the moment it begins, onCue(0) fires. When that
 * audio's `ended` event fires, the Narrator advances to cue 1 (onCue(1), play
 * cue 1), and so on through the last cue, then calls onComplete(). This keeps the
 * spoken words, the on-screen caption, and the animation phase in lockstep —
 * the consumer maps onCue(i) to both captionIdx and canvasPhase.
 *
 * Voicing: on setCues we prefetch each cue's audio from /api/tts (ElevenLabs
 * proxy) into an object URL so there's no network latency at cue time. If a
 * cue's prefetch failed or /api/tts errored, that cue is voiced via
 * SpeechSynthesis (whose `onend` advances the sequence) so narration never goes
 * silent. When muted, no audio plays but cues still advance on a text-length
 * timer so the visual isn't frozen. Pause halts the current audio and the
 * sequence; resume continues the same cue from where it stopped.
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

// Estimated speaking pace for muted/timer-driven advancement: ~2.5 words/sec.
const WORDS_PER_SEC = 2.5;
const MIN_CUE_MS = 1200; // floor so very short cues still read on screen

function estimateCueMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(MIN_CUE_MS, (words / WORDS_PER_SEC) * 1000);
}

export class Narrator {
  private cues: NarrationCue[] = [];
  private rate = 1; // tempo multiplier — scales audio playbackRate + timer pace
  private voice: SpeechSynthesisVoice | null = null;
  private muted = false;
  private onCue?: (index: number, cue: NarrationCue | null) => void;
  private onComplete?: () => void;

  // Sequencing state.
  private cursor = -1; // index of the cue currently playing (-1 = not started)
  private running = false; // true while the sequence is actively advancing
  private completed = false; // guards a single onComplete per sequence
  // How the current cue is being voiced — picked at play time, used by resume.
  private mode: "audio" | "speech" | "timer" | "idle" = "idle";

  // Progress clock (for elapsedMs only — does NOT drive cues/phases).
  private startedAt = 0; // performance.now() of current run
  private offsetMs = 0; // accumulated elapsed before the current run

  // Muted-timer advancement: a setTimeout that fires the next cue.
  private muteTimer: ReturnType<typeof setTimeout> | null = null;
  private muteTimerStartedAt = 0; // for pause/resume of the muted timer
  private muteTimerRemaining = 0; // ms left on the current cue's timer

  // ElevenLabs prefetch state, all keyed by cue index.
  private audioUrls = new Map<number, string>(); // object URLs for ready cues
  // In-flight (or settled) prefetch promises: resolve to the object URL, or
  // null if /api/tts failed. playCue awaits these so it never robot-falls-back
  // on a cue whose real audio is merely still loading.
  private prefetches = new Map<number, Promise<string | null>>();
  private abort: AbortController | null = null; // cancels in-flight prefetches
  // A single reusable, gesture-unlocked element. Primed by unlock() inside a
  // user gesture so later programmatic play() calls aren't autoplay-blocked.
  private playbackEl: HTMLAudioElement | null = null;
  private endedHandler: (() => void) | null = null; // bound `ended` listener
  // Generation token: bumped on setCues/reset so a late prefetch-await from a
  // stale scene can't speak over (or advance) the current one.
  private generation = 0;

  // How long playCue will wait on an in-flight prefetch before falling back.
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
    this.cursor = -1;
    this.completed = false;
    this.prefetch();
  }

  /** Notified when a cue activates — drives both caption and canvas phase. */
  setOnCue(cb: (index: number, cue: NarrationCue | null) => void) {
    this.onCue = cb;
  }

  /** Notified once after the last cue's audio ends. */
  setOnComplete(cb: () => void) {
    this.onComplete = cb;
  }

  setMuted(muted: boolean) {
    if (muted === this.muted) return;
    this.muted = muted;
    if (!muted) return;
    // Muting mid-cue: silence the audio/utterance but keep the sequence moving
    // by switching the current cue to the length-estimated timer path.
    this.stopAudio();
    if (this.running && this.cursor >= 0 && this.cursor < this.cues.length) {
      this.mode = "timer";
      this.muteTimerRemaining = estimateCueMs(this.cues[this.cursor].text);
      this.armMuteTimer(this.muteTimerRemaining);
    }
  }

  /** Tempo multiplier. >1 plays faster, <1 slower. */
  setRate(rate: number) {
    if (rate <= 0) return;
    // Fold elapsed-at-old-rate into the offset so elapsedMs stays continuous.
    if (this.running) {
      this.offsetMs += (performance.now() - this.startedAt) * this.rate;
      this.startedAt = performance.now();
    }
    this.rate = rate;
    // Tempo affects the currently-playing ElevenLabs audio...
    if (this.playbackEl) {
      this.playbackEl.playbackRate = this.clampRate(rate);
    }
    // ...and rescales a running muted timer to the new pace.
    if (this.muteTimer !== null && this.running) {
      const spent = (performance.now() - this.muteTimerStartedAt) * this.rate;
      const remainingAtBase = Math.max(0, this.muteTimerRemaining - spent);
      this.muteTimerRemaining = remainingAtBase;
      this.armMuteTimer(remainingAtBase);
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
          // Grant denied (rare from inside a gesture). playCue still attempts
          // play() per cue and only robot-falls-back on a real rejection.
        },
      );
    } else {
      el.pause();
      el.muted = false;
    }
  }

  /** Best-effort progress time, ms. Informational only — does not drive cues. */
  get elapsedMs(): number {
    if (!this.running) return this.offsetMs;
    return this.offsetMs + (performance.now() - this.startedAt) * this.rate;
  }

  /** Begin (or resume) the sequence. */
  start() {
    if (!isTTSSupported() || this.running) return;
    if (!this.cues.length) return;
    this.running = true;
    this.startedAt = performance.now();

    if (this.cursor < 0) {
      // Fresh start: kick off cue 0.
      this.playCueAt(0);
      return;
    }
    // Resume the cue we paused on, from where it stopped.
    if (this.muted || this.mode === "timer") {
      this.armMuteTimer(this.muteTimerRemaining);
    } else if (this.mode === "speech") {
      // SpeechSynthesis can't resume after cancel(); re-speak the current cue.
      this.speak(this.cursor, this.cues[this.cursor].text, this.generation);
    } else if (this.mode === "audio" && this.playbackEl && this.playbackEl.src) {
      void this.playbackEl.play().catch(() => {});
    } else {
      // Paused before the cue's voicing settled (e.g. prefetch still in flight);
      // re-drive it so resume continues this cue rather than stalling.
      void this.voiceCue(this.cursor, this.cues[this.cursor].text);
    }
  }

  /** Freeze the sequence and the current cue's audio in place. */
  pause() {
    if (!this.running) return;
    this.offsetMs += (performance.now() - this.startedAt) * this.rate;
    this.running = false;
    if (this.playbackEl) this.playbackEl.pause();
    if (hasSpeechSynthesis()) window.speechSynthesis.cancel();
    // Freeze the muted timer: capture how much of the current cue remains.
    if (this.muteTimer !== null) {
      const spent = (performance.now() - this.muteTimerStartedAt) * this.rate;
      this.muteTimerRemaining = Math.max(0, this.muteTimerRemaining - spent);
      clearTimeout(this.muteTimer);
      this.muteTimer = null;
    }
  }

  /** Reset the sequence to the beginning (for replay or a new scene). */
  reset() {
    this.pause();
    this.stopAudio();
    this.generation += 1; // invalidate any pending prefetch-awaits/advances
    this.offsetMs = 0;
    this.cursor = -1;
    this.completed = false;
    this.mode = "idle";
    this.muteTimerRemaining = 0;
    this.onCue?.(-1, null);
  }

  dispose() {
    this.reset();
    this.cancelPrefetch();
    if (this.playbackEl) {
      this.detachEnded();
      this.playbackEl.pause();
      this.playbackEl.removeAttribute("src");
      this.playbackEl.load();
      this.playbackEl = null;
    }
    this.onCue = undefined;
    this.onComplete = undefined;
    if (hasSpeechSynthesis()) window.speechSynthesis.onvoiceschanged = null;
  }

  // ── Sequencing ───────────────────────────────────────────────────────

  /**
   * Activate cue `i`: fire onCue(i), then voice it. When the audio (or fallback
   * utterance, or muted timer) finishes, advance to i+1. Past the last cue,
   * complete the sequence.
   */
  private playCueAt(i: number) {
    if (!this.running) return;
    if (i >= this.cues.length) {
      this.finish();
      return;
    }
    this.cursor = i;
    const cue = this.cues[i];
    this.onCue?.(i, cue);
    void this.voiceCue(i, cue.text);
  }

  /** Move to the cue after `from`, but only if `from` is still the active cue. */
  private advanceFrom(from: number, gen: number) {
    if (gen !== this.generation || !this.running) return;
    if (from !== this.cursor) return; // stale completion from an old cue
    this.playCueAt(from + 1);
  }

  private finish() {
    if (this.completed) return;
    this.completed = true;
    this.running = false;
    this.offsetMs = this.elapsedMs;
    this.onComplete?.();
  }

  /**
   * Voice cue `index`: muted -> timer; ElevenLabs prefetched audio if available;
   * else SpeechSynthesis. If the cue's prefetch is still in flight, wait on it
   * (capped) rather than robot-falling-back on audio that's moments away. Every
   * path advances the sequence when the cue finishes.
   */
  private async voiceCue(index: number, text: string) {
    const gen = this.generation;

    // Muted (or a textless cue): advance on a length-estimated timer so the
    // captions and canvas phase keep moving even with no audio.
    if (this.muted || !text) {
      this.mode = "timer";
      this.muteTimerRemaining = text ? estimateCueMs(text) : MIN_CUE_MS;
      this.armMuteTimer(this.muteTimerRemaining);
      return;
    }

    let url: string | null = this.audioUrls.get(index) ?? null;
    if (!url) {
      const pending = this.prefetches.get(index);
      if (pending) {
        url = await this.awaitCapped(pending, Narrator.PREFETCH_WAIT_MS);
      }
    }

    // Bail if the scene changed (reset/new cues) or we paused/muted/advanced
    // past this cue while awaiting the prefetch.
    if (gen !== this.generation || !this.running || index !== this.cursor) {
      return;
    }
    if (this.muted) {
      // Muted mid-await: switch this cue to the timer path.
      this.mode = "timer";
      this.muteTimerRemaining = estimateCueMs(text);
      this.armMuteTimer(this.muteTimerRemaining);
      return;
    }

    if (url) {
      this.playUrl(url, index, text, gen);
      return;
    }
    this.speak(index, text, gen); // prefetch genuinely failed -> real fallback
  }

  // ── Muted-timer advancement ──────────────────────────────────────────

  private armMuteTimer(durationMs: number) {
    if (this.muteTimer !== null) clearTimeout(this.muteTimer);
    const gen = this.generation;
    const from = this.cursor;
    this.muteTimerStartedAt = performance.now();
    this.muteTimerRemaining = durationMs;
    // The timer fires in wall-clock time; divide by rate so a faster tempo
    // shortens it. (setRate also rescales an in-flight timer.)
    this.muteTimer = setTimeout(() => {
      this.muteTimer = null;
      this.advanceFrom(from, gen);
    }, durationMs / this.rate);
  }

  // ── ElevenLabs prefetch ──────────────────────────────────────────────

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

  // ── Playback primitives ──────────────────────────────────────────────

  private stopAudio() {
    if (this.playbackEl) {
      this.detachEnded();
      this.playbackEl.pause();
      // Drop the source but keep the element: it holds the gesture autoplay
      // grant, so reusing it lets the next cue play without another gesture.
      this.playbackEl.removeAttribute("src");
      this.playbackEl.load();
    }
    if (hasSpeechSynthesis()) window.speechSynthesis.cancel();
    if (this.muteTimer !== null) {
      clearTimeout(this.muteTimer);
      this.muteTimer = null;
    }
  }

  /** Play a prefetched object URL; advance the sequence on `ended`. */
  private playUrl(url: string, index: number, text: string, gen: number) {
    this.mode = "audio";
    const el = this.getPlaybackEl();
    this.detachEnded();
    const handler = () => {
      this.detachEnded();
      this.advanceFrom(index, gen);
    };
    this.endedHandler = handler;
    el.addEventListener("ended", handler);
    el.muted = false;
    el.playbackRate = this.clampRate(this.rate);
    el.src = url;
    el.play().catch(() => {
      // play() rejected after all -> drop to the spoken fallback for this cue.
      this.detachEnded();
      if (gen === this.generation && this.running && index === this.cursor) {
        this.speak(index, text, gen);
      }
    });
  }

  private detachEnded() {
    if (this.playbackEl && this.endedHandler) {
      this.playbackEl.removeEventListener("ended", this.endedHandler);
    }
    this.endedHandler = null;
  }

  /** The single reusable element that carries the gesture autoplay grant. */
  private getPlaybackEl(): HTMLAudioElement {
    if (!this.playbackEl) {
      this.playbackEl = new Audio();
      this.playbackEl.preload = "auto";
    }
    return this.playbackEl;
  }

  /** SpeechSynthesis fallback; advance the sequence on the utterance's `onend`. */
  private speak(index: number, text: string, gen: number) {
    if (!hasSpeechSynthesis() || !text) {
      // No fallback available — keep the sequence moving on a timer.
      this.mode = "timer";
      this.muteTimerRemaining = estimateCueMs(text || "");
      this.armMuteTimer(this.muteTimerRemaining);
      return;
    }
    this.mode = "speech";
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    // base 0.92 (deliberate), scaled by tempo, clamped to sane TTS range
    u.rate = this.clampRate(0.92 * this.rate);
    u.pitch = 1;
    u.volume = 1;
    u.onend = () => this.advanceFrom(index, gen);
    window.speechSynthesis.speak(u);
  }

  private clampRate(rate: number): number {
    return Math.max(0.5, Math.min(2, rate));
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
}
