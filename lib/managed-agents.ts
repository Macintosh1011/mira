/**
 * Thin client for the Gemini Managed Agents API (the Antigravity-harnessed
 * managed agents). The @google/genai SDK (v2.6.0) does not yet expose
 * agents/interactions, so we call the REST control plane + data plane directly.
 *
 * Two planes (per ai.google.dev/gemini-api/docs/agents):
 *   - Control plane: POST /v1beta/agents  -> create/configure a managed agent.
 *   - Data plane:    POST /v1beta/interactions -> run the agent on an input.
 *
 * Auth: header `x-goog-api-key`. The API is versioned via `Api-Revision`.
 *
 * Everything here is best-effort and time-boxed by the caller's AbortSignal. We
 * never throw past the boundary in a way that can block the live demo; callers
 * treat any failure as "skip the managed verify".
 */
const BASE = "https://generativelanguage.googleapis.com/v1beta";
const API_REVISION = "2026-05-20";
const BASE_AGENT = "antigravity-preview-05-2026";
const VERIFIER_AGENT_ID = "mira-scene-verifier";

const VERIFIER_SYSTEM = `You are Mira's scene verifier. You receive a generated animation's render-module source code (p5.js or three.js) and the narration script that is meant to play alongside it. Judge whether the visuals plausibly match what the narration claims.

Reply with a single line of strict JSON and nothing else:
{"status":"ok"|"warn"|"block","note":"<=12 words"}
- "ok": the code clearly renders what the narration describes.
- "warn": partial mismatch or thin visuals, but watchable.
- "block": the code is broken, empty, or unrelated to the narration.`;

function apiKey(): string | undefined {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
}

function headers(key: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-goog-api-key": key,
    "Api-Revision": API_REVISION,
  };
}

/**
 * Ensure the verifier agent exists on the control plane. Idempotent: a 409/
 * already-exists is treated as success. Cached per process so we only attempt
 * creation once. Returns the agent id to use, or null if creation is impossible.
 */
let ensured: Promise<string | null> | null = null;

export function ensureVerifierAgent(signal?: AbortSignal): Promise<string | null> {
  if (ensured) return ensured;
  const key = apiKey();
  if (!key) {
    ensured = Promise.resolve(null);
    return ensured;
  }
  ensured = (async () => {
    try {
      const res = await fetch(`${BASE}/agents`, {
        method: "POST",
        headers: headers(key),
        signal,
        body: JSON.stringify({
          id: VERIFIER_AGENT_ID,
          base_agent: BASE_AGENT,
          system_instruction: VERIFIER_SYSTEM,
          base_environment: { type: "remote" },
        }),
      });
      // 200/201 created, 409 already exists -> usable either way.
      if (res.ok || res.status === 409) return VERIFIER_AGENT_ID;
      return null;
    } catch {
      return null;
    }
  })();
  return ensured;
}

export interface VerifyResult {
  status: "ok" | "warn" | "block";
  note?: string;
}

interface InteractionStep {
  type?: string;
  content?: { type?: string; text?: string }[];
}

interface InteractionResponse {
  status?: string;
  output_text?: string;
  steps?: InteractionStep[];
}

/**
 * Pull the agent's textual output. The Interactions API returns the final text
 * under steps[].content[].text (type "model_output"); output_text is reserved
 * but often null on the synchronous response. Concatenate model_output text.
 */
function extractOutputText(data: InteractionResponse): string {
  if (typeof data.output_text === "string" && data.output_text) {
    return data.output_text;
  }
  const parts: string[] = [];
  for (const step of data.steps ?? []) {
    if (step.type && step.type !== "model_output") continue;
    for (const c of step.content ?? []) {
      if (c.type === "text" && typeof c.text === "string") parts.push(c.text);
    }
  }
  return parts.join("\n");
}

function parseVerdict(text: string): VerifyResult {
  // The agent is told to return strict JSON; extract the first JSON object.
  const match = text.match(/\{[\s\S]*?\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]) as Record<string, unknown>;
      const status = obj.status;
      if (status === "ok" || status === "warn" || status === "block") {
        const note = typeof obj.note === "string" ? obj.note : undefined;
        return { status, note };
      }
    } catch {
      // fall through
    }
  }
  // Couldn't parse a verdict: degrade to ok so we never block the demo.
  return { status: "ok", note: "verifier returned unstructured output" };
}

/**
 * Run the managed verifier agent over the generated code + narration. Returns a
 * verdict, or null if the managed-agents path is unavailable/failed. Caller must
 * pass an AbortSignal that fires well before the demo's done deadline.
 */
export async function verifyWithManagedAgent(args: {
  code: string;
  narration: string;
  renderer: string;
  signal: AbortSignal;
}): Promise<VerifyResult | null> {
  const key = apiKey();
  if (!key) return null;

  const agentId = await ensureVerifierAgent(args.signal);
  if (!agentId) return null;

  const input = `Renderer: ${args.renderer}

Narration script:
${args.narration}

Render-module source code:
${args.code.slice(0, 6000)}

Return your JSON verdict.`;

  try {
    const res = await fetch(`${BASE}/interactions`, {
      method: "POST",
      headers: headers(key),
      signal: args.signal,
      body: JSON.stringify({
        agent: agentId,
        input: [{ type: "text", text: input }],
        environment: { type: "remote" },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as InteractionResponse;
    const text = extractOutputText(data);
    if (!text) return null;
    return parseVerdict(text);
  } catch {
    return null;
  }
}

export function hasManagedAgents(): boolean {
  return Boolean(apiKey());
}
