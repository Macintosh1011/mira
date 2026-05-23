/**
 * Narration agent: ScenePlan -> NarrationCue[].
 *
 * One cue per phase, spoken text aligned to the phase's place on the timeline.
 * We compute startMs ourselves from the cumulative phase durations so the cue
 * timing is deterministic and matches whatever the renderer is doing, instead
 * of trusting the model to do timeline arithmetic. The model only writes the
 * words. Small, cheap call: minimal thinking.
 */
import { Type } from "@google/genai";
import {
  generate,
  ThinkingLevel,
  type Schema,
  type GenOptions,
} from "@/lib/gemini";
import type { ScenePlan, NarrationCue } from "@/lib/types";

const NARRATION_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["lines"],
  properties: {
    lines: {
      type: Type.ARRAY,
      description: "Exactly one narration line per phase, in phase order.",
      items: {
        type: Type.OBJECT,
        required: ["phaseId", "text"],
        properties: {
          phaseId: { type: Type.STRING },
          text: {
            type: Type.STRING,
            description:
              "One or two spoken sentences for this phase, conversational and concrete.",
          },
        },
        propertyOrdering: ["phaseId", "text"],
      },
    },
  },
  propertyOrdering: ["lines"],
};

const SYSTEM = `You are the narration agent for Mira. You write the spoken voiceover for an animated explanation, in the calm, precise register of a 3Blue1Brown or Ciechanowski narrator.

Write exactly one line per phase, in order. Each line is one or two short spoken sentences that describe what is happening on screen during that phase and why it matters. Lead with the concrete thing the viewer sees, then the meaning. No filler, no "in this animation", no "as you can see". Speak directly about the idea.`;

interface RawNarration {
  lines?: unknown;
}

/** Maps the model's per-phase text onto deterministic startMs from durations. */
function alignToTimeline(
  plan: ScenePlan,
  textByPhase: Map<string, string>,
): NarrationCue[] {
  const cues: NarrationCue[] = [];
  let cursor = 0;
  for (const phase of plan.phases) {
    const text = textByPhase.get(phase.id)?.trim() || phase.intent;
    cues.push({ phaseId: phase.id, text, startMs: cursor });
    cursor += phase.approxDurationMs;
  }
  return cues;
}

/** Deterministic fallback narration straight from the plan intents. */
export function narrationFromPlan(plan: ScenePlan): NarrationCue[] {
  return alignToTimeline(plan, new Map());
}

export interface NarrationInput {
  plan: ScenePlan;
  query: string;
  abortSignal?: AbortSignal;
}

export async function generateNarration(
  input: NarrationInput,
): Promise<NarrationCue[]> {
  const { plan, query, abortSignal } = input;

  const prompt = `Topic: "${query}"
Title: ${plan.title}

Phases (write one line each, in this order):
${plan.phases.map((p) => `- [${p.id}] ${p.intent}`).join("\n")}`;

  const opts: GenOptions = {
    systemInstruction: SYSTEM,
    responseSchema: NARRATION_SCHEMA,
    thinkingLevel: ThinkingLevel.MINIMAL,
    temperature: 0.6,
    abortSignal,
  };

  const text = await generate(prompt, opts);
  let raw: RawNarration;
  try {
    raw = JSON.parse(text) as RawNarration;
  } catch {
    return narrationFromPlan(plan);
  }

  const byPhase = new Map<string, string>();
  if (Array.isArray(raw.lines)) {
    for (const line of raw.lines) {
      if (line && typeof line === "object") {
        const obj = line as Record<string, unknown>;
        if (typeof obj.phaseId === "string" && typeof obj.text === "string") {
          byPhase.set(obj.phaseId, obj.text);
        }
      }
    }
  }

  return alignToTimeline(plan, byPhase);
}
