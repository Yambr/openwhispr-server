// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 14 / Plan 14-01 — slim-core base conformance.
 *
 * Static YAML conformance test: bare `docker-compose.yml` must declare
 * exactly the 6 long-running services (api, web, worker, postgres, valkey,
 * litellm) plus the `migrate` init container. No `profiles:` keys on any
 * surviving service. No `depends_on` edges into overlay-resident services
 * (mailpit, otel-collector, pgbouncer). Host ports published on api/web so
 * the slim path works without Traefik. `OTEL_EXPORTER_OTLP_ENDPOINT` has
 * NO `:-http://otel-collector:4317` fallback (unset propagates → loud-fail
 * in plan 14-04).
 *
 * No docker daemon required: this is a pure YAML reader (RESEARCH §G.3).
 * Task 1 (RED): assertions FAIL against the current 19-service base.
 * Task 2 (GREEN): edits docker-compose.yml until all assertions pass.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const composePath = resolve(__dirname, "../../docker-compose.yml");

interface ComposeService {
  profiles?: unknown;
  ports?: Array<string | { published?: number | string; target?: number | string }>;
  depends_on?: string[] | Record<string, { condition?: string } | undefined>;
  environment?: Record<string, string | number | boolean | null | undefined>;
}

interface ComposeDoc {
  services: Record<string, ComposeService>;
}

const SLIM_CORE = new Set(["api", "web", "worker", "postgres", "valkey", "litellm", "migrate"]);

function loadCompose(): ComposeDoc {
  const text = readFileSync(composePath, "utf8");
  return parse(text) as ComposeDoc;
}

function dependsOnKeys(svc: ComposeService): string[] {
  const d = svc.depends_on;
  if (!d) return [];
  if (Array.isArray(d)) return [...d];
  return Object.keys(d);
}

function hasPort(svc: ComposeService, published: number, target: number): boolean {
  const ports = svc.ports;
  if (!ports) return false;
  for (const p of ports) {
    if (typeof p === "string") {
      // accept `"4000:3000"` or `"127.0.0.1:4000:3000"` (host-bind form)
      const parts = p.split(":");
      const last = parts[parts.length - 1];
      const second = parts[parts.length - 2];
      if (String(second) === String(published) && String(last) === String(target)) {
        return true;
      }
    } else if (typeof p === "object" && p !== null) {
      if (String(p.published) === String(published) && String(p.target) === String(target)) {
        return true;
      }
    }
  }
  return false;
}

describe("Phase 14 / Plan 14-01 — slim-core base conformance", () => {
  const doc = loadCompose();
  const services = doc.services ?? {};

  // Phase 58 / AUDIT-HARD-04 — the slim base later gained a `profiles:
  // [dev]`-gated mailpit (a dev SMTP trap). A profile-gated service does
  // NOT start on a bare `docker compose up`, so the slim default set is
  // still exactly SLIM_CORE. The original "keys equal exactly SLIM_CORE"
  // assertion predated any dev-profiled service; the invariant we actually
  // want: every SLIM_CORE service is present and un-profiled (in the slim
  // default set), and any EXTRA service is profile-gated out of it.
  it("Test 1: slim-core services are all present and un-profiled; extras are profile-gated", () => {
    const keys = new Set(Object.keys(services));
    for (const core of SLIM_CORE) {
      expect(keys.has(core), `slim-core service "${core}" must exist`).toBe(true);
      expect(
        services[core]?.profiles,
        `slim-core service "${core}" must NOT declare profiles: — it belongs to the slim default set`,
      ).toBeUndefined();
    }
    for (const name of keys) {
      if (SLIM_CORE.has(name)) continue;
      expect(
        services[name]?.profiles,
        `extra service "${name}" must declare profiles: to stay out of the slim default set`,
      ).not.toBeUndefined();
    }
  });

  // Phase 58 / AUDIT-HARD-04 — mailpit (a dev SMTP trap) was un-gated and
  // started in the production default stack. The fix added
  // `profiles: [dev]` to mailpit. A `profiles:`-gated dev service is the
  // CORRECT slim-base posture: it does NOT start on a bare `docker compose
  // up`. The original assertion ("no service may declare profiles:") was
  // written before any dev-profiled service existed and is wrong for a
  // profile-gated mailpit. The invariant we actually want: every service
  // that DOES declare `profiles:` must be gated to a non-default profile
  // (so it stays out of the slim default set).
  it("Test 2: any service declaring `profiles:` is gated to a non-default profile", () => {
    for (const [name, svc] of Object.entries(services)) {
      if (svc.profiles === undefined) continue;
      const profiles = Array.isArray(svc.profiles) ? svc.profiles : [svc.profiles];
      expect(profiles.length > 0, `service ${name} declares an empty profiles: list`).toBe(true);
      expect(
        profiles.includes("default"),
        `service ${name} must NOT be in the "default" profile — profiles: gating exists to keep it OUT of the slim base`,
      ).toBe(false);
    }
  });

  it("Test 3: api publishes host port 4000 -> container 3000", () => {
    const api = services.api;
    expect(api, "api service must exist").toBeTruthy();
    expect(hasPort(api, 4000, 3000)).toBe(true);
  });

  it("Test 4: web publishes host port 3000 -> container 3000", () => {
    const web = services.web;
    expect(web, "web service must exist").toBeTruthy();
    expect(hasPort(web, 3000, 3000)).toBe(true);
  });

  it("Test 5: api.depends_on subset of {migrate, litellm, valkey}", () => {
    const keys = new Set(dependsOnKeys(services.api));
    const allowed = new Set(["migrate", "litellm", "valkey"]);
    for (const k of keys) {
      expect(allowed.has(k), `api.depends_on must not include "${k}"`).toBe(true);
    }
  });

  it("Test 6: worker.depends_on subset of {litellm, valkey, migrate}", () => {
    const keys = new Set(dependsOnKeys(services.worker));
    const allowed = new Set(["litellm", "valkey", "migrate"]);
    for (const k of keys) {
      expect(allowed.has(k), `worker.depends_on must not include "${k}"`).toBe(true);
    }
  });

  it("Test 7: migrate.depends_on subset of {postgres}", () => {
    const keys = new Set(dependsOnKeys(services.migrate));
    const allowed = new Set(["postgres"]);
    for (const k of keys) {
      expect(allowed.has(k), `migrate.depends_on must not include "${k}"`).toBe(true);
    }
  });

  it("Test 8: api OTEL_EXPORTER_OTLP_ENDPOINT has no otel-collector fallback", () => {
    const env = services.api.environment ?? {};
    const v = env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (v === undefined) return; // absent is allowed
    expect(String(v)).not.toContain("otel-collector");
    expect(String(v)).not.toContain(":-http://");
  });

  it("Test 9: worker OTEL_EXPORTER_OTLP_ENDPOINT has no otel-collector fallback", () => {
    const env = services.worker.environment ?? {};
    const v = env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (v === undefined) return;
    expect(String(v)).not.toContain("otel-collector");
    expect(String(v)).not.toContain(":-http://");
  });

  it("Test 10: api.depends_on.migrate.condition === service_completed_successfully", () => {
    const d = services.api.depends_on;
    expect(d, "api.depends_on must be a map, not a list").not.toBeUndefined();
    expect(Array.isArray(d)).toBe(false);
    const map = d as Record<string, { condition?: string }>;
    expect(map.migrate, "api must depends_on migrate").toBeTruthy();
    expect(map.migrate?.condition).toBe("service_completed_successfully");
  });
});
