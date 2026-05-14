// SPDX-License-Identifier: Apache-2.0
/**
 * Phase 04 Plan 05 — Traefik realtime-entrypoint split (SCALE-05, T-04-02).
 *
 * Splits the long-running WSS realtime sessions onto a dedicated `:8443`
 * entrypoint with `idleTimeout: 3600s`, while reverting `:443` to default
 * Traefik 3 timeouts (60s/0/180s). Eliminates the prior shared-3700s
 * regime that exposed every short-JSON route on `:443` to ingress-pool
 * exhaustion (T-04-02).
 *
 * The test is purely structural — it parses the YAML files and asserts
 * the target topology. No Docker required at run time; the integration
 * package's vitest config can run host-side.
 *
 * Cert reuse (D-21 / RESEARCH §2.3): both entrypoints declare
 * `http.tls: {}` which causes Traefik to load `tls.certificates` from
 * dynamic.yml — a SHARED cert list. No separate ACME, no DNS-01, no
 * entrypoint-specific cert minting.
 *
 * Trust boundary (Phase 02.19 inheritance): the new `:8443` entrypoint
 * MUST carry the same RFC 1918 `forwardedHeaders.trustedIPs` as `:443`
 * so the in-cluster contract-test runner's per-fixture XFF survives the
 * Traefik hop on the realtime path as well.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO_ROOT = process.cwd().endsWith("/tests/integration")
  ? resolve(process.cwd(), "../..")
  : process.cwd();

const TRAEFIK_YML_PATH = resolve(REPO_ROOT, "compose/traefik/traefik.yml");
const DYNAMIC_YML_PATH = resolve(REPO_ROOT, "compose/traefik/dynamic.yml");
// Phase 14 / Plan 14-03 — traefik moved from base to the ingress overlay.
// Test 6 below now inspects the overlay file directly (pure YAML — no
// `docker compose config` required, preserving the original "no docker
// daemon at run time" property of this test file).
const COMPOSE_YML_PATH = resolve(REPO_ROOT, "compose/docker-compose.ingress.yml");

interface RespondingTimeouts {
  readTimeout?: string | number;
  writeTimeout?: string | number;
  idleTimeout?: string | number;
}

interface EntryPoint {
  address?: string;
  http?: { tls?: Record<string, unknown> };
  forwardedHeaders?: { trustedIPs?: string[] };
  transport?: { respondingTimeouts?: RespondingTimeouts };
}

interface TraefikStatic {
  entryPoints?: Record<string, EntryPoint>;
}

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
  };
  tls?: {
    certificates?: Array<{ certFile?: string; keyFile?: string }>;
  };
}

interface ComposeService {
  ports?: string[];
}

interface Compose {
  services?: Record<string, ComposeService>;
}

const loadStatic = (): TraefikStatic =>
  parse(readFileSync(TRAEFIK_YML_PATH, "utf8")) as TraefikStatic;
const loadDynamic = (): DynamicConfig =>
  parse(readFileSync(DYNAMIC_YML_PATH, "utf8")) as DynamicConfig;
const loadCompose = (): Compose => parse(readFileSync(COMPOSE_YML_PATH, "utf8")) as Compose;

describe("Phase 04 Plan 05 — Traefik realtime entrypoint split", () => {
  it("Test 1: websecure-realtime entrypoint exists on :8443 with long timeouts", () => {
    const cfg = loadStatic();
    const ep = cfg.entryPoints?.["websecure-realtime"];
    expect(ep, "websecure-realtime entrypoint must be defined").toBeDefined();
    expect(ep?.address).toBe(":8443");
    expect(ep?.http?.tls).toBeDefined();
    const t = ep?.transport?.respondingTimeouts;
    expect(t).toBeDefined();
    // readTimeout 0 (no upper bound for long-lived WSS reads)
    expect(t?.readTimeout === 0 || t?.readTimeout === "0").toBe(true);
    // writeTimeout 0 (no upper bound on writes either)
    expect(t?.writeTimeout === 0 || t?.writeTimeout === "0").toBe(true);
    expect(t?.idleTimeout).toBe("3600s");
  });

  it("Test 2: websecure (:443) reverted to Traefik 3 defaults — NOT 3700s", () => {
    const cfg = loadStatic();
    const ws = cfg.entryPoints?.websecure;
    expect(ws).toBeDefined();
    expect(ws?.address).toBe(":443");
    const t = ws?.transport?.respondingTimeouts;
    // Defaults: readTimeout '60s' (or undefined to inherit), writeTimeout 0,
    // idleTimeout '180s'. The CRITICAL assertion is the absence of 3700s.
    if (t?.readTimeout !== undefined) {
      expect(t.readTimeout).toBe("60s");
    }
    expect(t?.writeTimeout === 0 || t?.writeTimeout === "0" || t?.writeTimeout === undefined).toBe(
      true,
    );
    expect(t?.idleTimeout === "180s" || t?.idleTimeout === undefined).toBe(true);
    // Hard negative: must NOT be 3700s anywhere on websecure.
    expect(t?.readTimeout).not.toBe("3700s");
    expect(t?.writeTimeout).not.toBe("3700s");
    expect(t?.idleTimeout).not.toBe("3700s");
  });

  it("Test 3: api-realtime router binds EXCLUSIVELY to websecure-realtime", () => {
    const dyn = loadDynamic();
    const router = dyn.http?.routers?.["api-realtime"];
    expect(router, "api-realtime router must exist").toBeDefined();
    expect(Array.isArray(router?.entryPoints)).toBe(true);
    expect(router?.entryPoints).toEqual(["websecure-realtime"]);
    expect(router?.entryPoints).not.toContain("websecure");
  });

  it("Test 4: no other router uses websecure-realtime", () => {
    const dyn = loadDynamic();
    const routers = dyn.http?.routers ?? {};
    for (const [name, router] of Object.entries(routers)) {
      if (name === "api-realtime") continue;
      expect(
        router.entryPoints?.includes("websecure-realtime") ?? false,
        `router '${name}' must not bind to websecure-realtime`,
      ).toBe(false);
    }
  });

  it("Test 5: streaming routers carry no buffering middleware", () => {
    const dyn = loadDynamic();
    const routers = dyn.http?.routers ?? {};
    const isStreaming = (name: string, r: Router) =>
      name === "api-realtime" || (r.rule ?? "").includes("/api/agent/stream");
    for (const [name, router] of Object.entries(routers)) {
      if (!isStreaming(name, router)) continue;
      const mws = router.middlewares ?? [];
      for (const mw of mws) {
        expect(/buffering/i.test(mw), `router '${name}' must not attach buffering middleware`).toBe(
          false,
        );
      }
    }
  });

  it("Test 6: docker-compose maps host port 8443 to traefik:8443", () => {
    const compose = loadCompose();
    const ports = compose.services?.traefik?.ports ?? [];
    expect(ports).toContain("8443:8443");
  });

  it("Test 7: cert reuse — single shared tls.certificates block, no per-entrypoint certs", () => {
    const dyn = loadDynamic();
    const certs = dyn.tls?.certificates ?? [];
    expect(certs.length).toBeGreaterThan(0);
    // No router declares its own per-entrypoint cert override (all use empty
    // tls: {} so they inherit dynamic.yml's shared certificates list).
    const routers = dyn.http?.routers ?? {};
    for (const [name, router] of Object.entries(routers)) {
      if (router.tls === undefined) continue;
      const tlsKeys = Object.keys(router.tls);
      // Allow empty {} (inherits). Reject any keys that mint a separate cert.
      for (const key of tlsKeys) {
        expect(
          ["options", "certResolver"].includes(key) === false ||
            key !== "certResolver" ||
            (router.tls as Record<string, unknown>).certResolver === undefined,
          `router '${name}' must not declare its own certResolver`,
        ).toBe(true);
      }
    }
  });

  it("Test 8: forwardedHeaders.trustedIPs preserved on :8443 (Phase 02.19 trust boundary)", () => {
    const cfg = loadStatic();
    const ep = cfg.entryPoints?.["websecure-realtime"];
    const trusted = ep?.forwardedHeaders?.trustedIPs ?? [];
    expect(trusted).toContain("10.0.0.0/8");
    expect(trusted).toContain("172.16.0.0/12");
    expect(trusted).toContain("192.168.0.0/16");
  });
});
