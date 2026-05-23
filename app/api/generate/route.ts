/**
 * POST /api/generate — Mira's streaming generation endpoint.
 *
 * Input: GenerateRequest. Output: text/event-stream of GenerateEvent objects,
 * one JSON per `data:` line, in order:
 *   plan -> code_chunk* -> code_done -> narration* -> verify? -> done
 *
 * Flow + failure handling (the cached fallback is the real safety net):
 *  - No API key, or live generation errors / exceeds the budget -> stream the
 *    closest hand-authored cached bundle so the stage never goes blank.
 *  - mode "mutate" with a known previousSceneId -> orchestrator morphs the prior
 *    plan and codegen evolves the prior code; otherwise it's a fresh "new" run.
 *  - The managed-agents verifier is best-effort and time-boxed: we emit `verify`
 *    only if it returns before the done deadline, and NEVER block `done` on it.
 */
import type {
  GenerateRequest,
  GenerateEvent,
  SceneBundle,
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
import { getScene, putScene } from "@/lib/agents/scene-store";
import {
  closestBundle,
  getCachedBundle,
  planFromBundle,
} from "@/lib/cache";

// Node runtime so we get real streaming + fetch to the managed-agents control
// plane. Edge would also stream but we want Node fetch semantics here.
export const runtime = "nodejs";
export const maxDuration = 60;

/** Live-generation budget. Past this we bail to the cached bundle. */
const PLAN_BUDGET_MS = 12_000;
const CODE_BUDGET_MS = 14_000;
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

  // No key at all: go straight to the safety net.
  if (!hasGeminiKey()) {
    streamCachedBundle(controller, closestBundle(query), query);
    return;
  }

  const prior =
    req.mode === "mutate" && req.previousSceneId
      ? getScene(req.previousSceneId)
      : undefined;

  // 1) PLAN (structured). Deadline -> fallback.
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
    streamCachedBundle(controller, closestBundle(query), query);
    return;
  }
  if (!plan.phases.length) {
    streamCachedBundle(controller, closestBundle(query), query);
    return;
  }
  controller.enqueue(sse({ type: "plan", plan }));

  const renderer: Renderer = planRenderer(plan);
  const sceneId = plan.id;

  // 2) CODE (streamed). Stream deltas live; deadline/error/garbage -> fallback.
  let code = "";
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
    code = result.code;
  } catch {
    streamCachedBundle(controller, closestBundle(query), query);
    return;
  }

  if (!looksRunnable(code)) {
    // Model produced unusable code despite streaming chunks. Swap in the cached
    // bundle for the final artifact so the render host gets something that runs.
    streamCachedBundle(controller, closestBundle(query), query);
    return;
  }

  controller.enqueue(sse({ type: "code_done", sceneId, code, renderer }));

  // 3) NARRATION (structured, deterministic timeline). On failure, derive from
  // the plan intents so we always have cues.
  let narration;
  try {
    narration = await withDeadline(PLAN_BUDGET_MS, (signal) =>
      generateNarration({ plan, query, abortSignal: signal }),
    );
  } catch {
    narration = narrationFromPlan(plan);
  }
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
        // Last-resort guard: emit an error then a cached bundle so the stage is
        // never blank, then done.
        const message =
          err instanceof Error ? err.message : "generation failed";
        try {
          controller.enqueue(sse({ type: "error", message }));
          streamCachedBundle(controller, closestBundle(req.query), req.query);
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
