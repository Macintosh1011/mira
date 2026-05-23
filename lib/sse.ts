import type { GenerateEvent, GenerateRequest } from "@/lib/types";

/**
 * Typed SSE client for POST /api/generate.
 *
 * The endpoint returns `text/event-stream` with one JSON GenerateEvent per
 * `data:` line. We POST the body and parse the streamed response by hand
 * (EventSource only does GET), dispatching each parsed event to `onEvent`.
 *
 * Returns an abort handle so the caller can cancel an in-flight generation
 * (e.g. when a new query fires before the previous one finishes).
 */
export interface GenerateHandle {
  abort: () => void;
}

export function streamGenerate(
  body: GenerateRequest,
  handlers: {
    onEvent: (event: GenerateEvent) => void;
    onError?: (message: string) => void;
    onClose?: () => void;
  },
): GenerateHandle {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        handlers.onError?.(
          `Generation request failed (${res.status}). The engine may still be warming up.`,
        );
        handlers.onClose?.();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // SSE frames are separated by a blank line. Each frame may carry
      // multiple `data:` lines that concatenate into one JSON payload.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          dispatchFrame(frame, handlers.onEvent, handlers.onError);
        }
      }
      // flush any trailing frame without a terminating blank line
      if (buffer.trim()) {
        dispatchFrame(buffer, handlers.onEvent, handlers.onError);
      }
    } catch (err) {
      if (controller.signal.aborted) return; // caller cancelled, not an error
      handlers.onError?.(
        err instanceof Error ? err.message : "Connection to the engine dropped.",
      );
    } finally {
      handlers.onClose?.();
    }
  })();

  return { abort: () => controller.abort() };
}

function dispatchFrame(
  frame: string,
  onEvent: (e: GenerateEvent) => void,
  onError?: (m: string) => void,
) {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("");

  if (!data || data === "[DONE]") return;

  try {
    onEvent(JSON.parse(data) as GenerateEvent);
  } catch {
    onError?.("Received a malformed event from the engine.");
  }
}
