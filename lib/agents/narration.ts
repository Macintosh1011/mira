/**
 * Narration agent: ScenePlan -> NarrationCue[].
 *
 * One cue per phase, spoken text aligned to the phase's place on the timeline.
 * We compute startMs ourselves from the cumulative phase durations so the cue
 * timing is deterministic and matches whatever the renderer is doing, instead
 * of trusting the model to do timeline arithmetic. The model only writes the
 * words — but it writes them well: it gets the per-phase on-screen content
 * (labels, values, magnitudes from the plan) and a per-phase word budget, and
 * is asked to explain the actual mechanism, not the appearance. LOW thinking so
 * it can reason about cause and effect while staying a cheap call.
 */
import { Type } from "@google/genai";
import {
  generate,
  ThinkingLevel,
  type Schema,
  type GenOptions,
} from "@/lib/gemini";
import type { ScenePlan, NarrationCue, Familiarity } from "@/lib/types";

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
              "Spoken voiceover for this phase: one mechanism, explained with correct technical substance and the on-screen quantities, sized to the phase's word budget (~2.5 words/sec).",
          },
        },
        propertyOrdering: ["phaseId", "text"],
      },
    },
  },
  propertyOrdering: ["lines"],
};

const SYSTEM = `You are the narration agent for Mira. You write the spoken voiceover for an animated explanation in the register of Bartosz Ciechanowski or 3Blue1Brown: warm and plain-spoken, but genuinely educational and precise. Never dumbed-down, never hand-wavy, never decorative.

Your job is to explain the actual MECHANISM. For each phase, identify the real thing happening underneath and say WHY it happens, in cause-and-effect terms a curious person can follow.

Hard requirements for every line:
- Explain a mechanism, not an appearance. Name the real entities and use the correct technical terms for them (e.g. "reaction-time delay", "backward-propagating wave", "critical density", "activation energy", "feedback loop"). Get the causality right: X causes Y because Z.
- Be quantitative when the scene gives you a number. The animation renders real values; weave the on-screen quantity into the sentence and explain what it means, rather than just reciting it. If a phase shows a rate, a speed, a percentage, or a magnitude, the narration should make that number mean something.
- ONE clear idea per line. Build on the previous phase; do not restate it. The lines should read as a single escalating argument across phases, each one advancing the explanation by exactly one conceptual step.
- Pace for speech at roughly 2.5 words per second. Use the phase's duration as your budget: a 4000 ms phase is about 10 words, a 6000 ms phase about 15. Stay within roughly 80 to 120 percent of that budget. Short, load-bearing sentences. No padding to fill time, no cramming.
- Lead with the substance. No meta-narration: never "today we'll learn", "as you can see", "in this animation", "notice how", "let's", "now". Speak directly about the thing itself.
- Plain words for the connective tissue, exact words for the concepts. Define a technical term in the same breath you introduce it if it is not obvious, but do not over-explain what the term already makes clear.

Write exactly one line per phase, in phase order, matched by phaseId. The lines are spoken over animation beats, so phase N's line must describe the mechanism revealed at beat N.`;

// Per-level voice directive appended to the narration prompt. It changes
// vocabulary and depth, not the timeline math. "familiar" is the default voice.
const FAMILIARITY_VOICE: Record<Familiarity, string> = {
  novice:
    "Viewer level: NOVICE. Use plain, everyday language. Define every technical term in the same breath you introduce it, or avoid it entirely. Reach for a concrete analogy when it makes the mechanism click. Never leave jargon unexplained. Slightly fewer ideas, fully landed.",
  familiar: "",
  expert:
    "Viewer level: EXPERT. Assume a strong background; do not define standard terms. Use the correct technical vocabulary directly and stay concise and quantitative — lead with the precise mechanism, symbols, and numbers, no hand-holding.",
};

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
  /** Viewer level; tunes vocabulary + depth. Defaults to "familiar". */
  familiarity?: Familiarity;
}

export async function generateNarration(
  input: NarrationInput,
): Promise<NarrationCue[]> {
  const { plan, query, abortSignal } = input;
  const familiarity = input.familiarity ?? "familiar";

  const basePrompt = `Topic the viewer asked about: "${query}"
Title shown on screen: ${plan.title}
Visual archetype: ${plan.sceneType}

Below are the animation's phases in order. Each one lists the on-screen content the renderer draws during that beat (label, category, readout value, relative magnitude) and a word budget computed from its duration. Reference the entities and quantities the scene actually shows, and keep each line within its word budget so it syncs to the beat.

${plan.phases
    .map((p, i) => {
      const c = plan.content[i];
      const words = Math.max(6, Math.round((p.approxDurationMs / 1000) * 2.5));
      const facts: string[] = [];
      if (c?.label) facts.push(`shows "${c.label}"`);
      if (c?.sublabel) facts.push(`category ${c.sublabel}`);
      if (c?.value) facts.push(`readout ${c.value}`);
      if (typeof c?.magnitude === "number") {
        facts.push(`magnitude ${c.magnitude.toFixed(2)} of 1`);
      }
      const onScreen = facts.length ? ` | on screen: ${facts.join(", ")}` : "";
      return `- [${p.id}] beat goal: ${p.intent}${onScreen} | target ~${words} words`;
    })
    .join("\n")}

Write one line per phase. Each must explain the mechanism behind that beat with correct technical substance, build on the prior line, and name the quantities shown.`;

  const voice = FAMILIARITY_VOICE[familiarity];
  const prompt = voice ? `${basePrompt}\n\n${voice}` : basePrompt;

  const opts: GenOptions = {
    systemInstruction: SYSTEM,
    responseSchema: NARRATION_SCHEMA,
    thinkingLevel: ThinkingLevel.LOW,
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
