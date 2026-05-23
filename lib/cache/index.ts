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
 * Matching is a tiny keyword scorer (no model, no deps). It always returns a
 * bundle, defaulting to the Fed flow which is the most demo-robust visual.
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

/** Score a query against an entry's keywords. Whole-word-ish matching. */
function score(query: string, entry: CacheEntry): number {
  const q = query.toLowerCase();
  let s = 0;
  for (const kw of entry.keywords) {
    if (q.includes(kw)) s += kw.length >= 5 ? 2 : 1;
  }
  return s;
}

/**
 * Always returns a bundle. Picks the best keyword match; falls back to the Fed
 * flow (most robust visual) when nothing matches. This is the safety net.
 */
export function closestBundle(query: string): SceneBundle {
  let best = ENTRIES[0];
  let bestScore = -1;
  for (const entry of ENTRIES) {
    const s = score(query, entry);
    if (s > bestScore) {
      bestScore = s;
      best = entry;
    }
  }
  return best.bundle;
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
    phases,
  };
}
