// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick 260610-nar / Task 1 — RED→GREEN suite for the pure SSE accumulator
// used by the internal-stream-then-buffer reason path.
//
// Unlike sse-parser.ts (the CLIENT-facing SSE→NDJSON translator), this
// accumulator MUST:
//   (a) reconstruct total_tokens from the terminal usage chunk, and
//   (b) REJECT incomplete/error streams (never silently synthesize a
//       zero-usage "incomplete" done — that is the load-bearing difference
//       from sseToNdjson which is OK for a streamed client but WRONG for
//       the buffered reason path where a partial 200 would be a contract
//       violation).
//
// Input is driven via a fixture-built ReadableStream<Uint8Array> (TextEncoder
// over canned SSE strings) so no live LiteLLM is needed.

import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  accumulateReasonStream,
  ReasonStreamIncompleteError,
} from "../../../src/lib/reason-stream-accumulate.js";

/** Build a Web ReadableStream<Uint8Array> from canned SSE text. */
function streamFrom(sse: string): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from([Buffer.from(sse, "utf-8")])) as ReadableStream<Uint8Array>;
}

/** Build the stream from multiple chunks (exercises cross-chunk framing). */
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  return Readable.toWeb(
    Readable.from(chunks.map((c) => Buffer.from(c, "utf-8"))),
  ) as ReadableStream<Uint8Array>;
}

describe("accumulateReasonStream", () => {
  it("Test 1 (happy path) — concatenates delta.content and captures terminal usage", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      "",
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const acc = await accumulateReasonStream(streamFrom(sse));
    expect(acc.text).toBe("Hello world");
    expect(acc.usage).toEqual({ promptTokens: 10, completionTokens: 2, totalTokens: 12 });
  });

  it("Test 2 (total_tokens reconstruction) — sums prompt+completion when total absent", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"x"}}]}',
      "",
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":5}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const acc = await accumulateReasonStream(streamFrom(sse));
    expect(acc.usage.totalTokens).toBe(12);

    // When total_tokens IS present it is used verbatim (even if it differs
    // from the sum — the upstream is authoritative).
    const sse2 = [
      'data: {"choices":[{"delta":{"content":"y"}}]}',
      "",
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":5,"total_tokens":99}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const acc2 = await accumulateReasonStream(streamFrom(sse2));
    expect(acc2.usage.totalTokens).toBe(99);
  });

  it("Test 3 (mid-stream error event) — REJECTS with ReasonStreamIncompleteError, no partial text on wire-bound message", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"partial secret"}}]}',
      "",
      // The error frame is followed by [DONE] so it is properly framed
      // (terminated by "\n\n") and the error branch is exercised — the
      // upstream may still send a terminal sentinel after an error event.
      'data: {"error":{"message":"upstream exploded with sk-litellm-master-DO-NOT-LEAK"}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    await expect(accumulateReasonStream(streamFrom(sse))).rejects.toBeInstanceOf(
      ReasonStreamIncompleteError,
    );
    // The rejection MUST NOT carry the accumulated partial text nor the raw
    // upstream blob on its wire-bound message (LOCKER-05 truncation +
    // generic message).
    try {
      await accumulateReasonStream(streamFrom(sse));
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(ReasonStreamIncompleteError);
      const e = err as ReasonStreamIncompleteError;
      expect(e.code).toBe("REASONING_UPSTREAM_FAILED");
      expect(e.message).not.toContain("partial secret");
      expect(JSON.stringify({ message: e.message })).not.toMatch(/sk-litellm-master/);
    }
  });

  it("Test 4 (premature close, no finish_reason/no usage) — REJECTS (not a silent zero-usage success)", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"only content"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":" then close"}}]}',
      "",
      // stream ends WITHOUT a finish_reason and WITHOUT a usage chunk.
    ].join("\n");
    await expect(accumulateReasonStream(streamFrom(sse))).rejects.toBeInstanceOf(
      ReasonStreamIncompleteError,
    );
  });

  it("Test 5 (malformed frame tolerance) — drops a malformed frame, still accumulates + resolves", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"valid"}}]}',
      "",
      "data: {not json",
      "",
      'data: {"choices":[{"delta":{"content":" tail"}}]}',
      "",
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const acc = await accumulateReasonStream(streamFrom(sse));
    expect(acc.text).toBe("valid tail");
    expect(acc.usage.totalTokens).toBe(7);
  });

  it("frames correctly across chunk boundaries (a frame split mid-JSON)", async () => {
    const acc = await accumulateReasonStream(
      streamFromChunks([
        'data: {"choices":[{"delta":{"content":"Hel',
        'lo"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\ndata: [DONE]\n\n',
      ]),
    );
    expect(acc.text).toBe("Hello");
    expect(acc.usage.totalTokens).toBe(2);
  });

  it("ignores a frame that has no `data: ` line (comment/keep-alive frame)", async () => {
    // SSE comment / keep-alive frames (":heartbeat") carry no `data: ` line —
    // they must be skipped without affecting accumulation.
    const sse = [
      ": keep-alive heartbeat",
      "",
      'data: {"choices":[{"delta":{"content":"after heartbeat"}}]}',
      "",
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const acc = await accumulateReasonStream(streamFrom(sse));
    expect(acc.text).toBe("after heartbeat");
    expect(acc.usage.totalTokens).toBe(2);
  });

  it("treats an explicit `error:null` frame as NOT an error (continues normally)", async () => {
    // A frame whose `error` is explicitly null is not an error event — the
    // `!== null` guard must let it through so accumulation continues.
    const sse = [
      'data: {"error":null,"choices":[{"delta":{"content":"not an error"}}]}',
      "",
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const acc = await accumulateReasonStream(streamFrom(sse));
    expect(acc.text).toBe("not an error");
    expect(acc.usage.totalTokens).toBe(2);
  });

  it("reconstructs usage when prompt_tokens/completion_tokens are absent (?? 0 arms)", async () => {
    // A terminal usage object carrying ONLY total_tokens (no prompt/completion)
    // exercises the `?? 0` fallbacks on both fields.
    const sse = [
      'data: {"choices":[{"delta":{"content":"z"}}]}',
      "",
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":4}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const acc = await accumulateReasonStream(streamFrom(sse));
    expect(acc.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 4 });
  });
});
