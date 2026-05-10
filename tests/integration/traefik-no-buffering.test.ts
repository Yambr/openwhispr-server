/**
 * Phase 04 / Plan 08 / Task 2c — STRUCTURAL no-buffering assertion (D-04).
 *
 * Source-of-record: 04-RESEARCH.md §2.7 lines 691-704 + 04-CONTEXT.md D-04.
 *
 * Reads `compose/traefik/dynamic.yml` directly and asserts that NO router
 * carries a middleware whose name matches /buffering/i. Traefik 3 does
 * NOT buffer responses by default — the `buffering` middleware is opt-in,
 * and there is no `proxy_buffering on` knob to disable. The risk vector
 * this test guards against is a future contributor adding the middleware
 * (e.g. for an upload route) and accidentally attaching it to one of the
 * streaming routers, silently re-introducing buffering on /api/agent/stream
 * or /v1/realtime.
 *
 * Why structural: a timing test (Tasks 2a/2b) runs against a live stack
 * and can false-negative if the test fixture itself drifts. A structural
 * read of the config CANNOT false-negative — it's deterministic, has zero
 * runtime cost, and runs on every commit (no docker required).
 *
 * Sister test: `tests/integration/traefik-realtime-entrypoint.test.ts`
 * Test 5 (lines 145-159) already asserts the SAME contract for streaming
 * routers via a different code path; this file is the broader assertion
 * — NO router on ANY entrypoint may carry a buffering middleware. The
 * two tests together pin the contract from two angles.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO_ROOT = process.cwd().endsWith("/tests/integration")
  ? resolve(process.cwd(), "../..")
  : process.cwd();

const DYNAMIC_YML_PATH = resolve(REPO_ROOT, "compose/traefik/dynamic.yml");

interface Router {
  rule?: string;
  service?: string;
  entryPoints?: string[];
  middlewares?: string[];
  tls?: Record<string, unknown>;
}

interface DynamicConfig {
  http?: {
    routers?: Record<string, Router>;
    middlewares?: Record<string, unknown>;
  };
}

const loadDynamic = (): DynamicConfig =>
  parse(readFileSync(DYNAMIC_YML_PATH, "utf8")) as DynamicConfig;

describe("Plan 08 / Task 2c — STRUCTURAL: no Traefik buffering middleware on any router", () => {
  it("dynamic.yml parses cleanly (sanity)", () => {
    const cfg = loadDynamic();
    expect(cfg.http).toBeDefined();
    expect(cfg.http?.routers).toBeDefined();
    // At least one router must exist (otherwise the assertion below is
    // vacuous — guard against an accidentally emptied dynamic.yml).
    expect(Object.keys(cfg.http?.routers ?? {}).length).toBeGreaterThan(0);
  });

  it("NO router on ANY entrypoint carries a middleware matching /buffering/i", () => {
    const cfg = loadDynamic();
    const routers = cfg.http?.routers ?? {};
    for (const [name, router] of Object.entries(routers)) {
      const mws = router.middlewares ?? [];
      for (const mw of mws) {
        // Cannot false-negative: this is a deterministic string match
        // against the YAML source. A buffering middleware named
        // anything-with-buffering-in-it (Traefik convention is e.g.
        // 'buffering@file' or 'buffering-streaming@file') trips the
        // assertion. If the middleware's reference name doesn't include
        // 'buffering' (operator chose a custom name), the OPERATOR
        // overrode the name and accepts the responsibility.
        expect(
          /buffering/i.test(mw),
          `router '${name}' attaches middleware '${mw}' which matches /buffering/i — Traefik buffering is opt-in and must NOT be attached to any router (would silently break NDJSON/WSS streaming)`,
        ).toBe(false);
      }
    }
  });

  it("NO http.middlewares block defines a buffering entry (defense-in-depth)", () => {
    // Even if no router currently REFERENCES a buffering middleware, a
    // declared one is a footgun — a future contributor would only need
    // to add a middlewares list entry to a router to silently activate
    // it. Forbid the declaration entirely; an operator who needs it for
    // a custom upload route may override this test in their fork.
    const cfg = loadDynamic();
    const middlewares = cfg.http?.middlewares ?? {};
    for (const [name, defn] of Object.entries(middlewares)) {
      expect(
        /buffering/i.test(name),
        `middleware '${name}' defines buffering at the dynamic.yml level — Traefik buffering is opt-in and forbidden by Phase 4 D-04`,
      ).toBe(false);
      // Also catch the case where someone names a middleware something
      // innocuous but its definition contains a `buffering:` key.
      const definedAsBuffering =
        typeof defn === "object" && defn !== null && "buffering" in (defn as Record<string, unknown>);
      expect(
        definedAsBuffering,
        `middleware '${name}' defines a buffering: block — Traefik buffering is opt-in and forbidden by Phase 4 D-04`,
      ).toBe(false);
    }
  });
});
