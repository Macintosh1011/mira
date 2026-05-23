/**
 * Verifier agent: checks that the generated scene matches the narration.
 *
 * Implemented on the Gemini Managed Agents API (Antigravity harness) for the
 * hackathon's "best use of managed agents" prize. See lib/managed-agents.ts.
 *
 * CRITICAL: this is best-effort and NON-BLOCKING. The live demo's `done` event
 * must never wait on it. The route races this against a short deadline; if the
 * managed agent is slow, errors, or no key is present, we degrade to a
 * status:"ok" verdict (or the caller simply drops the verify event). The stage
 * speed cannot depend on this returning.
 */
import {
  verifyWithManagedAgent,
  hasManagedAgents,
  type VerifyResult,
} from "@/lib/managed-agents";
import type { NarrationCue } from "@/lib/types";

/** Hard ceiling on how long we ever wait for the managed agent. */
export const VERIFY_BUDGET_MS = 4000;

export interface VerifyInput {
  code: string;
  narration: NarrationCue[];
  renderer: string;
}

/**
 * Runs the managed-agent verification under its own deadline. Resolves with a
 * verdict or null. Never rejects: any failure path resolves to null so the
 * caller can simply skip the verify event.
 */
export async function verifyScene(
  input: VerifyInput,
): Promise<VerifyResult | null> {
  if (!hasManagedAgents()) return null;

  const narrationText = input.narration.map((c) => c.text).join(" ");
  if (!narrationText.trim() || !input.code.trim()) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_BUDGET_MS);

  try {
    return await verifyWithManagedAgent({
      code: input.code,
      narration: narrationText,
      renderer: input.renderer,
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
