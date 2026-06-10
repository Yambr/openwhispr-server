// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick 260610-nar / Task 1 — pure SSE accumulator for the BUFFERED reason
// path (POST /api/reason internal-stream-then-buffer).
//
// WHY a separate accumulator (not lib/sse-parser.ts):
//   sse-parser's `sseToNdjson` is the CLIENT-facing SSE→NDJSON translator.
//   Its `usage` carries only promptTokens/completionTokens (no total_tokens),
//   and on premature close it SILENTLY synthesizes a zero-usage "incomplete"
//   done (sse-parser.ts:151) so the desktop client never hangs. That is
//   correct for a STREAMED client but WRONG for the reason path, which buffers
//   the whole stream and then returns a single 200 JSON body: a partial /
//   error stream MUST surface as a 5xx, never a silent partial success, and
//   total_tokens must be reconstructed for the usage_ledger.
//
// This module therefore:
//   (a) concatenates every `choices[0].delta.content` string,
//   (b) captures the terminal `usage` and reconstructs `totalTokens`
//       (= usage.total_tokens ?? prompt_tokens + completion_tokens),
//   (c) REJECTS with `ReasonStreamIncompleteError` (code
//       "REASONING_UPSTREAM_FAILED") when it sees an SSE `error` frame, OR
//       when the stream closes without a finish_reason / without a usage
//       object.
//
// Safety (T-nar-01 mitigation): every `data:` payload is JSON.parse-validated;
// malformed frames are silently dropped (mirrors sse-parser.ts:138) so
// untrusted upstream cannot poison the accumulated text.

/**
 * LOCKER-05 — Error subclasses MUST truncate body/responseBody/
 * upstreamPayload/response/bodyText string fields at construction. This
 * class carries NONE of those fields by design: the upstream error blob is
 * never attached (it could carry master-key-shaped credential fragments —
 * T-nar-03). The message is the class-default generic string; the optional
 * caller-supplied detail is dropped from the wire-bound `.message` entirely.
 */
export class ReasonStreamIncompleteError extends Error {
  override name = "ReasonStreamIncompleteError";
  readonly code = "REASONING_UPSTREAM_FAILED";
  constructor() {
    super("upstream reasoning stream incomplete");
  }
}

interface ReasonUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ReasonAccumulation {
  text: string;
  usage: ReasonUsage;
}

/** Narrow typed view of an OpenAI-compatible streaming SSE frame. */
interface ReasonStreamFrame {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: unknown;
}

export async function accumulateReasonStream(
  body: ReadableStream<Uint8Array>,
): Promise<ReasonAccumulation> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  let text = "";
  let sawFinish = false;
  let usage: ReasonUsage | undefined;
  let sawError = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let sep: number = buf.indexOf("\n\n");
      while (sep !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        sep = buf.indexOf("\n\n");
        const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!dataLine) continue;
        const payload = dataLine.slice(6);
        if (payload === "[DONE]") {
          // End-of-stream sentinel.
          sep = -1;
          break;
        }
        let json: ReasonStreamFrame;
        try {
          json = JSON.parse(payload) as ReasonStreamFrame;
        } catch {
          // T-nar-01 mitigation: malformed upstream frame — drop and continue.
          continue;
        }
        if (json.error !== undefined && json.error !== null) {
          // Upstream emitted an SSE error frame AFTER 200 headers. The raw
          // blob is intentionally NOT carried onto the rejection (T-nar-03).
          sawError = true;
          continue;
        }
        const choice = json.choices?.[0];
        if (choice) {
          const content = choice.delta?.content;
          if (typeof content === "string") text += content;
          if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
            sawFinish = true;
          }
        }
        if (json.usage) {
          const promptTokens = json.usage.prompt_tokens ?? 0;
          const completionTokens = json.usage.completion_tokens ?? 0;
          usage = {
            promptTokens,
            completionTokens,
            totalTokens: json.usage.total_tokens ?? promptTokens + completionTokens,
          };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // T-nar-02 mitigation: a mid-stream error, a premature close (no
  // finish_reason), or a missing terminal usage chunk all REJECT — never a
  // silent partial success.
  if (sawError || !sawFinish || usage === undefined) {
    throw new ReasonStreamIncompleteError();
  }

  return { text, usage };
}
