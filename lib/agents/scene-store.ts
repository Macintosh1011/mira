/**
 * In-memory scene store for the mutate path. Hackathon-scale: a single-process
 * Map keyed by sceneId, holding the last plan + runnable code so a follow-up
 * can morph the scene that's on screen instead of regenerating. No DB.
 *
 * Entries are capped and TTL'd so a long-running dev server doesn't leak. On
 * serverless this is best-effort per warm instance; a cold start just means the
 * mutate falls back to a fresh "new" generation, which is acceptable.
 */
import type { ScenePlan, NarrationCue, Renderer } from "@/lib/types";

export interface StoredScene {
  plan: ScenePlan;
  code: string;
  renderer: Renderer;
  narration: NarrationCue[];
  query: string;
  createdAt: number;
}

const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 64;

const store = new Map<string, StoredScene>();

function evictStale() {
  const now = Date.now();
  for (const [id, scene] of store) {
    if (now - scene.createdAt > TTL_MS) store.delete(id);
  }
  // Cap size: drop oldest.
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export function putScene(scene: StoredScene): void {
  store.set(scene.plan.id, scene);
  evictStale();
}

export function getScene(sceneId: string): StoredScene | undefined {
  const scene = store.get(sceneId);
  if (!scene) return undefined;
  if (Date.now() - scene.createdAt > TTL_MS) {
    store.delete(sceneId);
    return undefined;
  }
  return scene;
}
