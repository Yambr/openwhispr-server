// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 08.1 / Plan 01 / Task 1 RED→GREEN — forensic-probe unit tests.
//
// Drives `runProbe()` with a fake HTTP adapter; asserts every endpoint is
// exercised exactly once with the request shape the api expects, and that
// the captured artifact is well-formed JSON.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  type ProbeHttpAdapter,
  type ProbeRecord,
  runProbe,
  writeProbeArtifact,
} from "./forensic-probe.js";

function makeAdapter(): {
  adapter: ProbeHttpAdapter;
  calls: {
    request: Parameters<ProbeHttpAdapter["request"]>[0][];
    ws: Parameters<ProbeHttpAdapter["wsRoundtrip"]>[0][];
  };
} {
  const calls = {
    request: [] as Parameters<ProbeHttpAdapter["request"]>[0][],
    ws: [] as Parameters<ProbeHttpAdapter["wsRoundtrip"]>[0][],
  };
  const adapter: ProbeHttpAdapter = {
    request: vi.fn(async (args) => {
      calls.request.push(args);
      // Default canned response — 200 with a plausible body per endpoint.
      if (args.url.endsWith("/api/transcribe")) {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: '{"text":"hi"}',
        };
      }
      if (args.url.endsWith("/api/reason")) {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: '{"text":"answer","model":"x","provider":"y","promptMode":"default","matchType":"default"}',
        };
      }
      if (args.url.endsWith("/api/agent/stream")) {
        return {
          status: 200,
          headers: { "content-type": "application/x-ndjson" },
          body: '{"type":"finish"}\n',
        };
      }
      return { status: 404, headers: {}, body: "" };
    }),
    wsRoundtrip: vi.fn(async (args) => {
      calls.ws.push(args);
      return { status: 101, receivedFrame: '{"type":"session.created"}' };
    }),
  };
  return { adapter, calls };
}

describe("runProbe", () => {
  it("hits all four endpoints exactly once", async () => {
    const { adapter, calls } = makeAdapter();
    const records = await runProbe({
      baseUrl: "https://api.localhost",
      user: { email: "u@x", token: "tok" },
      wavBytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
      adapter,
    });
    expect(records).toHaveLength(4);
    const endpoints = records.map((r) => r.endpoint).sort();
    expect(endpoints).toEqual(["agent-stream", "realtime-ws", "reason", "transcribe"]);
    expect(calls.request).toHaveLength(3);
    expect(calls.ws).toHaveLength(1);
  });

  it("sends transcribe as multipart/form-data with file/model/language", async () => {
    const { adapter, calls } = makeAdapter();
    await runProbe({
      baseUrl: "https://api.localhost",
      user: { email: "u@x", token: "tok" },
      wavBytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
      adapter,
    });
    const tx = calls.request.find((r) => r.url.endsWith("/api/transcribe"));
    expect(tx).toBeDefined();
    expect(tx?.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    const bodyStr = new TextDecoder().decode(tx?.body as Uint8Array);
    expect(bodyStr).toContain('name="file"');
    expect(bodyStr).toContain('name="model"');
    expect(bodyStr).toContain("Systran/faster-whisper-large-v3");
    expect(bodyStr).toContain('name="language"');
    expect(bodyStr).toContain("\r\nen\r\n");
  });

  it("sends reason as JSON {text} matching the api ReasonRequest schema", async () => {
    const { adapter, calls } = makeAdapter();
    await runProbe({
      baseUrl: "https://api.localhost",
      user: { email: "u@x", token: "tok" },
      wavBytes: new Uint8Array(),
      adapter,
    });
    const rs = calls.request.find((r) => r.url.endsWith("/api/reason"));
    expect(rs).toBeDefined();
    expect(rs?.headers["content-type"]).toBe("application/json");
    const parsed = JSON.parse(rs?.body as string) as { text?: string; messages?: unknown };
    expect(typeof parsed.text).toBe("string");
    expect(parsed.text?.length ?? 0).toBeGreaterThan(0);
    // Critical: must NOT carry a `messages` field — api ReasonRequest is .strict().
    expect(parsed.messages).toBeUndefined();
  });

  it("sends agent-stream as JSON {messages} with application/x-ndjson accept", async () => {
    const { adapter, calls } = makeAdapter();
    await runProbe({
      baseUrl: "https://api.localhost",
      user: { email: "u@x", token: "tok" },
      wavBytes: new Uint8Array(),
      adapter,
    });
    const ag = calls.request.find((r) => r.url.endsWith("/api/agent/stream"));
    expect(ag).toBeDefined();
    expect(ag?.headers.accept).toBe("application/x-ndjson");
    expect(ag?.headers["content-type"]).toBe("application/json");
    const parsed = JSON.parse(ag?.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(Array.isArray(parsed.messages)).toBe(true);
    expect(parsed.messages[0]?.role).toBe("user");
  });

  it("issues a single WS round-trip to /v1/realtime", async () => {
    const { adapter, calls } = makeAdapter();
    await runProbe({
      baseUrl: "https://api.localhost",
      user: { email: "u@x", token: "tok-ws" },
      wavBytes: new Uint8Array(),
      adapter,
    });
    expect(calls.ws).toHaveLength(1);
    expect(calls.ws[0]?.url).toBe("wss://api.localhost/v1/realtime");
    expect(calls.ws[0]?.headers.authorization).toBe("Bearer tok-ws");
    const sent = calls.ws[0]?.sendFrame as string;
    expect(JSON.parse(sent).type).toBe("session.update");
  });

  it("captures status + body on every record (truncates >4KB)", async () => {
    const big = "x".repeat(5000);
    const adapter: ProbeHttpAdapter = {
      request: vi.fn(async () => ({ status: 200, headers: {}, body: big })),
      wsRoundtrip: vi.fn(async () => ({ status: 101, receivedFrame: big })),
    };
    const records = await runProbe({
      baseUrl: "https://api.localhost",
      user: { email: "u@x", token: "t" },
      wavBytes: new Uint8Array(),
      adapter,
    });
    for (const r of records) {
      expect(r.response.bodyTruncated.length).toBeLessThan(big.length);
      expect(r.response.bodyTruncated).toContain("truncated");
    }
  });

  it("captures adapter errors per-endpoint without aborting the probe", async () => {
    const adapter: ProbeHttpAdapter = {
      request: vi.fn(async () => {
        throw new Error("net-down");
      }),
      wsRoundtrip: vi.fn(async () => {
        throw new Error("ws-down");
      }),
    };
    const records = await runProbe({
      baseUrl: "https://api.localhost",
      user: { email: "u@x", token: "t" },
      wavBytes: new Uint8Array(),
      adapter,
    });
    expect(records).toHaveLength(4);
    for (const r of records) {
      expect(r.error).toBeDefined();
    }
  });

  it("captures ws errors via the structured error path", async () => {
    const adapter: ProbeHttpAdapter = {
      request: vi.fn(async () => ({ status: 200, headers: {}, body: "{}" })),
      wsRoundtrip: vi.fn(async () => ({ status: 0, receivedFrame: null, error: "timeout-2000ms" })),
    };
    const records = await runProbe({
      baseUrl: "https://api.localhost",
      user: { email: "u@x", token: "t" },
      wavBytes: new Uint8Array(),
      adapter,
    });
    const ws = records.find((r) => r.endpoint === "realtime-ws");
    expect(ws?.error).toBe("timeout-2000ms");
    expect(ws?.response.status).toBe(0);
  });
});

describe("writeProbeArtifact", () => {
  it("writes a well-formed JSON file with schemaVersion + records", () => {
    const dir = mkdtempSync(join(tmpdir(), "forensic-"));
    const out = join(dir, "forensic-probe-output.json");
    const records: ProbeRecord[] = [
      {
        endpoint: "transcribe",
        request: { method: "POST", url: "/api/transcribe", headers: {}, bodyShape: "mp" },
        response: { status: 200, headers: {}, bodyTruncated: '{"text":"ok"}' },
      },
    ];
    writeProbeArtifact(records, out);
    expect(existsSync(out)).toBe(true);
    const parsed = JSON.parse(readFileSync(out, "utf8")) as {
      schemaVersion: number;
      capturedAt: string;
      records: ProbeRecord[];
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]?.endpoint).toBe("transcribe");
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the parent directory if missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "forensic-"));
    const out = join(dir, "nested", "path", "out.json");
    writeProbeArtifact([], out);
    expect(existsSync(out)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
