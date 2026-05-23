/**
 * GET /api/examples — the hand-authored example queries for the frontend's
 * one-click buttons. Each maps to a cached SceneBundle that resolves instantly
 * (no model round-trip): the frontend can POST the query to /api/generate as
 * "new", which the cache short-circuits, or render the bundle directly.
 */
import { listExamples } from "@/lib/cache";

export const runtime = "nodejs";

export function GET(): Response {
  return new Response(JSON.stringify({ examples: listExamples() }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
