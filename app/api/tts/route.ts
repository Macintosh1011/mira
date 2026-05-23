/**
 * POST /api/tts — ElevenLabs streaming TTS proxy.
 *
 * Input: { text: string }. Output: streamed audio/mpeg piped straight from
 * ElevenLabs. The API key lives server-side only and never reaches the client.
 * On a missing key or an upstream non-2xx, returns a non-2xx JSON { error } so
 * the Narrator can fall back to the browser's SpeechSynthesis.
 */

// Node runtime: real fetch streaming, and process.env access for the key.
export const runtime = "nodejs";
export const maxDuration = 30;

const ELEVENLABS_MODEL_ID = "eleven_turbo_v2_5";

export async function POST(request: Request): Promise<Response> {
  let body: { text?: unknown };
  try {
    body = (await request.json()) as { text?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return Response.json({ error: "Missing 'text'" }, { status: 400 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    return Response.json(
      { error: "ElevenLabs not configured" },
      { status: 503 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_MODEL_ID,
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS request failed";
    return Response.json({ error: message }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return Response.json(
      { error: detail || `ElevenLabs error ${upstream.status}` },
      { status: 502 },
    );
  }

  // Pipe the upstream audio stream straight through — no full buffering.
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
