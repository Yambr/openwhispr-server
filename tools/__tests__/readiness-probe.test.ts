// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 13 / Plan 01 / Task 13-01-07 — unit tests for the readiness probe.
//
// Scope (per plan):
//   ≥ 4 tests covering the polling logic in
//   `tests/e2e-cjm/support/wait-for-readiness.ts`.
//
// Test boundary discipline:
//   The plan's note says "Mock `fetch` / `undici` MockAgent at the network
//   boundary (legitimate boundary mock)". We choose the cleaner injectable-
//   `fetchFn` form — the production wrapper inside the module always falls
//   through to `undici.fetch`. The injectable seam IS the network boundary;
//   no real HTTP traffic is generated during these tests. No internal logic
//   is mocked (CLAUDE.md anti-mock rule).
//
// Coverage target: ≥ 90/90/90/90 on
// `tests/e2e-cjm/support/wait-for-readiness.ts` (constitutional floor).
import { describe, expect, it } from "vitest";
import {
  type FetchFn,
  makeLocalhostTrustingDispatcher,
  waitForReadiness,
} from "../../tests/e2e-cjm/support/wait-for-readiness.js";

/** Build a deterministic clock that advances by `step` ms per sample. */
function fakeClock(step = 100): { now: () => number; advance(ms: number): void } {
  let t = 0;
  return {
    now: () => {
      const v = t;
      t += step;
      return v;
    },
    advance(ms: number) {
      t += ms;
    },
  };
}

/** Build a fetch stub that returns a queued sequence of responses. */
function queuedFetch(
  queue: Array<
    | { ok: true; status: number; body: unknown | string }
    | { ok: false; status: number; body?: string }
    | { throw: unknown }
  >,
): { fn: FetchFn; calls: string[] } {
  const calls: string[] = [];
  const fn: FetchFn = async (input) => {
    calls.push(input);
    const next = queue.shift();
    if (!next) {
      throw new Error(`queuedFetch: queue underflow on input=${input}`);
    }
    if ("throw" in next) {
      throw next.throw;
    }
    const status = next.status;
    const ok = next.ok;
    const bodyStr =
      typeof next.body === "string"
        ? next.body
        : next.body === undefined
          ? ""
          : JSON.stringify(next.body);
    return {
      ok,
      status,
      text: () => Promise.resolve(bodyStr),
    };
  };
  return { fn, calls };
}

describe("wait-for-readiness probe", () => {
  it("(a) resolves on the first poll when /api/health returns ok + migrations_completed=true", async () => {
    const { fn, calls } = queuedFetch([
      { ok: true, status: 200, body: { status: "ok", migrations_completed: true } },
    ]);
    const sleeps: number[] = [];
    const clock = fakeClock();
    const result = await waitForReadiness({
      url: "https://api.localhost/api/health",
      timeoutMs: 10_000,
      intervalMs: 500,
      fetchFn: fn,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: clock.now,
    });
    expect(result.attempts).toBe(1);
    expect(result.body.status).toBe("ok");
    expect(result.body.migrations_completed).toBe(true);
    expect(calls).toEqual(["https://api.localhost/api/health"]);
    // First-poll success: we never slept.
    expect(sleeps).toHaveLength(0);
  });

  it("(b) resolves after N retries when the api is initially not ready", async () => {
    const { fn } = queuedFetch([
      // Attempt 1: 200 OK but migrations_completed=false (migrations still running).
      { ok: true, status: 200, body: { status: "ok", migrations_completed: false } },
      // Attempt 2: 503 (api container still starting).
      { ok: false, status: 503, body: "service unavailable" },
      // Attempt 3: 200 OK + migrations_completed=true.
      { ok: true, status: 200, body: { status: "ok", migrations_completed: true } },
    ]);
    const sleeps: number[] = [];
    const result = await waitForReadiness({
      url: "https://api.localhost/api/health",
      timeoutMs: 60_000,
      intervalMs: 250,
      fetchFn: fn,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: fakeClock().now,
    });
    expect(result.attempts).toBe(3);
    // Two sleeps between three attempts.
    expect(sleeps).toEqual([250, 250]);
  });

  it("(c) throws with diagnostic context when the deadline elapses", async () => {
    const { fn } = queuedFetch(
      // Always not-ready — the queue should never empty within timeout.
      Array.from({ length: 50 }, () => ({
        ok: true as const,
        status: 200,
        body: { status: "ok", migrations_completed: false },
      })),
    );
    let calls = 0;
    const now = () => {
      calls += 1;
      // Burn budget on the second `now()` call inside the loop iteration
      // so we exhaust the deadline after exactly one attempt.
      return calls < 3 ? 0 : 10_001;
    };
    await expect(
      waitForReadiness({
        url: "https://api.localhost/api/health",
        timeoutMs: 10_000,
        intervalMs: 10,
        fetchFn: fn,
        sleep: async () => undefined,
        now,
      }),
    ).rejects.toThrow(/never became ready within 10000ms/);
  });

  it("(d) treats missing migrations_completed as not-ready (keeps polling) and recovers when the field arrives", async () => {
    const { fn } = queuedFetch([
      // Attempt 1: schema-incomplete response — no migrations_completed field at all.
      { ok: true, status: 200, body: { status: "ok" } },
      // Attempt 2: full payload arrives.
      { ok: true, status: 200, body: { status: "ok", migrations_completed: true } },
    ]);
    const result = await waitForReadiness({
      url: "https://api.localhost/api/health",
      timeoutMs: 30_000,
      intervalMs: 100,
      fetchFn: fn,
      sleep: async () => undefined,
      now: fakeClock().now,
    });
    expect(result.attempts).toBe(2);
  });

  it("(e) treats fetch throws (ECONNREFUSED-shape errors) as not-ready and surfaces last_err in the timeout message", async () => {
    const queue: Array<{ throw: unknown }> = Array.from({ length: 50 }, () => ({
      throw: Object.assign(new Error("ECONNREFUSED 127.0.0.1:443"), {
        code: "ECONNREFUSED",
      }),
    }));
    const { fn } = queuedFetch(queue);
    let tick = 0;
    const now = () => {
      // First two `now()` calls in two iterations are pre-deadline; subsequent
      // tick blows the budget so the loop exits with a non-empty `lastErr`.
      tick += 1;
      return tick <= 4 ? 0 : 5_001;
    };
    await expect(
      waitForReadiness({
        url: "https://api.localhost/api/health",
        timeoutMs: 5_000,
        intervalMs: 10,
        fetchFn: fn,
        sleep: async () => undefined,
        now,
      }),
    ).rejects.toThrow(/last_err=.*ECONNREFUSED/);
  });

  it("(f-defaults) uses the real default sleep + now thunks when not injected", async () => {
    // No `sleep` or `now` overrides → the default thunks (lines 124-125) get
    // exercised. We DO inject fetchFn so the test stays hermetic (no actual
    // undici traffic). Two attempts forces the default sleep to fire once;
    // `intervalMs: 1` keeps the wall-clock cost negligible (~1ms total).
    const { fn } = queuedFetch([
      { ok: true, status: 200, body: { status: "ok", migrations_completed: false } },
      { ok: true, status: 200, body: { status: "ok", migrations_completed: true } },
    ]);
    const result = await waitForReadiness({
      url: "https://api.localhost/api/health",
      fetchFn: fn,
      intervalMs: 1,
      timeoutMs: 5_000,
    });
    expect(result.attempts).toBe(2);
  });

  it("(f-default-url) falls back to the DEFAULT_URL when no `url` is passed", async () => {
    // Inject fetchFn so we don't actually open a socket. The point of this
    // test is to drive the `opts.url ?? DEFAULT_URL` branch — exercising
    // the right-hand-side of the nullish coalesce.
    const seen: string[] = [];
    const fn: FetchFn = async (input) => {
      seen.push(input);
      return {
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ status: "ok", migrations_completed: true })),
      };
    };
    const result = await waitForReadiness({ fetchFn: fn });
    expect(result.attempts).toBe(1);
    // Should have polled the canonical DEFAULT_URL (env-driven or hard default).
    expect(seen[0]).toMatch(/\/api\/health$/);
  });

  it("(f) treats non-JSON OK body as not-ready (does NOT throw on parse error)", async () => {
    const { fn } = queuedFetch([
      { ok: true, status: 200, body: "<html>not the api</html>" },
      { ok: true, status: 200, body: { status: "ok", migrations_completed: true } },
    ]);
    const result = await waitForReadiness({
      url: "https://api.localhost/api/health",
      timeoutMs: 30_000,
      intervalMs: 50,
      fetchFn: fn,
      sleep: async () => undefined,
      now: fakeClock().now,
    });
    expect(result.attempts).toBe(2);
  });
});

describe("makeLocalhostTrustingDispatcher (TLS scope guard)", () => {
  it("returns a self-signed-accepting dispatcher for *.localhost hosts", () => {
    const d = makeLocalhostTrustingDispatcher("https://api.localhost/api/health");
    expect(d).toBeDefined();
    // The dispatcher must be an undici.Agent — `close()` is on the Dispatcher
    // contract. We don't await `close` (it returns a promise) — just assert
    // the API surface so we know it's a real dispatcher.
    expect(typeof (d as { close: () => Promise<void> }).close).toBe("function");
  });

  it("returns a self-signed-accepting dispatcher for bare `localhost`", () => {
    const d = makeLocalhostTrustingDispatcher("http://localhost:3000/api/health");
    expect(d).toBeDefined();
  });

  it("returns undefined for non-localhost hostnames (strict TLS preserved)", () => {
    expect(makeLocalhostTrustingDispatcher("https://example.com/")).toBeUndefined();
    expect(makeLocalhostTrustingDispatcher("https://api.openwhispr.io/")).toBeUndefined();
  });

  it("returns undefined for malformed URLs (input validation guard)", () => {
    expect(makeLocalhostTrustingDispatcher("not a url")).toBeUndefined();
    expect(makeLocalhostTrustingDispatcher("")).toBeUndefined();
  });
});
