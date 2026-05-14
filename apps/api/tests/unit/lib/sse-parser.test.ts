// SPDX-License-Identifier: Apache-2.0
// Phase 04 / Plan 02 / Task 2 — TDD GREEN suite for SSE → NDJSON parser.
//
// Fixture corpus under apps/api/src/routes/agent/__fixtures__/ provides
// seven LiteLLM streaming shapes that exercise every branch of the
// translator: text-only, single-tool-call, multi-tool-call, text-then-tool,
// premature-close, malformed-payload, utf8-split. Coverage gate: ≥90/90/90/90.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type StreamChunk, sseToNdjson } from "../../../src/lib/sse-parser.js";
import { createToolCallAccumulator } from "../../../src/lib/tool-call-accumulator.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixturePath = (name: string) =>
  resolve(HERE, "..", "routes", "agent", "__fixtures__", `${name}.sse`);

function streamFromBuffers(bufs: Buffer[]): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from(bufs)) as ReadableStream<Uint8Array>;
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of sseToNdjson({
    body: stream,
    acc: createToolCallAccumulator(),
  })) {
    out.push(chunk);
  }
  return out;
}

describe("sseToNdjson", () => {
  it("text-only.sse — emits one text-delta per non-empty content + a finish chunk with usage; halts at [DONE]", async () => {
    const raw = readFileSync(fixturePath("text-only"));
    const out = await drain(streamFromBuffers([raw]));
    const textDeltas = out.filter((c) => c.type === "text-delta");
    const finishes = out.filter((c) => c.type === "finish");
    // First delta has content:"" (empty string) — filtered. Then 7 non-empty.
    expect(textDeltas).toHaveLength(7);
    expect((textDeltas[0] as { type: "text-delta"; text: string }).text).toBe("Hello");
    expect((textDeltas[6] as { type: "text-delta"; text: string }).text).toBe(" response");
    expect(finishes).toHaveLength(1);
    expect(finishes[0]).toEqual({
      type: "finish",
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 7 },
    });
    // Nothing follows the finish (the [DONE] sentinel triggers an early return).
    expect(out[out.length - 1]).toEqual(finishes[0]);
  });

  it("single-tool-call.sse — emits 0 text-deltas, 1 consolidated tool-call chunk, then 1 finish(tool_calls)", async () => {
    const raw = readFileSync(fixturePath("single-tool-call"));
    const out = await drain(streamFromBuffers([raw]));
    expect(out.filter((c) => c.type === "text-delta")).toHaveLength(0);
    const toolCalls = out.filter((c) => c.type === "tool-call");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toEqual({
      type: "tool-call",
      toolCallId: "call_abc123",
      toolName: "get_weather",
      args: { location: "Paris,FR" },
    });
    const finish = out[out.length - 1];
    expect(finish).toEqual({
      type: "finish",
      finishReason: "tool_calls",
      usage: { promptTokens: 42, completionTokens: 11 },
    });
  });

  it("multi-tool-call.sse — emits 2 tool-call chunks in ascending index order before the finish chunk", async () => {
    const raw = readFileSync(fixturePath("multi-tool-call"));
    const out = await drain(streamFromBuffers([raw]));
    const toolCalls = out.filter((c) => c.type === "tool-call");
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]).toMatchObject({
      toolCallId: "call_aa",
      toolName: "get_weather",
      args: { location: "Paris" },
    });
    expect(toolCalls[1]).toMatchObject({
      toolCallId: "call_bb",
      toolName: "get_time",
      args: { tz: "UTC" },
    });
    expect(out[out.length - 1]).toMatchObject({ type: "finish", finishReason: "tool_calls" });
  });

  it("text-then-tool.sse — emits text-delta chunks BEFORE the tool-call chunk, preserving order", async () => {
    const raw = readFileSync(fixturePath("text-then-tool"));
    const out = await drain(streamFromBuffers([raw]));
    const firstTextIdx = out.findIndex((c) => c.type === "text-delta");
    const firstToolIdx = out.findIndex((c) => c.type === "tool-call");
    expect(firstTextIdx).toBeGreaterThanOrEqual(0);
    expect(firstToolIdx).toBeGreaterThan(firstTextIdx);
    const toolCalls = out.filter((c) => c.type === "tool-call");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      toolCallId: "call_mix1",
      toolName: "get_weather",
      args: { location: "Berlin" },
    });
  });

  it("premature-close.sse — emits valid chunks, then a synthetic finish(incomplete) at end-of-stream; does NOT throw", async () => {
    const raw = readFileSync(fixturePath("premature-close"));
    const out = await drain(streamFromBuffers([raw]));
    // We received at least the leading text-delta from "This is fine".
    expect(out.some((c) => c.type === "text-delta")).toBe(true);
    const last = out[out.length - 1];
    expect(last).toEqual({
      type: "finish",
      finishReason: "incomplete",
      usage: { promptTokens: 0, completionTokens: 0 },
    });
  });

  it("malformed-payload.sse — skips the malformed frame, continues draining surrounding valid frames", async () => {
    const raw = readFileSync(fixturePath("malformed-payload"));
    const out = await drain(streamFromBuffers([raw]));
    // Both surrounding text-deltas are emitted; the {invalid json} frame is dropped.
    const texts = out
      .filter((c): c is { type: "text-delta"; text: string } => c.type === "text-delta")
      .map((c) => c.text);
    expect(texts).toContain("before");
    expect(texts).toContain("after");
    // The valid stop-finish at the tail is preserved.
    expect(out[out.length - 1]).toMatchObject({ type: "finish", finishReason: "stop" });
  });

  // Branch coverage — synthetic in-line streams targeting the few branches
  // the seven fixtures cannot exercise without a second copy of each.
  it("emits zero-usage finish when finish_reason=stop arrives without a usage field", async () => {
    const lines = [
      'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const out = await drain(streamFromBuffers([Buffer.from(lines)]));
    expect(out[out.length - 1]).toEqual({
      type: "finish",
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0 },
    });
  });

  it("ignores frames that contain no `data: ` line (e.g. SSE comment-only frames)", async () => {
    const lines = [
      ": keepalive comment\n\n",
      'data: {"choices":[{"delta":{"content":"x"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const out = await drain(streamFromBuffers([Buffer.from(lines)]));
    expect(out.filter((c) => c.type === "text-delta")).toHaveLength(1);
    expect(out[out.length - 1]).toMatchObject({ type: "finish", finishReason: "stop" });
  });

  it("emits zero-usage finish on finish_reason=tool_calls when usage field is absent", async () => {
    const lines = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"f","arguments":"{}"}}]},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const out = await drain(streamFromBuffers([Buffer.from(lines)]));
    expect(out.filter((c) => c.type === "tool-call")).toHaveLength(1);
    expect(out[out.length - 1]).toEqual({
      type: "finish",
      finishReason: "tool_calls",
      usage: { promptTokens: 0, completionTokens: 0 },
    });
  });

  it("tolerates a streaming chunk whose choice has no delta field", async () => {
    const lines = [
      'data: {"choices":[{"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"content":"x"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const out = await drain(streamFromBuffers([Buffer.from(lines)]));
    expect(out.filter((c) => c.type === "text-delta")).toHaveLength(1);
  });

  it("ignores OpenAI streaming chunks that lack a choices[0] entry (defensive parse)", async () => {
    const lines = [
      'data: {"id":"x","object":"chat.completion.chunk"}\n\n',
      'data: {"choices":[]}\n\n',
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const out = await drain(streamFromBuffers([Buffer.from(lines)]));
    expect(out.filter((c) => c.type === "text-delta")).toHaveLength(1);
  });

  it("utf8-split.sse — text-delta containing 🎉 emerges intact when the buffer is split mid-codepoint", async () => {
    const raw = readFileSync(fixturePath("utf8-split"));
    // Per the `# split-at-byte: 685` header, byte 685 lands between bytes
    // 9F and 8E of the 4-byte 🎉 (F0 9F 8E 89). Split there to force the
    // TextDecoder({stream:true}) recombination path.
    const a = raw.subarray(0, 685);
    const b = raw.subarray(685);
    const out = await drain(streamFromBuffers([a, b]));
    const text = out
      .filter((c): c is { type: "text-delta"; text: string } => c.type === "text-delta")
      .map((c) => c.text)
      .join("");
    expect(text).toContain("🎉");
    // The emoji appears exactly once in the joined output.
    expect(text.match(/🎉/g)?.length).toBe(1);
  });
});
