/**
 * Interactive-simulation registry.
 *
 * Each entry maps a stable `simId` (the value the orchestrator emits on a
 * SceneBundle) to a real, hand-built `Sim` module living in lib/sims/<id>.ts.
 * The SimHost resolves a sim by id, calls `sim.create(container, libs, content)`,
 * and drives the returned controller.
 *
 * ── Why dynamic, not static ──────────────────────────────────────────────
 * ~14 agents build these sim files in parallel; at any given moment some of the
 * 10 ids may not yet have a file on disk. A static `import` of a missing module
 * is a hard build error, so we lazily dynamic-import each id and SKIP any that
 * fail to resolve (missing file, or a module that doesn't export a valid Sim).
 * The build stays green no matter which sims have landed. Resolved sims are
 * cached, so the registry loads once per session.
 *
 * Each sim file MUST `export default` a `Sim` whose `id` equals its filename
 * (without extension) — the id below. The list is the source of truth for which
 * sims the framework knows about.
 */
import type { Sim } from "@/lib/types";

/** The 10 known sim ids. A sim file lib/sims/<id>.ts must default-export a Sim. */
export const SIM_IDS = [
  "traffic-jam",
  "waves",
  "particles",
  "orbital",
  "neural-net",
  "epidemic",
  "flow-field",
  "signal",
  "algorithm",
  "molecules",
] as const;

export type SimId = (typeof SIM_IDS)[number];

// Static map of id -> dynamic importer. Webpack/Turbopack need a literal import
// specifier per entry (no fully-dynamic `import(`@/lib/sims/${id}`)`), so each
// id is spelled out. A missing file makes the importer reject; we catch it.
const IMPORTERS: Record<SimId, () => Promise<unknown>> = {
  "traffic-jam": () => import("@/lib/sims/traffic-jam"),
  waves: () => import("@/lib/sims/waves"),
  particles: () => import("@/lib/sims/particles"),
  orbital: () => import("@/lib/sims/orbital"),
  "neural-net": () => import("@/lib/sims/neural-net"),
  epidemic: () => import("@/lib/sims/epidemic"),
  "flow-field": () => import("@/lib/sims/flow-field"),
  signal: () => import("@/lib/sims/signal"),
  algorithm: () => import("@/lib/sims/algorithm"),
  molecules: () => import("@/lib/sims/molecules"),
};

/** Resolved registry, populated by loadSims(). Empty until the first load. */
export const SIMS: Partial<Record<SimId, Sim>> = {};

function isSim(value: unknown): value is Sim {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.title === "string" &&
    Array.isArray(s.controls) &&
    typeof s.create === "function"
  );
}

let pending: Promise<typeof SIMS> | null = null;

/**
 * Resolve every available sim module once and populate SIMS. Missing files and
 * malformed modules are skipped silently (the framework still renders, the
 * SimHost falls back). Idempotent and cached.
 */
export function loadSims(): Promise<typeof SIMS> {
  if (pending) return pending;
  pending = (async () => {
    await Promise.all(
      SIM_IDS.map(async (id) => {
        try {
          const mod = (await IMPORTERS[id]()) as { default?: unknown };
          const sim = mod?.default;
          if (isSim(sim)) SIMS[id] = sim;
        } catch {
          // Sim file not present yet (in-flight agent) or import threw — skip.
        }
      }),
    );
    return SIMS;
  })();
  return pending;
}

/** Resolve a single sim by id, loading the registry on first call. */
export async function getSim(id: string): Promise<Sim | null> {
  if (!(SIM_IDS as readonly string[]).includes(id)) return null;
  await loadSims();
  return SIMS[id as SimId] ?? null;
}
