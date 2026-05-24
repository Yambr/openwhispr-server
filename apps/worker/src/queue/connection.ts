// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick-task 260524-u00 / Task A4 — VALKEY_URL parser for the worker.
//
// Previously the worker opened its BullMQ connection via
// `new IORedis({ host: VALKEY_HOST, port: VALKEY_PORT, password: VALKEY_PASSWORD })`
// (apps/worker/src/index.ts:130-136 before this commit) — a split-env shape
// that diverged from the api's `new Redis(VALKEY_URL)` pattern at
// apps/api/src/plugins/rate-limit.ts:193. The asymmetry forced operators
// to wire BOTH a URL secret (for api/web) AND the split-keys (for worker)
// in their Helm values, even when the same Valkey endpoint backed all three
// services. See peer's chart-1.0.5 values-yambr.yaml extraEnv workaround.
//
// This helper centralises URL parsing so all three services consume the
// same secret shape (`VALKEY_URL=redis://[:pass@]host:port[/db]` or
// `rediss://...` for TLS). ioredis natively parses redis:// + rediss://
// URLs — auth, port, TLS detection are all derived from the URL.
//
// LOUD-FAIL on missing VALKEY_URL: the worker has no sensible default
// (unlike api which defaults to in-memory rate limiting when absent).
// Without a queue connection the worker is a no-op process; crashing at
// boot surfaces the misconfiguration in Loki/kubectl logs immediately.
//
// Migration hint: if VALKEY_HOST is set but VALKEY_URL is not, throw with
// an explicit "set VALKEY_URL" message so operators on the pre-1.0.6
// split-env layout get a clear diagnostic instead of an opaque connect
// failure.

import IORedis from "ioredis";

export interface BuildRedisConnectionOpts {
  /**
   * Override the env source (defaults to `process.env`). Pure injection so
   * unit tests don't have to mutate `process.env` globals.
   */
  env?: NodeJS.ProcessEnv;
}

/**
 * Build the worker's BullMQ Redis/Valkey connection from VALKEY_URL.
 *
 * Caller owns lifecycle — close via `.quit()` on shutdown. The returned
 * client is the same `IORedis` instance BullMQ accepts as `connection`.
 */
export function buildRedisConnection(opts: BuildRedisConnectionOpts = {}): IORedis {
  const env = opts.env ?? process.env;
  const url = env["VALKEY_URL"];

  if (!url) {
    if (env["VALKEY_HOST"] !== undefined) {
      throw new Error(
        "VALKEY_URL is required (split VALKEY_HOST/PORT/PASSWORD env was removed in chart-1.0.6 / worker v1.0.4 — set VALKEY_URL=redis://[:password@]host:port[/db] or rediss://... for TLS)",
      );
    }
    throw new Error(
      "VALKEY_URL is required (set VALKEY_URL=redis://[:password@]host:port[/db] or rediss://... for TLS)",
    );
  }

  return new IORedis(url, { maxRetriesPerRequest: null });
}
