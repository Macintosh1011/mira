/**
 * Demo-insurance cache.
 *
 * Hand-authored, known-good SceneBundles for the hero queries. Two jobs:
 *  1. Fallback: if a live Gemini call errors or blows the latency budget, the
 *     /api/generate route streams the closest cached bundle so the stage never
 *     goes blank in front of judges.
 *  2. Instant resolve: the frontend's example-query buttons map straight to a
 *     bundle by id, no model round-trip.
 *
 * Matching is a tiny keyword scorer (no model, no deps). `matchBundle` only
 * returns a hand-authored bundle when the query GENUINELY matches one (score at
 * or above MATCH_THRESHOLD); off-topic queries get no bundle so the route can
 * fall back to an on-topic generic scene instead of an unrelated cached topic.
 */
import type { SceneBundle, ScenePlan, NarrationCue } from "@/lib/types";
import { fedRateCut } from "./fed-rate-cut";
import { dijkstra } from "./dijkstra";
import { sineWave } from "./sine-wave";

interface CacheEntry {
  bundle: SceneBundle;
  /** Human-facing example query, shown on the frontend buttons. */
  exampleQuery: string;
  /** Keywords that route a free-text query to this bundle. */
  keywords: string[];
}

const ENTRIES: CacheEntry[] = [
  {
    bundle: fedRateCut,
    exampleQuery: "Animate how a Fed rate cut ripples through the mortgage market.",
    keywords: [
      "fed",
      "rate",
      "cut",
      "mortgage",
      "interest",
      "reserve",
      "bank",
      "housing",
      "monetary",
    ],
  },
  {
    bundle: dijkstra,
    exampleQuery: "Show me how Dijkstra's algorithm finds the shortest path.",
    keywords: [
      "dijkstra",
      "shortest",
      "path",
      "graph",
      "algorithm",
      "route",
      "node",
      "weighted",
    ],
  },
  {
    bundle: sineWave,
    exampleQuery: "Show me how a sine wave comes from circular motion.",
    keywords: [
      "sine",
      "wave",
      "cosine",
      "circle",
      "circular",
      "oscillation",
      "phasor",
      "trig",
      "frequency",
    ],
  },
];

const BY_ID = new Map<string, CacheEntry>(
  ENTRIES.map((e) => [e.bundle.sceneId, e]),
);

/** Lightweight bundle metadata for the frontend's example buttons. */
export interface CachedExample {
  sceneId: string;
  query: string;
  renderer: SceneBundle["renderer"];
  title: string;
}

export function listExamples(): CachedExample[] {
  return ENTRIES.map((e) => ({
    sceneId: e.bundle.sceneId,
    query: e.exampleQuery,
    renderer: e.bundle.renderer,
    title: e.bundle.narration[0]?.text.slice(0, 40) ?? e.exampleQuery,
  }));
}

export function getCachedBundle(sceneId: string): SceneBundle | undefined {
  return BY_ID.get(sceneId)?.bundle;
}

/**
 * Score a query against an entry's keywords. Whole-word matching so a substring
 * like "rate" inside "accelerate" can't sneak a topic in; each whole-word hit
 * scores 2 for a long keyword (>=5 chars) and 1 otherwise.
 */
function score(query: string, entry: CacheEntry): number {
  const words = new Set(query.toLowerCase().match(/[a-z]+/g) ?? []);
  let s = 0;
  for (const kw of entry.keywords) {
    if (words.has(kw)) s += kw.length >= 5 ? 2 : 1;
  }
  return s;
}

/**
 * Minimum score for a query to count as a GENUINE match for a hand-authored
 * bundle. A hero query ("Animate how a Fed rate cut ripples through the mortgage
 * market") clears this easily (fed+rate+cut+mortgage+market...); an off-topic
 * one ("the human heart's electrical signal") scores 0 and gets no bundle, so
 * the route falls back to an on-topic generic scene instead of a wrong cache.
 */
const MATCH_THRESHOLD = 4;

/**
 * Returns a hand-authored bundle ONLY when the query genuinely matches one
 * (best score >= MATCH_THRESHOLD). Returns undefined for off-topic queries so
 * the caller can serve an on-topic fallback instead of an unrelated cache.
 */
export function matchBundle(query: string): SceneBundle | undefined {
  let best: CacheEntry | undefined;
  let bestScore = 0;
  for (const entry of ENTRIES) {
    const s = score(query, entry);
    if (s > bestScore) {
      bestScore = s;
      best = entry;
    }
  }
  return bestScore >= MATCH_THRESHOLD ? best?.bundle : undefined;
}

/** Derive a minimal ScenePlan from a cached bundle (for the plan SSE event). */
export function planFromBundle(bundle: SceneBundle, query: string): ScenePlan {
  const phases = bundle.narration.map((cue: NarrationCue, i) => {
    const nextStart = bundle.narration[i + 1]?.startMs;
    const approxDurationMs =
      nextStart !== undefined ? nextStart - cue.startMs : 3000;
    return {
      id: cue.phaseId,
      intent: cue.text,
      renderer: bundle.renderer,
      approxDurationMs,
    };
  });
  return {
    id: bundle.sceneId,
    title: query.slice(0, 48) || bundle.sceneId,
    // Hand-authored bundles carry their own self-contained scene code (not an
    // archetype), so sceneType is only nominal here; "flow" is the safe default.
    sceneType: "flow",
    content: bundle.narration.map((cue) => ({ label: cue.text })),
    phases,
  };
}
