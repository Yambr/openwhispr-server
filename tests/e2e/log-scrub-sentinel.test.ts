// tests/e2e/log-scrub-sentinel.test.ts
//
// Phase 6 / Plan 06-12c / Task 2 — OBS-03 / D-T4 log scrubbing e2e.
//
// Integration coverage of the same redact policy already exists at
// tests/integration/log-scrub-sentinel.test.ts (Plan 06-10) — twelve
// sentinel vectors driven through `buildLogger` + `makePino` factories
// in-process. This e2e variant boots the real docker-compose stack +
// captures REAL container stdout via `getContainer('api').logs({since})`
// and `getContainer('worker').logs({since})`. The truth asserted is
// "no SENTINEL string ever leaks to a real pino sink in a real
// production-image-runtime configuration" — the constitutional OBS-03
// "no leaks" gate.
//
// Truths asserted (per D-T4):
//   1. POST with Authorization: Bearer SENTINEL-AUTH-<t> → SENTINEL
//      absent from api container stdout.
//   2. Enqueue a worker job carrying SENTINEL-VK-<t> in its payload →
//      SENTINEL absent from worker container stdout (the worker logs
//      via makePino which mounts the same shared @openwhispr/observability
//      REDACT_PATHS — Plan 06-10).
//   3. `[REDACTED]` appears in the api log buffer somewhere in the
//      window — proves the redact path actually ran (rather than the
//      sentinel just not making it to the log call at all).
//
// CLAUDE.md `no mocks of internal logic`: real Better Auth request, real
// Fastify request-log plugin, real worker BullMQ Worker process, real
// pino sinks writing to real container stdout.
//
// Gated on E2E=1. Tear down with removeVolumes:true.

import type { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BACKEND_URL,
  enqueueBullMQJob,
  type Phase6Stack,
  phase6BringStackUp,
  waitForBullMQJob,
} from "./helpers/phase6-compose.js";

const SUITE_TIMEOUT_MS = 480_000;

let stack: Phase6Stack | undefined;
let testStartEpochSec = 0;

/** Drain a Readable stream into a single string. */
async function readStream(s: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of s) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

describe.skipIf(process.env.E2E !== "1")("log scrub sentinel sweep e2e (OBS-03, D-T4)", () => {
  beforeAll(async () => {
    testStartEpochSec = Math.floor(Date.now() / 1000) - 1;
    stack = await phase6BringStackUp({ seed: false, timeoutMs: 300_000 });
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    if (stack) await stack.down();
  }, 120_000);

  it("api request with SENTINEL-AUTH-<t> bearer leaves sentinel ABSENT from api container stdout", async () => {
    if (!stack) throw new Error("stack not initialized");
    const sentinelAuth = `SENTINEL-AUTH-${Date.now()}`;
    // Send a request the api will log. Use /api/health (always
    // registered) with an Authorization header carrying our sentinel.
    // The request-log plugin (Plan 06-03) logs Authorization headers
    // through the redact path; if it slips by, the bearer text
    // would land verbatim in container stdout.
    await fetch(`${BACKEND_URL}/api/health`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${sentinelAuth}`,
        "x-openwhispr-source": "phase6-e2e",
      },
    }).catch(() => undefined);

    // Also POST to a route that actively writes a request body — exercise
    // both the header-redact path AND the body-redact path in one
    // capture. /api/auth/sign-in/email is registered unconditionally;
    // we pass a body carrying our sentinel as a password (one of the
    // canonical redact targets in REDACT_PATHS).
    await fetch(`${BACKEND_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sentinelAuth}` },
      body: JSON.stringify({ email: "doesnotmatter@e2e.test", password: sentinelAuth }),
    }).catch(() => undefined);

    // Let pino flush its async destination.
    await new Promise((r) => setTimeout(r, 2000));

    const stream = await stack.api.logs({ since: testStartEpochSec });
    const apiLogs = await readStream(stream);
    expect(apiLogs.length).toBeGreaterThan(0);
    // Primary truth — sentinel MUST NOT appear anywhere in api stdout.
    expect(apiLogs).not.toContain(sentinelAuth);
    // Belt-and-suspenders — REDACT_PATHS censor is "[REDACTED]" per
    // packages/observability/src/redact.ts. We expect at least one
    // line carrying that literal (proves the redact codepath ran).
    expect(apiLogs).toContain("[REDACTED]");
  }, 180_000);

  it("worker job with SENTINEL-VK-<t> payload leaves sentinel ABSENT from worker container stdout", async () => {
    if (!stack) throw new Error("stack not initialized");
    const sentinelVk = `SENTINEL-VK-${Date.now()}`;
    // virtual-key-rotation's Zod schema requires
    // {tenant_id, user_id, reason}. We deliberately omit `tenant_id`
    // and stash the sentinel under `virtual_key` (one of the
    // canonical REDACT_PATHS entries — Plan 06-10). The job will fail
    // its Zod parse — that failure path is exactly the one most
    // likely to log the payload verbatim if the redactor isn't
    // wired into withTenantContext / withSystemContext, which is the
    // OBS-03 invariant.
    const jobId = await enqueueBullMQJob(
      stack.projectName,
      "virtual-key-rotation",
      "virtual-key-rotation",
      { virtual_key: sentinelVk, reason: "test" },
    );
    const result = await waitForBullMQJob(stack.projectName, "virtual-key-rotation", jobId, {
      deadlineMs: 60_000,
    });
    // We expect failure (invalid payload) — the failure path is what
    // we're sweeping for leaks.
    expect(["failed", "completed"]).toContain(result.state);

    // Allow pino flush + BullMQ to record the failure.
    await new Promise((r) => setTimeout(r, 2000));

    const stream = await stack.worker.logs({ since: testStartEpochSec });
    const workerLogs = await readStream(stream);
    expect(workerLogs.length).toBeGreaterThan(0);
    expect(workerLogs).not.toContain(sentinelVk);
  }, 180_000);
});
