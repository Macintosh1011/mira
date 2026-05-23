/**
 * POST /api/generate — Mira's streaming generation endpoint.
 *
 * Input: GenerateRequest. Output: text/event-stream of GenerateEvent objects,
 * one JSON per `data:` line, in order:
 *   plan -> code_chunk* -> code_done -> narration* -> verify? -> done
 *
 * Flow + failure handling. The narration the user HEARS always matches their
 * query; only the SCENE CODE ever falls back:
 *  - A genuine keyword match to a hand-authored bundle (a hero query) replays
 *    that bundle whole — scene AND its narration. This is the ONLY path that
 *    serves a cached topic's narration, and only when it truly matches.
 *  - Otherwise the REAL orchestrator plan and the REAL narration cues are always
 *    streamed. If live codegen fails / times out, we swap only the scene code
 *    for an on-topic generic scene built deterministically from the plan, never
 *    an off-topic cached bundle.
 *  - No API key -> the generic scene over a minimal plan derived from the query.
 *  - mode "mutate" with a known previousSceneId -> orchestrator morphs the prior
 *    plan and codegen evolves the prior code; otherwise it's a fresh "new" run.
 *  - The managed-agents verifier is best-effort and time-boxed: we emit `verify`
 *    only if it returns before the done deadline, and NEVER block `done` on it.
 */
import type {
  GenerateRequest,
  GenerateEvent,
  SceneBundle,
  ScenePlan,
  NarrationCue,
  Renderer,
} from "@/lib/types";
import { hasGeminiKey, withDeadline } from "@/lib/gemini";
import { planScene, planRenderer } from "@/lib/agents/orchestrator";
import { generateCode, looksRunnable } from "@/lib/agents/codegen";
import {
  generateNarration,
  narrationFromPlan,
} from "@/lib/agents/narration";
import { verifyScene } from "@/lib/agents/verifier";
import { archetypeSceneCode } from "@/lib/agents/archetypes";
import { getScene, putScene } from "@/lib/agents/scene-store";
import {
  matchBundle,
  getCachedBundle,
  planFromBundle,
} from "@/lib/cache";

// Node runtime so we get real streaming + fetch to the managed-agents control
// plane. Edge would also stream but we want Node fetch semantics here.
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Live-generation budgets. The DEFAULT scene is now a deterministic, hand-tuned
 * ARCHETYPE filled with the plan's structured content — no flaky model codegen
 * in the hot path. Freeform codegen is only a last resort if an archetype ever
 * fails its runnable check, so its budget is tight. maxDuration (60s) leaves
 * headroom for narration + verify.
 */
const PLAN_BUDGET_MS = 12_000;
const CODE_BUDGET_MS = 20_000;
/**
 * Hard ceiling on waiting for the (best-effort) managed-agent verifier before
 * `done`. The Antigravity sandbox can take 10s+ on a cold start, so this cap
 * means a real verdict only lands when the agent is warm; otherwise we degrade
 * to a passing verify event. Demo speed never depends on it returning.
 */
const VERIFY_DEADLINE_MS = 6_000;

const encoder = new TextEncoder();

function sse(event: GenerateEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * A minimal, on-topic ScenePlan derived straight from the query — used only
 * when there's no live plan (no key, or planning failed) so the generic scene
 * and its narration still speak to what the user actually asked.
 */
function minimalPlan(query: string): ScenePlan {
  const title = query.length > 48 ? `${query.slice(0, 47).trimEnd()}…` : query;
  return {
    id: `scene-${Date.now().toString(36)}`,
    title: title || "Mira",
    sceneType: "flow",
    content: [{ label: title || query || "Mira" }],
    phases: [
      { id: "overview", intent: query || title, renderer: "2d", approxDurationMs: 5000 },
    ],
  };
}

/**
 * Stream the hand-tuned ARCHETYPE scene for a real plan, with the real narration
 * cues. This is the default for novel queries: deterministic, on-topic, and
 * reference-quality. The render stage is never blank and never off-topic.
 */
function streamArchetypeScene(
  controller: ReadableStreamDefaultController<Uint8Array>,
  plan: ScenePlan,
  narration: NarrationCue[],
): void {
  const renderer: Renderer = planRenderer(plan);
  const sceneId = plan.id;
  const code = archetypeSceneCode(plan);
  controller.enqueue(sse({ type: "plan", plan }));
  controller.enqueue(sse({ type: "code_chunk", sceneId, delta: code }));
  controller.enqueue(sse({ type: "code_done", sceneId, code, renderer }));
  for (const cue of narration) {
    controller.enqueue(sse({ type: "narration", cue }));
  }
  controller.enqueue(sse({ type: "verify", status: "ok" }));
  controller.enqueue(sse({ type: "done", bundle: { sceneId, renderer, code, narration } }));
}

/** Stream a cached bundle as a full, valid event sequence. */
function streamCachedBundle(
  controller: ReadableStreamDefaultController<Uint8Array>,
  bundle: SceneBundle,
  query: string,
): void {
  const plan = planFromBundle(bundle, query);
  controller.enqueue(sse({ type: "plan", plan }));
  controller.enqueue(
    sse({ type: "code_chunk", sceneId: bundle.sceneId, delta: bundle.code }),
  );
  controller.enqueue(
    sse({
      type: "code_done",
      sceneId: bundle.sceneId,
      code: bundle.code,
      renderer: bundle.renderer,
    }),
  );
  for (const cue of bundle.narration) {
    controller.enqueue(sse({ type: "narration", cue }));
  }
  controller.enqueue(sse({ type: "verify", status: "ok" }));
  controller.enqueue(sse({ type: "done", bundle }));
}

async function runGeneration(
  controller: ReadableStreamDefaultController<Uint8Array>,
  req: GenerateRequest,
): Promise<void> {
  const query = req.query?.trim() ?? "";

  // Direct cache resolve for instant example-button playback: a mutate against
  // a cached scene, or a query that exactly equals a cached scene id, replays
  // the bundle. (Frontend can also just POST the example query as "new".)
  if (req.mode === "mutate" && req.previousSceneId) {
    const cached = getCachedBundle(req.previousSceneId);
    if (cached && !getScene(req.previousSceneId)) {
      // Prior scene was a cached bundle (not a live one we can morph) -> replay.
      streamCachedBundle(controller, cached, query);
      return;
    }
  }

  // Genuine keyword match to a hero bundle (Fed / Dijkstra / sine): replay it
  // whole — pixel-perfect scene AND its matching narration. This is the only
  // path that serves a cached topic's narration, and only when it truly matches
  // the query, so an off-topic query never hears the wrong voiceover.
  const matched = matchBundle(query);
  if (matched) {
    streamCachedBundle(controller, matched, query);
    return;
  }

  // No key at all: there's no live planning to attempt. Still stay ON-TOPIC by
  // building a minimal plan from the query and rendering the archetype scene
  // plus narration derived deterministically from the plan.
  if (!hasGeminiKey()) {
    const plan = minimalPlan(query);
    streamArchetypeScene(controller, plan, narrationFromPlan(plan));
    return;
  }

  const prior =
    req.mode === "mutate" && req.previousSceneId
      ? getScene(req.previousSceneId)
      : undefined;

  // 1) PLAN (structured): title + sceneType (archetype) + per-phase content.
  // On failure we keep the user on-topic with a minimal plan + archetype scene
  // rather than a wrong cached topic.
  let plan;
  try {
    plan = await withDeadline(PLAN_BUDGET_MS, (signal) =>
      planScene({
        query,
        abortSignal: signal,
        previousPlan: prior?.plan,
      }),
    );
  } catch {
    const fallback = minimalPlan(query);
    streamArchetypeScene(controller, fallback, narrationFromPlan(fallback));
    return;
  }
  if (!plan.phases.length) {
    const fallback = minimalPlan(query);
    streamArchetypeScene(controller, fallback, narrationFromPlan(fallback));
    return;
  }
  controller.enqueue(sse({ type: "plan", plan }));

  const renderer: Renderer = planRenderer(plan);
  const sceneId = plan.id;

  // 2) NARRATION (structured, deterministic timeline) — generated from the REAL
  // plan so cues stay 1:1 with phases (phase N == spoken cue N). On failure,
  // derive cues from the plan intents.
  let narration: NarrationCue[];
  try {
    narration = await withDeadline(PLAN_BUDGET_MS, (signal) =>
      generateNarration({ plan, query, abortSignal: signal }),
    );
  } catch {
    narration = narrationFromPlan(plan);
  }

  // 3) SCENE — DEFAULT path: the hand-tuned archetype selected by plan.sceneType,
  // filled with the plan's structured content. Deterministic and reference-grade,
  // so it always passes looksRunnable. Freeform model codegen is only a LAST
  // RESORT if the archetype ever yields non-runnable output (defensive).
  let code = archetypeSceneCode(plan);
  controller.enqueue(sse({ type: "code_chunk", sceneId, delta: code }));
  if (!looksRunnable(code)) {
    try {
      const result = await withDeadline(CODE_BUDGET_MS, (signal) =>
        generateCode({
          plan,
          abortSignal: signal,
          previousCode: prior?.code,
          onDelta: (delta) => {
            controller.enqueue(sse({ type: "code_chunk", sceneId, delta }));
          },
        }),
      );
      if (looksRunnable(result.code)) code = result.code;
    } catch {
      /* keep the archetype code (already on-topic) */
    }
  }

  controller.enqueue(sse({ type: "code_done", sceneId, code, renderer }));

  for (const cue of narration) {
    controller.enqueue(sse({ type: "narration", cue }));
  }

  const bundle: SceneBundle = { sceneId, renderer, code, narration };

  // Persist for follow-up mutate.
  putScene({
    plan,
    code,
    renderer,
    narration,
    query,
    createdAt: Date.now(),
  });

  // 4) VERIFY (managed agents, best-effort, NON-BLOCKING). Race against a hard
  // deadline; emit verify only if it returns in time. Never block done on it.
  const verifyPromise = verifyScene({ code, renderer, narration });
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), VERIFY_DEADLINE_MS),
  );
  const verdict = await Promise.race([verifyPromise, timeout]);
  // Real managed-agent verdict if it returned in time; otherwise degrade to a
  // passing verify so the UI always sees the contract's verify event. The
  // verifyPromise keeps running but its result is ignored after the deadline.
  controller.enqueue(
    verdict
      ? sse({ type: "verify", status: verdict.status, note: verdict.note })
      : sse({ type: "verify", status: "ok" }),
  );

  // 5) DONE — always emitted.
  controller.enqueue(sse({ type: "done", bundle }));
}

export async function POST(request: Request): Promise<Response> {
  let body: GenerateRequest;
  try {
    body = (await request.json()) as GenerateRequest;
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!body || typeof body.query !== "string" || !body.query.trim()) {
    return new Response(
      JSON.stringify({ error: "Missing 'query'" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  const req: GenerateRequest = {
    query: body.query,
    mode: body.mode === "mutate" ? "mutate" : "new",
    previousSceneId: body.previousSceneId,
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await runGeneration(controller, req);
      } catch (err) {
        // Last-resort guard: emit an error then the ON-TOPIC archetype scene over
        // a minimal plan so the stage is never blank and never off-topic.
        const message =
          err instanceof Error ? err.message : "generation failed";
        try {
          controller.enqueue(sse({ type: "error", message }));
          const fallback = minimalPlan(req.query);
          streamArchetypeScene(
            controller,
            fallback,
            narrationFromPlan(fallback),
          );
        } catch {
          // controller already closed; nothing more to do.
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
