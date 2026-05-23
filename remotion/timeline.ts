/**
 * Master timeline. Narration durations come from narration.json (probed from
 * the real ElevenLabs audio); start times are hand-placed against the script.
 * Acts read their own [start,end] window; the audio layer places each cue.
 */
import { FPS } from "./theme";
import narration from "./narration.json";

export const sec = (s: number) => Math.round(s * FPS);

export const TOTAL_SEC = 61.8;
export const DURATION = sec(TOTAL_SEC);

/** Act windows in seconds. Acts overlap slightly for cross-dissolves. */
export const ACTS = {
  problem: { start: 0.0, end: 7.0 },
  prompt: { start: 6.8, end: 12.7 },
  magic: { start: 12.4, end: 31.4 },
  killer: { start: 31.0, end: 46.4 },
  agents: { start: 45.9, end: 55.0 },
  vision: { start: 54.6, end: TOTAL_SEC },
} as const;

/** Narration cue start times (seconds). Durations are measured, not guessed. */
const CUE_START: Record<string, number> = {
  a1_1: 0.6,
  a1_2: 4.1,
  u2: 7.9,
  a3_1: 14.0,
  a3_2: 16.1,
  a3_3: 17.6,
  a3_4: 22.4,
  a3_5: 26.2,
  u4: 31.2,
  a4_2: 34.6,
  a4_3: 38.4,
  a4_4: 42.2,
  a5_1: 46.3,
  a6_1: 55.0,
  a6_2: 57.0,
  a6_3: 58.6,
};

export interface Cue {
  id: string;
  role: "narrator" | "user";
  text: string;
  file: string;
  startFrame: number;
  durationInFrames: number;
  startSec: number;
  endSec: number;
}

export const CUES: Cue[] = narration.map((n) => {
  const startSec = CUE_START[n.id] ?? 0;
  return {
    id: n.id,
    role: n.role as "narrator" | "user",
    text: n.text,
    file: n.file,
    startSec,
    endSec: startSec + n.duration,
    startFrame: sec(startSec),
    durationInFrames: sec(n.duration),
  };
});

export const cue = (id: string): Cue => {
  const c = CUES.find((x) => x.id === id);
  if (!c) throw new Error(`unknown cue ${id}`);
  return c;
};

export const actFrames = (a: { start: number; end: number }) => ({
  from: sec(a.start),
  durationInFrames: sec(a.end - a.start),
});
