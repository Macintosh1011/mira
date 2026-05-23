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
import type {
  ScenePlan,
  ScenePhase,
  Renderer,
  SceneType,
  SceneContentItem,
} from "@/lib/types";
import { isSceneType } from "./archetypes";

const PLAN_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["title", "sceneType", "phases"],
  properties: {
    title: {
      type: Type.STRING,
      description: "Short title for the whole visualization, max 6 words.",
    },
    sceneType: {
      type: Type.STRING,
      enum: ["flow", "cycle", "layered", "timeline", "comparison"],
      description:
        "Which hand-tuned visual archetype best fits the explanation. " +
        "'flow' = a process / pipeline / cause→effect chain of distinct stages connected by arrows. " +
        "'cycle' = a repeating loop of stages (heartbeat, water cycle, request/response). " +
        "'layered' = signals propagating through stacked layers / a hierarchy / a network. " +
        "'timeline' = an ordered sequence of steps, a protocol handshake, or a history along a track. " +
        "'comparison' = comparing quantities or magnitudes (sizes, rates, shares).",
    },
    phases: {
      type: Type.ARRAY,
      description:
        "2 to 5 ordered phases that build the explanation. EXACTLY one per beat the narration will speak.",
      items: {
        type: Type.OBJECT,
        required: ["id", "intent", "label", "renderer", "approxDurationMs"],
        properties: {
          id: {
            type: Type.STRING,
            description: "kebab-case stable id, e.g. 'setup' or 'rate-cut'.",
          },
          intent: {
            type: Type.STRING,
            description: "One line: what this phase shows visually.",
          },
          label: {
            type: Type.STRING,
            description:
              "Short on-screen title for THIS beat's element (the node/stage/layer/bar). 1-4 words, concrete (e.g. 'SA Node', 'Light Reaction', 'SYN packet').",
          },
          sublabel: {
            type: Type.STRING,
            description:
              "Optional uppercase category tag for this element, <=2 words (e.g. 'trigger', 'input', 'step 1').",
          },
          value: {
            type: Type.STRING,
            description:
              "Optional short readout/value shown on the element (e.g. '60 bpm', '4.75%', 'ATP', '12 ms'). Empty if none.",
          },
          magnitude: {
            type: Type.NUMBER,
            description:
              "For sceneType 'comparison' ONLY: this bar's height as 0..1 relative to the others. Ignored otherwise.",
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
        propertyOrdering: [
          "id",
          "intent",
          "label",
          "sublabel",
          "value",
          "magnitude",
          "renderer",
          "approxDurationMs",
        ],
      },
    },
  },
  propertyOrdering: ["title", "sceneType", "phases"],
};

const SYSTEM = `You are the planning agent for Mira, a generative visualization engine in the spirit of Bartosz Ciechanowski and 3Blue1Brown.

Given a user's question, produce a concise scene plan. Mira renders the scene with a small set of beautiful, hand-tuned ARCHETYPES — you do NOT write animation code; you pick the archetype and supply structured per-beat content that fills it.

First pick the ONE archetype that fits the idea:
- flow: a process / pipeline / cause→effect chain of distinct stages (the Fed rate cut rippling outward).
- cycle: a repeating loop of stages (heartbeat, water cycle, the request/response cycle).
- layered: signals propagating through stacked layers, a hierarchy, or a network (a neural net classifying).
- timeline: an ordered sequence, a protocol handshake, or a history along a track (the TCP three-way handshake).
- comparison: comparing quantities or magnitudes (relative sizes, rates, market shares).

Then give 2-5 ordered phases — EXACTLY one per beat the narration will speak (the spoken cue count equals the phase count). Each phase contributes ONE element to the chosen archetype.

Rules:
- Each phase's \`label\` is the concrete on-screen title of its element: 1-4 words ("SA Node", "Light Reaction", "SYN packet", "Cooler air sinks"). Never abstract.
- \`intent\` is one visually concrete line about what that beat shows.
- For 'comparison', set each phase's \`magnitude\` (0..1) to the bar's relative height. For other archetypes omit it.
- Use \`value\` for a crisp readout when it sharpens the idea ("60 bpm", "4.75%", "ATP"); otherwise leave it empty.
- approxDurationMs is the on-screen time for that beat, 3000-9000ms each.
- Phase ids are short, kebab-case, stable.
- Renderer is "2d" for these archetypes (always pick "2d"); "3d" only for a genuinely spatial idea.`;

const VALID_RENDERERS: Renderer[] = ["2d", "3d"];

function coerceRenderer(value: unknown): Renderer {
  return VALID_RENDERERS.includes(value as Renderer)
    ? (value as Renderer)
    : "2d";
}

function coerceSceneType(value: unknown): SceneType {
  return isSceneType(value) ? value : "flow";
}

function clampDuration(ms: unknown): number {
  const n = typeof ms === "number" && Number.isFinite(ms) ? ms : 5000;
  return Math.min(9000, Math.max(2500, Math.round(n)));
}

interface RawPlan {
  title?: unknown;
  sceneType?: unknown;
  phases?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function normalizePlan(raw: RawPlan, query: string): ScenePlan {
  const id = `scene-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? raw.title.trim()
      : query.slice(0, 48);
  const sceneType = coerceSceneType(raw.sceneType);

  const rawPhases = Array.isArray(raw.phases) ? raw.phases : [];
  const phases: ScenePhase[] = [];
  const content: SceneContentItem[] = [];

  for (let i = 0; i < rawPhases.length && phases.length < 5; i++) {
    const p = rawPhases[i];
    if (!p || typeof p !== "object") continue;
    const obj = p as Record<string, unknown>;
    const intent = str(obj.intent) || str(obj.label);
    if (!intent) continue;
    const phaseId = str(obj.id) || `phase-${phases.length + 1}`;
    phases.push({
      id: phaseId,
      intent,
      renderer: coerceRenderer(obj.renderer),
      approxDurationMs: clampDuration(obj.approxDurationMs),
    });
    const magnitude =
      typeof obj.magnitude === "number" && Number.isFinite(obj.magnitude)
        ? obj.magnitude
        : undefined;
    content.push({
      label: str(obj.label) || intent,
      sublabel: str(obj.sublabel) || undefined,
      value: str(obj.value) || undefined,
      magnitude,
    });
  }

  if (phases.length === 0) {
    phases.push({
      id: "main",
      intent: query,
      renderer: "2d",
      approxDurationMs: 6000,
    });
    content.push({ label: title });
  }

  return { id, title, sceneType, content, phases };
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
${JSON.stringify(
        {
          title: previousPlan.title,
          sceneType: previousPlan.sceneType,
          phases: previousPlan.phases.map((p, i) => ({
            ...p,
            label: previousPlan.content[i]?.label,
            sublabel: previousPlan.content[i]?.sublabel,
            value: previousPlan.content[i]?.value,
            magnitude: previousPlan.content[i]?.magnitude,
          })),
        },
        null,
        2,
      )}

Follow-up request: "${query}"

Return an evolved plan. Reuse phase ids where the beat carries over so the renderer can morph in place. Keep the same sceneType unless the follow-up clearly calls for a different archetype. Add, drop, or re-time phases only as the follow-up requires.`
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
