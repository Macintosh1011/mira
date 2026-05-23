/**
 * Orchestrator agent: query -> ScenePlan.
 *
 * Uses structured output (responseSchema) so the model returns a typed plan we
 * can trust without parsing prose. Planning is the cheapest step in the budget,
 * so we keep thinking LOW for a little structure without burning latency.
 *
 * On mode === "mutate" we feed the prior plan back in and ask the model to
 * evolve it (keep stable phase ids where the intent carries over) rather than
 * invent a fresh scene.
 */
import { Type } from "@google/genai";
import {
  generate,
  ThinkingLevel,
  type Schema,
  type GenOptions,
} from "@/lib/gemini";
import type { ScenePlan, ScenePhase, Renderer } from "@/lib/types";

const PLAN_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["title", "phases"],
  properties: {
    title: {
      type: Type.STRING,
      description: "Short title for the whole visualization, max 6 words.",
    },
    phases: {
      type: Type.ARRAY,
      description: "2 to 4 ordered phases that build the explanation.",
      items: {
        type: Type.OBJECT,
        required: ["id", "intent", "renderer", "approxDurationMs"],
        properties: {
          id: {
            type: Type.STRING,
            description: "kebab-case stable id, e.g. 'setup' or 'rate-cut'.",
          },
          intent: {
            type: Type.STRING,
            description: "One line: what this phase shows visually.",
          },
          renderer: {
            type: Type.STRING,
            enum: ["2d", "3d"],
            description: "'2d' for flows/graphs/charts, '3d' for spatial scenes.",
          },
          approxDurationMs: {
            type: Type.INTEGER,
            description: "How long this phase plays, 3000-9000 ms.",
          },
        },
        propertyOrdering: ["id", "intent", "renderer", "approxDurationMs"],
      },
    },
  },
  propertyOrdering: ["title", "phases"],
};

const SYSTEM = `You are the planning agent for Mira, a generative visualization engine in the spirit of Bartosz Ciechanowski and 3Blue1Brown.

Given a user's question, produce a concise scene plan: an ordered list of 2-4 phases that build a single coherent animated explanation. Each phase is one visual beat.

Rules:
- The whole scene is ONE renderer family. Pick "2d" for flows, arrows, graphs, charts, step-by-step algorithms; "3d" only when the idea is genuinely spatial (a collapsing star, a molecule, a wave surface).
- Keep it to 2-4 phases. Fewer, stronger beats beat many shallow ones.
- Phase intents must be visually concrete ("draw the three banks as nodes and animate the rate-cut pulse along the arrows"), not abstract ("explain monetary policy").
- approxDurationMs is the on-screen time for that beat, 3000-9000ms each.
- Phase ids are short, kebab-case, stable.`;

const VALID_RENDERERS: Renderer[] = ["2d", "3d"];

function coerceRenderer(value: unknown): Renderer {
  return VALID_RENDERERS.includes(value as Renderer)
    ? (value as Renderer)
    : "2d";
}

function clampDuration(ms: unknown): number {
  const n = typeof ms === "number" && Number.isFinite(ms) ? ms : 5000;
  return Math.min(9000, Math.max(2500, Math.round(n)));
}

interface RawPlan {
  title?: unknown;
  phases?: unknown;
}

function normalizePlan(raw: RawPlan, query: string): ScenePlan {
  const id = `scene-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? raw.title.trim()
      : query.slice(0, 48);

  const rawPhases = Array.isArray(raw.phases) ? raw.phases : [];
  const phases: ScenePhase[] = rawPhases
    .slice(0, 4)
    .map((p, i): ScenePhase | null => {
      if (!p || typeof p !== "object") return null;
      const obj = p as Record<string, unknown>;
      const intent = typeof obj.intent === "string" ? obj.intent.trim() : "";
      if (!intent) return null;
      const phaseId =
        typeof obj.id === "string" && obj.id.trim()
          ? obj.id.trim()
          : `phase-${i + 1}`;
      return {
        id: phaseId,
        intent,
        renderer: coerceRenderer(obj.renderer),
        approxDurationMs: clampDuration(obj.approxDurationMs),
      };
    })
    .filter((p): p is ScenePhase => p !== null);

  if (phases.length === 0) {
    phases.push({
      id: "main",
      intent: query,
      renderer: "2d",
      approxDurationMs: 6000,
    });
  }

  return { id, title, phases };
}

/** All phases of a plan share one renderer for the render host. */
export function planRenderer(plan: ScenePlan): Renderer {
  return plan.phases[0]?.renderer ?? "2d";
}

export interface PlanInput {
  query: string;
  abortSignal?: AbortSignal;
  /** Present on mutate: the prior plan being morphed. */
  previousPlan?: ScenePlan;
}

export async function planScene(input: PlanInput): Promise<ScenePlan> {
  const { query, abortSignal, previousPlan } = input;

  const prompt = previousPlan
    ? `The user is iterating on an existing visualization. Morph it; do not start over.

Existing plan (JSON):
${JSON.stringify({ title: previousPlan.title, phases: previousPlan.phases }, null, 2)}

Follow-up request: "${query}"

Return an evolved plan. Reuse phase ids where the beat carries over so the renderer can morph in place. Add, drop, or re-time phases only as the follow-up requires. Keep the same renderer family.`
    : `User question: "${query}"

Produce the scene plan.`;

  const opts: GenOptions = {
    systemInstruction: SYSTEM,
    responseSchema: PLAN_SCHEMA,
    thinkingLevel: ThinkingLevel.LOW,
    temperature: 0.4,
    abortSignal,
  };

  const text = await generate(prompt, opts);
  let raw: RawPlan;
  try {
    raw = JSON.parse(text) as RawPlan;
  } catch {
    raw = {};
  }
  const plan = normalizePlan(raw, query);

  // On mutate, preserve the morph relationship by reusing prior phase ids when
  // the model returned the same count but renamed them.
  if (previousPlan && plan.phases.length === previousPlan.phases.length) {
    plan.phases = plan.phases.map((p, i) => ({
      ...p,
      renderer: previousPlan.phases[i]?.renderer ?? p.renderer,
    }));
  }

  return plan;
}
