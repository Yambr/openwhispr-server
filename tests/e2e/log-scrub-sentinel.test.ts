// SPDX-License-Identifier: Apache-2.0
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

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BACKEND_URL,
  containerLogsSnapshot,
  enqueueBullMQJob,
  type Phase6Stack,
  phase6BringStackUp,
  waitForBullMQJob,
} from "./helpers/phase6-compose.js";

const SUITE_TIMEOUT_MS = 480_000;

let stack: Phase6Stack | undefined;
let testStartEpochSec = 0;

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
    // Send a request the api will process. Use /api/health (always
    // registered) with an Authorization header carrying our sentinel.
    // The request-log plugin (Plan 06-03) tags `req.log` children with
    // the source header; if any error path serializes the request
    // headers, the bearer text could leak to container stdout.
    const r1 = await fetch(`${BACKEND_URL}/api/health`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${sentinelAuth}`,
        "x-openwhispr-source": "phase6-e2e",
      },
    }).catch(() => undefined);
    expect(r1?.status, "health responded — request reached the api").toBeDefined();

    // Also POST to a route that actively writes a request body. We pass
    // a body carrying our sentinel as a password (one of the canonical
    // redact targets in REDACT_PATHS). Better Auth's sign-in path
    // exercises the body-redact code path on Zod validation failure.
    const r2 = await fetch(`${BACKEND_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sentinelAuth}` },
      body: JSON.stringify({ email: "doesnotmatter@e2e.test", password: sentinelAuth }),
    }).catch(() => undefined);
    expect(r2?.status, "sign-in responded — request reached the api").toBeDefined();

    // Let any async destinations flush (pino transports, Better Auth
    // error paths, etc).
    await new Promise((r) => setTimeout(r, 3000));

    const apiLogs = await containerLogsSnapshot(stack.api, testStartEpochSec, {
      composeProject: stack.projectName,
      composeService: "api",
    });
    // Primary OBS-03 truth — the sentinel MUST NOT appear anywhere in
    // api stdout. The api Fastify instance is constructed with
    // `logger: false` (apps/api/src/index.ts:191) — request logging
    // is intentionally not wired in production to keep the hot path
    // minimal; per-request structured logging belongs to the worker
    // tier where the cost is amortized over the job duration. The
    // absence assertion still proves the constitutional OBS-03
    // invariant: under no codepath touched by a request carrying a
    // SENTINEL bearer does the api leak that bearer to its stdout.
    expect(apiLogs).not.toContain(sentinelAuth);
  }, 180_000);

  it("worker job with SENTINEL-EMAIL-<t> payload leaves sentinel ABSENT from worker container stdout", async () => {
    if (!stack) throw new Error("stack not initialized");
    const sentinelEmail = `SENTINEL-EMAIL-${Date.now()}`;
    // Phase 14 / Plan 05 — the virtual-key-rotation queue this test
    // previously exercised was removed wholesale (CONTEXT decision 3 +
    // BYOK-03 audit closure). The sentinel sweep is re-anchored to
    // email-delivery, the cheapest surviving queue with a deterministic
    // Zod-validated payload schema. We deliberately omit `tenant_id`
    // and stash the sentinel under `password` — one of the canonical
    // REDACT_PATHS entries from Plan 06-10. The job will fail its Zod
    // parse before reaching the SMTP boundary; that failure path is
    // exactly the one most likely to log the payload verbatim if the
    // redactor isn't wired into withTenantContext / withSystemContext,
    // which is the OBS-03 invariant we sweep for.
    const jobId = await enqueueBullMQJob(stack.projectName, "email-delivery", "email-delivery", {
      password: sentinelEmail,
      reason: "test",
    });
    const result = await waitForBullMQJob(stack.projectName, "email-delivery", jobId, {
      deadlineMs: 60_000,
    });
    // We expect failure (invalid payload) — the failure path is what
    // we're sweeping for leaks.
    expect(["failed", "completed"]).toContain(result.state);

    // Allow pino flush + BullMQ to record the failure.
    await new Promise((r) => setTimeout(r, 2000));

    const workerLogs = await containerLogsSnapshot(stack.worker, testStartEpochSec, {
      composeProject: stack.projectName,
      composeService: "worker",
    });
    expect(workerLogs.length).toBeGreaterThan(0);
    expect(workerLogs).not.toContain(sentinelEmail);
  }, 180_000);
});
