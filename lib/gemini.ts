/**
 * Server-only Gemini client for Mira's agent fan-out.
 *
 * Wraps @google/genai (v2.x). The model id and thinking levels are tuned for
 * the hackathon latency budget: structured planning is cheap, code-gen streams,
 * narration is small. The key is read from the environment and never leaves the
 * server. Import this only from API routes / server modules.
 */
import {
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type Schema,
} from "@google/genai";

export const MODEL_ID = "gemini-3.5-flash";

/** Re-exported so agents can reference the canonical model + thinking levels. */
export { ThinkingLevel };
export type { Schema };

function readApiKey(): string {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY (or GOOGLE_API_KEY) is not set. Add it to .env.local.",
    );
  }
  return key;
}

let client: GoogleGenAI | null = null;

/** Lazily-constructed singleton. Avoids touching env at module load. */
export function genai(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: readApiKey() });
  }
  return client;
}

/** True when a key is present. Lets the route decide fallback up front. */
export function hasGeminiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY);
}

export interface GenOptions {
  systemInstruction?: string;
  responseSchema?: Schema;
  thinkingLevel?: ThinkingLevel;
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
}

function buildConfig(opts: GenOptions): GenerateContentConfig {
  const config: GenerateContentConfig = {};
  if (opts.systemInstruction) config.systemInstruction = opts.systemInstruction;
  if (opts.responseSchema) {
    config.responseMimeType = "application/json";
    config.responseSchema = opts.responseSchema;
  }
  if (opts.thinkingLevel) {
    config.thinkingConfig = { thinkingLevel: opts.thinkingLevel };
  }
  if (opts.temperature !== undefined) config.temperature = opts.temperature;
  if (opts.maxOutputTokens !== undefined) {
    config.maxOutputTokens = opts.maxOutputTokens;
  }
  if (opts.abortSignal) config.abortSignal = opts.abortSignal;
  return config;
}

/** One-shot generation. Returns the full text (or JSON string). */
export async function generate(
  prompt: string,
  opts: GenOptions = {},
): Promise<string> {
  const res = await genai().models.generateContent({
    model: MODEL_ID,
    contents: prompt,
    config: buildConfig(opts),
  });
  return res.text ?? "";
}

/** Streaming generation. Yields text deltas as they arrive. */
export async function* generateStream(
  prompt: string,
  opts: GenOptions = {},
): AsyncGenerator<string> {
  const stream = await genai().models.generateContentStream({
    model: MODEL_ID,
    contents: prompt,
    config: buildConfig(opts),
  });
  for await (const chunk of stream as AsyncGenerator<GenerateContentResponse>) {
    const delta = chunk.text;
    if (delta) yield delta;
  }
}

/**
 * Runs a promise against a wall-clock deadline. The work is also passed an
 * AbortSignal so the underlying request is actually cancelled, not just ignored.
 * Throws a TimeoutError on expiry so callers can branch to the cached fallback.
 */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Gemini call exceeded ${ms}ms budget`);
    this.name = "TimeoutError";
  }
}

export function withDeadline<T>(
  ms: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return work(controller.signal).finally(() => clearTimeout(timer));
}
