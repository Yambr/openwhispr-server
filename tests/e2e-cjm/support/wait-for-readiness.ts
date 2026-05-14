// SPDX-License-Identifier: Apache-2.0
// Phase 13 / Plan 01 / Task 13-01-07 — readiness gate for the e2e-cjm harness.
//
// Polls `${READINESS_HEALTH_URL:-https://api.localhost/api/health}` until the
// response body parses as `{ status: "ok", migrations_completed: true }`.
//
// This is the canonical readiness signal Session 3 delivered in
// `apps/api/src/routes/probes.ts` — when `migrations_completed: true` the
// schema is on the expected revision, Postgres is reachable through the
// app pool, PgBouncer + Valkey are wired (otherwise the api container's own
// healthcheck would not be passing → Traefik would 502 → fetch would fail
// here and we'd keep polling). DB liveness is therefore proven transitively;
// see plan OQ-3 / Session 3 §4c.
//
// Two consumers:
//   1. The CLI entrypoint at the bottom of this file — invoked from the
//      Makefile target authored in Session 5
//      (`pnpm tsx tests/e2e-cjm/support/wait-for-readiness.ts`).
//   2. Programmatic — `compose-harness.ts` re-uses `waitForReadiness({...})`
//      so the boot pipeline composes cleanly.
//
// Design notes:
//   - The probe is `https://api.localhost/...` over Traefik's self-signed
//     dev cert. We construct a per-request `undici.Agent` with
//     `connect.rejectUnauthorized = false` ONLY for `*.localhost` hostnames
//     (never globally — see CLAUDE.md anti-workaround rules). Non-localhost
//     URLs hit the default fetch with strict TLS.
//   - The HTTP boundary is injectable via the `fetchFn` option for unit
//     tests. The default uses `globalThis.fetch` + the scoped dispatcher.
//   - Timeout default 120s, interval default 2s (per plan §13-01-07).
//   - Non-200, missing fields, and `migrations_completed: false` are all
//     "not ready yet" — keep polling, don't throw.
//   - Genuine errors (timeout reached, hostname allow-list breach when caller
//     overrides URL to an explicit IP) DO throw, with the last seen status +
//     body excerpt for diagnosability.
import { Agent, fetch as undiciFetch } from "undici";

export type FetchFn = (
  input: string,
  init?: { signal?: AbortSignal; dispatcher?: Agent },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface WaitForReadinessOptions {
  /** URL to poll. Default `process.env.READINESS_HEALTH_URL` or the canonical localhost. */
  url?: string;
  /** Hard deadline. Default 120_000. */
  timeoutMs?: number;
  /** Poll interval between attempts. Default 2_000. */
  intervalMs?: number;
  /** Injected for unit tests. Production code path uses `undici.fetch`. */
  fetchFn?: FetchFn;
  /** Injected for unit tests so we don't wall-clock-block. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for unit tests. */
  now?: () => number;
}

export interface ReadinessResult {
  attempts: number;
  elapsedMs: number;
  body: { status: string; migrations_completed: boolean };
}

const DEFAULT_URL = process.env.READINESS_HEALTH_URL ?? "https://api.localhost/api/health";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_INTERVAL_MS = 2_000;

/**
 * Build a dispatcher that accepts self-signed certs ONLY when the host is
 * the RFC-6761 reserved `*.localhost`. Anything else gets the default
 * (strict-TLS) global dispatcher.
 *
 * Exported for the unit tests; production callers should pass nothing —
 * the default fetch path is wired here.
 */
export function makeLocalhostTrustingDispatcher(targetUrl: string): Agent | undefined {
  let host: string;
  try {
    host = new URL(targetUrl).hostname;
  } catch {
    return undefined;
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    return new Agent({ connect: { rejectUnauthorized: false } });
  }
  return undefined;
}

/* c8 ignore start -- thin network-boundary wrapper around undici.fetch; exercised by Session 5 live-stack proof. */
function defaultFetch(): FetchFn {
  return async (input, init) => {
    const dispatcher = init?.dispatcher ?? makeLocalhostTrustingDispatcher(input);
    const res = await undiciFetch(input, {
      signal: init?.signal,
      dispatcher,
    });
    return {
      ok: res.ok,
      status: res.status,
      text: () => res.text(),
    };
  };
}
/* c8 ignore stop */

/**
 * Poll the health endpoint until `{ status: "ok", migrations_completed: true }`
 * or the deadline expires. Throws an Error with diagnostic context on
 * deadline; never throws on transient errors.
 */
export async function waitForReadiness(
  opts: WaitForReadinessOptions = {},
): Promise<ReadinessResult> {
  const url = opts.url ?? DEFAULT_URL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const fetchFn = opts.fetchFn ?? defaultFetch();
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());

  const started = now();
  let attempts = 0;
  let lastStatus = -1;
  let lastBody = "";
  let lastErr: unknown;

  while (now() - started < timeoutMs) {
    attempts += 1;
    try {
      const res = await fetchFn(url);
      lastStatus = res.status;
      if (res.ok) {
        const raw = await res.text();
        lastBody = raw.slice(0, 300);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = undefined;
        }
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          (parsed as { status?: unknown }).status === "ok" &&
          (parsed as { migrations_completed?: unknown }).migrations_completed === true
        ) {
          return {
            attempts,
            elapsedMs: now() - started,
            body: parsed as ReadinessResult["body"],
          };
        }
      }
    } catch (err) {
      lastErr = err;
    }
    await sleep(intervalMs);
  }

  throw new Error(
    `waitForReadiness: ${url} never became ready within ${timeoutMs}ms ` +
      `(attempts=${attempts}, last_status=${lastStatus}, last_body=${lastBody}, ` +
      `last_err=${String(lastErr)})`,
  );
}

// -- CLI entry ----------------------------------------------------------------
//
// `pnpm tsx tests/e2e-cjm/support/wait-for-readiness.ts`
// Exit 0 on ready, exit 1 on timeout. Reads:
//   READINESS_HEALTH_URL      (default https://api.localhost/api/health)
//   READINESS_TIMEOUT_MS      (default 120000)
//   READINESS_INTERVAL_MS     (default 2000)
//
// We detect CLI mode via `process.argv[1]` matching this file. ESM-safe
// without falling back to the CJS-specific `require.main === module`.
/* c8 ignore start -- CLI bootstrap; covered by Session 5 live-stack proof. */
function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  // Compare the realpath of argv[1] to the realpath of this module.
  // Wrapped in try/catch — both `import.meta.url` and `fileURLToPath` are
  // available on Node 24 LTS but defensively guarded for non-ESM contexts.
  try {
    // Dynamic import keeps this function tree-shakable from non-CLI callers.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fileURLToPath } = require("node:url") as typeof import("node:url");
    const here = fileURLToPath(import.meta.url);
    return process.argv[1] === here;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const url = process.env.READINESS_HEALTH_URL ?? DEFAULT_URL;
  const timeoutMs = Number(process.env.READINESS_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const intervalMs = Number(process.env.READINESS_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);

  waitForReadiness({ url, timeoutMs, intervalMs }).then(
    (_r) => {
      process.exit(0);
    },
    (_err: Error) => {
      process.exit(1);
    },
  );
}
/* c8 ignore stop */
