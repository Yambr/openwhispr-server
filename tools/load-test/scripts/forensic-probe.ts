// SPDX-License-Identifier: Apache-2.0
// Phase 08.1 / Plan 01 / Task 1 — Forensic probe.
//
// Issues ONE real request to each of the four load-test endpoints, captures
// the full request / response pair, and writes it to
// `.planning/phases/08-load-test-tuning-slo-publication/runs/forensics/
//  forensic-probe-output.json`.
//
// Purpose: when plan 07's live run reported 99.93% HTTP error rate the
// containers were torn down by run.sh's trap before the api logs could be
// captured. This script is intended to be run with the stack KEPT ALIVE
// (set OPENWHISPR_LOADTEST_KEEP_STACK=1 in run.sh) — it exercises every
// endpoint once and lands a deterministic artifact that pins down which
// status code + body shape each endpoint actually returns.
//
// Architecture: an injectable HTTP adapter so the script is fully testable
// in vitest (forensic-probe.test.ts swaps in a fake adapter that captures
// the calls). The production path uses Node 24's global fetch + the
// built-in WebSocket via `ws` package as a thin client.
//
// Run from repo root:
//   pnpm --filter @openwhispr/load-test exec tsx scripts/forensic-probe.ts
//
// Exit codes:
//   0  — all four endpoints responded (regardless of status); artifact written
//   1  — fatal harness error (could not write artifact, network unreachable, etc.)

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  type ProvisionedUser,
  provisionUsers,
  type HttpClient as SetupHttpClient,
} from "../src/setup.js";

/** One captured request/response pair (body truncated to 4 KB per plan). */
export interface ProbeRecord {
  endpoint: "transcribe" | "reason" | "agent-stream" | "realtime-ws";
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    bodyShape: string;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    bodyTruncated: string;
  };
  error?: string;
}

/** The HTTP surface the probe consumes. Tests inject a fake. */
export interface ProbeHttpAdapter {
  request(args: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: Uint8Array | string;
  }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
  wsRoundtrip(args: {
    url: string;
    headers: Record<string, string>;
    sendFrame: string;
  }): Promise<{ status: number; receivedFrame: string | null; error?: string }>;
}

const BODY_TRUNCATE_BYTES = 4 * 1024;

function truncate(body: string): string {
  if (body.length <= BODY_TRUNCATE_BYTES) return body;
  return `${body.slice(0, BODY_TRUNCATE_BYTES)}…[truncated ${body.length - BODY_TRUNCATE_BYTES} bytes]`;
}

export interface ProbeOpts {
  baseUrl: string;
  user: ProvisionedUser;
  wavBytes: Uint8Array;
  adapter: ProbeHttpAdapter;
}

/** Run all four endpoint probes. Catches per-endpoint failures so a single
 *  endpoint outage does not abort the whole probe — every endpoint produces
 *  exactly one record, with `error` populated on adapter throws. */
export async function runProbe(opts: ProbeOpts): Promise<ProbeRecord[]> {
  const bearer = `Bearer ${opts.user.token}`;
  const records: ProbeRecord[] = [];

  // 1. transcribe — multipart audio upload.
  await captureHttp(
    records,
    "transcribe",
    async () => {
      const boundary = "----ForensicProbeBoundary";
      const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="probe.wav"\r\nContent-Type: audio/wav\r\n\r\n`;
      const tail = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nSystran/faster-whisper-large-v3\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n--${boundary}--\r\n`;
      const bodyBytes = concatBytes([toBytes(head), opts.wavBytes, toBytes(tail)]);
      return opts.adapter.request({
        method: "POST",
        url: `${opts.baseUrl}/api/transcribe`,
        headers: {
          authorization: bearer,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        body: bodyBytes,
      });
    },
    "POST /api/transcribe (multipart: file/model/language)",
  );

  // 2. reason — JSON body (current k6 sends {model, messages} — api expects {text}).
  await captureHttp(
    records,
    "reason",
    async () => {
      return opts.adapter.request({
        method: "POST",
        url: `${opts.baseUrl}/api/reason`,
        headers: { authorization: bearer, "content-type": "application/json" },
        body: JSON.stringify({ text: "What is the capital of France?" }),
      });
    },
    "POST /api/reason (JSON: {text})",
  );

  // 3. agent-stream — JSON body, NDJSON response.
  await captureHttp(
    records,
    "agent-stream",
    async () => {
      return opts.adapter.request({
        method: "POST",
        url: `${opts.baseUrl}/api/agent/stream`,
        headers: {
          authorization: bearer,
          "content-type": "application/json",
          accept: "application/x-ndjson",
        },
        body: JSON.stringify({ messages: [{ role: "user", content: "Say hi." }] }),
      });
    },
    "POST /api/agent/stream (JSON: {messages})",
  );

  // 4. realtime-ws — single round-trip.
  await captureWs(records, opts);

  return records;
}

async function captureHttp(
  out: ProbeRecord[],
  endpoint: ProbeRecord["endpoint"],
  invoke: () => Promise<{ status: number; headers: Record<string, string>; body: string }>,
  bodyShape: string,
): Promise<void> {
  try {
    const res = await invoke();
    out.push({
      endpoint,
      request: { method: "POST", url: endpointUrl(endpoint), headers: {}, bodyShape },
      response: {
        status: res.status,
        headers: res.headers,
        bodyTruncated: truncate(res.body),
      },
    });
  } catch (err) {
    out.push({
      endpoint,
      request: { method: "POST", url: endpointUrl(endpoint), headers: {}, bodyShape },
      response: { status: 0, headers: {}, bodyTruncated: "" },
      error: (err as Error).message,
    });
  }
}

async function captureWs(out: ProbeRecord[], opts: ProbeOpts): Promise<void> {
  const wsUrl = `${opts.baseUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:")}/v1/realtime`;
  try {
    const res = await opts.adapter.wsRoundtrip({
      url: wsUrl,
      headers: { authorization: `Bearer ${opts.user.token}` },
      sendFrame: JSON.stringify({ type: "session.update" }),
    });
    out.push({
      endpoint: "realtime-ws",
      request: {
        method: "WS-UPGRADE",
        url: wsUrl,
        headers: {},
        bodyShape: "{type:'session.update'}",
      },
      response: {
        status: res.status,
        headers: {},
        bodyTruncated: truncate(res.receivedFrame ?? ""),
      },
      ...(res.error ? { error: res.error } : {}),
    });
  } catch (err) {
    out.push({
      endpoint: "realtime-ws",
      request: {
        method: "WS-UPGRADE",
        url: wsUrl,
        headers: {},
        bodyShape: "{type:'session.update'}",
      },
      response: { status: 0, headers: {}, bodyTruncated: "" },
      error: (err as Error).message,
    });
  }
}

function endpointUrl(ep: ProbeRecord["endpoint"]): string {
  switch (ep) {
    case "transcribe":
      return "/api/transcribe";
    case "reason":
      return "/api/reason";
    case "agent-stream":
      return "/api/agent/stream";
    case "realtime-ws":
      return "/v1/realtime";
  }
}

function toBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export function writeProbeArtifact(records: ProbeRecord[], outPath: string): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify({ schemaVersion: 1, capturedAt: new Date().toISOString(), records }, null, 2),
  );
}

// ---------------------------------------------------------------------------
// CLI entrypoint — executed only when this file is run directly via tsx.
// Exercised via the live forensic-capture step in plan 08.1-01 Task 1 only;
// excluded from coverage because it depends on a running stack.
// ---------------------------------------------------------------------------

/* c8 ignore start */
/** Real adapter: Node 24 global fetch + ws upgrade via undici's WebSocket. */
function makeNodeAdapter(): ProbeHttpAdapter {
  return {
    async request(args) {
      const res = await fetch(args.url, {
        method: args.method,
        headers: args.headers,
        body: args.body as BodyInit | undefined,
      });
      const text = await res.text();
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      return { status: res.status, headers, body: text };
    },
    async wsRoundtrip(args) {
      return new Promise((resolveP) => {
        const ws = new WebSocket(args.url, {
          headers: args.headers,
        } as unknown as string);
        const timeout = setTimeout(() => {
          try {
            ws.close();
          } catch {}
          resolveP({ status: 0, receivedFrame: null, error: "timeout-2000ms" });
        }, 2000);
        ws.addEventListener("open", () => {
          ws.send(args.sendFrame);
        });
        ws.addEventListener("message", (ev: MessageEvent) => {
          clearTimeout(timeout);
          try {
            ws.close();
          } catch {}
          resolveP({
            status: 101,
            receivedFrame: typeof ev.data === "string" ? ev.data : String(ev.data),
          });
        });
        ws.addEventListener("error", (ev: Event) => {
          clearTimeout(timeout);
          try {
            ws.close();
          } catch {}
          resolveP({
            status: 0,
            receivedFrame: null,
            error: `error:${(ev as { message?: string }).message ?? "ws"}`,
          });
        });
      });
    },
  };
}

async function main(): Promise<void> {
  const baseUrl = process.env["BASE_URL"] ?? "https://api.localhost";
  const probeUserCount = 1;
  // Provision one ephemeral user via the same code path the load test uses.
  const httpClient: SetupHttpClient = (url, body) => {
    // Provisioning uses fetch synchronously in the test surface, but our
    // production adapter is async — we resort to a tiny synchronous shim
    // here. The forensic probe is run interactively, so sync XHR is OK.
    // In practice we re-implement provisioning with fetch directly.
    throw new Error(
      `forensic-probe.ts CLI: synchronous httpClient not wired — pass BASE_URL with pre-provisioned token instead. url=${url}, body=${JSON.stringify(body)?.slice(0, 80)}`,
    );
  };
  let user: ProvisionedUser;
  // If a token is provided directly, skip provisionUsers entirely.
  const tokenEnv = process.env["LOADTEST_TOKEN"];
  const emailEnv = process.env["LOADTEST_EMAIL"];
  if (tokenEnv) {
    user = { email: emailEnv ?? "probe@example.test", token: tokenEnv };
  } else {
    const provisioned = provisionUsers({
      backend: baseUrl,
      count: probeUserCount,
      httpClient,
      sleep: () => {},
    });
    const first = provisioned[0];
    if (!first) throw new Error("provisionUsers returned empty");
    user = first;
  }
  // 5-second mono 16 kHz silence-ish WAV — tiny header + zeros payload.
  const wavBytes = makeSilentWav(5);
  const records = await runProbe({
    baseUrl,
    user,
    wavBytes,
    adapter: makeNodeAdapter(),
  });
  const outPath = resolve(
    process.cwd(),
    ".planning/phases/08-load-test-tuning-slo-publication/runs/forensics/forensic-probe-output.json",
  );
  writeProbeArtifact(records, outPath);
  console.error(`forensic-probe: ${records.length} endpoint records written to ${outPath}`);
}

function makeSilentWav(durationSec: number): Uint8Array {
  const sampleRate = 16000;
  const numSamples = sampleRate * durationSec;
  const byteLength = 44 + numSamples * 2;
  const buf = new Uint8Array(byteLength);
  const view = new DataView(buf.buffer);
  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, byteLength - 8, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, numSamples * 2, true);
  // remainder is already zeroed — silence.
  return buf;
}

const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("forensic-probe.ts");

if (invokedDirectly) {
  main().catch((err) => {
    console.error("forensic-probe: fatal:", err);
    process.exit(1);
  });
}
/* c8 ignore stop */
