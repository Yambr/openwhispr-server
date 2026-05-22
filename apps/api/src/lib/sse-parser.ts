// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 04 / Plan 02 / Task 2 — Pure SSE → BACKEND_SPEC NDJSON translator.
//
// Consumes a `ReadableStream<Uint8Array>` of OpenAI Chat Completions SSE
// frames and yields NDJSON stream chunks in the vocabulary the immutable
// desktop client consumes (R32: `content` / `tool_call` / `done`).
// Framework-free; the only boundaries crossed are TextDecoder + JSON.parse
// (both Node built-ins), so coverage is achievable from a fixture corpus
// alone (no live LiteLLM).
//
// Safety (T-04-03 mitigation): every `data:` payload is JSON.parse-validated
// before forwarding; malformed frames are silently dropped so untrusted
// upstream cannot poison downstream NDJSON. On finish_reason="stop" with
// pending tool-call accumulator state (LiteLLM#17246), the caller MUST
// inspect `acc.hasPending()` and decline to flush — we do not flush
// implicitly here, only on finish_reason="tool_calls".

import type { ToolCallAccumulator, ToolCallChunk } from "./tool-call-accumulator.js";

// R32 — wire vocabulary. The immutable desktop client's cloud stream
// consumer (ReasoningService.processTextStreamingCloud) strictly filters
// NDJSON chunks on `type === "content"` / `"tool_call"` and treats
// `type === "done"` as the terminal marker. The previous v3-era vocab
// (`text-delta` / `tool-call` / `finish`) matched none of those filters,
// so every chunk was silently dropped and the chat window stayed empty.
// `tool-result` is intentionally absent: tools execute on the CLIENT, so
// the server never emits a tool-result chunk on the wire.
export type StreamChunk =
  | { type: "content"; text: string }
  | ToolCallChunk
  | {
      type: "done";
      finishReason: string;
      usage: { promptTokens: number; completionTokens: number };
    };

export interface SseToNdjsonInput {
  body: ReadableStream<Uint8Array>;
  acc: ToolCallAccumulator;
}

interface OpenAiStreamingChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function* translateChunk(
  json: OpenAiStreamingChunk,
  acc: ToolCallAccumulator,
): Generator<StreamChunk> {
  const choice = json.choices?.[0];
  if (!choice) return;
  const delta = choice.delta;
  if (delta) {
    if (typeof delta.content === "string" && delta.content.length > 0) {
      yield { type: "content", text: delta.content };
    }
    if (delta.tool_calls) {
      acc.absorb({ tool_calls: delta.tool_calls });
    }
  }
  const fr = choice.finish_reason;
  if (fr === "tool_calls") {
    for (const tc of acc.flush()) yield tc;
    yield {
      type: "done",
      finishReason: "tool_calls",
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
      },
    };
  } else if (fr) {
    // Any non-null finish_reason that is not "tool_calls" (typically "stop",
    // "length", "content_filter"). Pending accumulator state — if any —
    // is intentionally NOT flushed (T-04-03 / LiteLLM#17246 mitigation);
    // the caller can inspect acc.hasPending() to log a warning.
    yield {
      type: "done",
      finishReason: fr,
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
      },
    };
  }
}

export async function* sseToNdjson(input: SseToNdjsonInput): AsyncGenerator<StreamChunk> {
  const reader = input.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  let sawFinish = false;

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
          // End-of-stream sentinel — caller already received its finish chunk.
          return;
        }
        let json: OpenAiStreamingChunk;
        try {
          json = JSON.parse(payload) as OpenAiStreamingChunk;
        } catch {
          // T-04-03 mitigation: malformed upstream frame — drop and continue.
          continue;
        }
        for (const out of translateChunk(json, input.acc)) {
          if (out.type === "done") sawFinish = true;
          yield out;
        }
      }
    }
    // Stream closed without [DONE] sentinel. If we never emitted a finish
    // chunk, synthesize one so the desktop client never hangs on a half-open
    // NDJSON stream (premature-close.sse fixture).
    if (!sawFinish) {
      yield {
        type: "done",
        finishReason: "incomplete",
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    }
  } finally {
    reader.releaseLock();
  }
}
