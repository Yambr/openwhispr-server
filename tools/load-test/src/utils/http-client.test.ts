// Phase 08 / Plan 06 — Task 1 RED: tests for createK6Adapter +
// createMockAdapter shape contracts and WAV/JSON fixture validity.
//
// The k6-runtime adapter cannot be unit-tested directly (its internals
// require the k6 VM globals which vitest does not provide). What IS
// testable is:
//   1. The shape returned by createK6Adapter() — it implements HttpClient.
//   2. The mock adapter factory faithfully forwards calls to the
//      injected impl, including tags propagation.
//   3. The committed WAV fixture parses as RIFF/WAVE PCM at 16 kHz mono,
//      ~5 s long.
//   4. The prompt fixtures contain enough variety for the load run.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { createK6Adapter, createMockAdapter } from "./http-client.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(HERE, "..", "fixtures");

describe("createK6Adapter()", () => {
  it("returns an object satisfying the HttpClient interface (request + ws + httpFile functions)", () => {
    const adapter = createK6Adapter();
    expect(typeof adapter.request).toBe("function");
    expect(typeof adapter.ws).toBe("function");
    expect(typeof adapter.httpFile).toBe("function");
  });
});

describe("createMockAdapter()", () => {
  it("forwards request() calls to the injected impl with all arguments verbatim", () => {
    const request = vi.fn().mockReturnValue({
      status: 200,
      body: "ok",
      headers: { "x-test": "1" },
      timings: { waiting: 10, duration: 25 },
    });
    const adapter = createMockAdapter({ request });
    const result = adapter.request(
      "POST",
      "https://example/api",
      { hello: "world" },
      {
        headers: { authorization: "Bearer token" },
        tags: { endpoint: "transcribe" },
      },
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "POST",
      "https://example/api",
      { hello: "world" },
      {
        headers: { authorization: "Bearer token" },
        tags: { endpoint: "transcribe" },
      },
    );
    expect(result.status).toBe(200);
    expect(result.timings.waiting).toBe(10);
  });

  it("forwards ws() calls to the injected impl", () => {
    const ws = vi.fn().mockReturnValue({ status: 101 });
    const adapter = createMockAdapter({ ws });
    const handler = vi.fn();
    const result = adapter.ws("wss://example/realtime", { headers: {} }, handler);
    expect(ws).toHaveBeenCalledWith("wss://example/realtime", { headers: {} }, handler);
    expect(result.status).toBe(101);
  });

  it("throws if a method is called that the impl did not provide", () => {
    const adapter = createMockAdapter({});
    expect(() => adapter.request("GET", "https://x", undefined)).toThrow(/not mocked/i);
    expect(() => adapter.ws("wss://x", { headers: {} }, () => undefined)).toThrow(/not mocked/i);
  });

  it("provides a default httpFile() that returns the __k6_http_file descriptor (no mocking required)", () => {
    const adapter = createMockAdapter({});
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fd = adapter.httpFile(bytes, "x.wav", "audio/wav");
    expect(fd.__k6_http_file).toBe(true);
    expect(fd.bytes).toBe(bytes);
    expect(fd.filename).toBe("x.wav");
    expect(fd.contentType).toBe("audio/wav");
  });

  it("forwards httpFile() to the injected impl when one is provided", () => {
    const httpFile = vi.fn().mockReturnValue({
      __k6_http_file: true as const,
      bytes: new Uint8Array(),
      filename: "f",
      contentType: "ct",
    });
    const adapter = createMockAdapter({ httpFile });
    const bytes = new Uint8Array([9, 9]);
    adapter.httpFile(bytes, "z.wav", "audio/wav");
    expect(httpFile).toHaveBeenCalledWith(bytes, "z.wav", "audio/wav");
  });
});

describe("fixtures/sample-5s-16k.wav", () => {
  const wavPath = resolve(FIXTURES_DIR, "sample-5s-16k.wav");

  it("is a valid RIFF/WAVE PCM file (parse first 44 bytes)", () => {
    const bytes = readFileSync(wavPath);
    expect(bytes.length).toBeGreaterThan(44);
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(bytes.subarray(12, 16).toString("ascii")).toBe("fmt ");
    const audioFormat = bytes.readUInt16LE(20);
    expect(audioFormat).toBe(1); // PCM
  });

  it("is 16 kHz mono ~5 seconds (sample rate + data-chunk size)", () => {
    const bytes = readFileSync(wavPath);
    const numChannels = bytes.readUInt16LE(22);
    const sampleRate = bytes.readUInt32LE(24);
    const bitsPerSample = bytes.readUInt16LE(34);
    expect(numChannels).toBe(1);
    expect(sampleRate).toBe(16000);
    expect(bitsPerSample).toBe(16);

    // "data" chunk follows fmt; locate it (skip any LIST/JUNK chunks).
    let offset = 36;
    let dataSize = -1;
    while (offset < bytes.length - 8) {
      const id = bytes.subarray(offset, offset + 4).toString("ascii");
      const size = bytes.readUInt32LE(offset + 4);
      if (id === "data") {
        dataSize = size;
        break;
      }
      offset += 8 + size;
    }
    expect(dataSize).toBeGreaterThan(0);
    const seconds = dataSize / (sampleRate * numChannels * (bitsPerSample / 8));
    expect(seconds).toBeGreaterThanOrEqual(4.9);
    expect(seconds).toBeLessThanOrEqual(5.1);
  });
});

describe("fixtures/prompt-strings.json", () => {
  it("contains at least 50 non-empty English prompt strings", () => {
    const raw = readFileSync(resolve(FIXTURES_DIR, "prompt-strings.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    const arr = parsed as unknown[];
    expect(arr.length).toBeGreaterThanOrEqual(50);
    for (const entry of arr) {
      expect(typeof entry).toBe("string");
      expect((entry as string).trim().length).toBeGreaterThan(0);
    }
  });
});

describe("fixtures/conversation-history.json", () => {
  it("is a valid messages array with ≥ 3 entries of shape { role, content }", () => {
    const raw = readFileSync(resolve(FIXTURES_DIR, "conversation-history.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    const arr = parsed as unknown[];
    expect(arr.length).toBeGreaterThanOrEqual(3);
    for (const entry of arr) {
      expect(entry).toMatchObject({
        role: expect.stringMatching(/^(user|assistant|system)$/),
        content: expect.any(String),
      });
    }
  });
});
