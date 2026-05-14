// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 02.19 — Traefik forwardedHeaders.trustedIPs on websecure entrypoint.
 *
 * Closes Group F end-to-end (cascade tail from Phase 02.18 D-DISC):
 *
 *   Phase 02.18 fixed the production-side defect — Better Auth's built-in
 *   rate-limiter now resolves real client IP from X-Forwarded-For
 *   (apps/api/src/auth.ts: advanced.ipAddress.ipAddressHeaders=["x-forwarded-for"]).
 *   But the contract-test runner's per-fixture XFF (10.x.y.z) does NOT
 *   survive the Traefik hop because Traefik's default `forwardedHeaders.trustedIPs`
 *   is unset → trust nothing → client XFF is overwritten with the immediate
 *   socket IP. Result: all parallel signInFixture calls collapse onto the
 *   test-runner's single socket IP and trip Better Auth's 3-per-10s sign-in
 *   limit (Group F).
 *
 * D-01 fix: configure entryPoints.websecure.forwardedHeaders.trustedIPs to
 * the RFC 1918 private-network CIDRs that cover the openwhispr_internal
 * docker bridge subnet. This trusts XFF only from in-cluster clients;
 * external clients on real internet IPs are NOT trusted, so Traefik
 * continues to overwrite their XFF with their real socket IP. Production
 * abuse-vector remains closed.
 *
 * D-03 production safety: chosen CIDRs are STRICTLY RFC 1918:
 *   - 10.0.0.0/8        — RFC 1918 Class A private
 *   - 172.16.0.0/12     — RFC 1918 Class B private (Docker default bridge pool)
 *   - 192.168.0.0/16    — RFC 1918 Class C private
 * No public IP ranges are trusted. No CGNAT (100.64/10) trusted. No loopback.
 *
 * Verified empirically: `docker network create --driver bridge` allocates from
 * 172.x.0.0/16 within 172.16.0.0/12 (probed 172.28.0.0/16 on this host).
 *
 * D-02 TDD: this test parses compose/traefik/traefik.yml and asserts the
 * forwardedHeaders.trustedIPs block on the websecure entrypoint contains the
 * three RFC 1918 CIDRs and ONLY private ranges.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const TRAEFIK_YML_PATH = resolve(
  process.cwd().endsWith("/tests/integration") ? `${process.cwd()}/../..` : process.cwd(),
  "compose/traefik/traefik.yml",
);

interface TraefikStaticConfig {
  entryPoints?: Record<
    string,
    {
      address?: string;
      forwardedHeaders?: { trustedIPs?: string[] };
    }
  >;
}

function loadConfig(): TraefikStaticConfig {
  const raw = readFileSync(TRAEFIK_YML_PATH, "utf8");
  return parse(raw) as TraefikStaticConfig;
}

describe("Phase 02.19 — Traefik websecure forwardedHeaders.trustedIPs", () => {
  it("websecure entrypoint defines forwardedHeaders.trustedIPs", () => {
    const cfg = loadConfig();
    const websecure = cfg.entryPoints?.websecure;
    expect(websecure).toBeDefined();
    expect(websecure?.forwardedHeaders).toBeDefined();
    expect(websecure?.forwardedHeaders?.trustedIPs).toBeDefined();
    expect(Array.isArray(websecure?.forwardedHeaders?.trustedIPs)).toBe(true);
  });

  it("trustedIPs covers RFC 1918 Class A (10.0.0.0/8)", () => {
    const cfg = loadConfig();
    const trusted = cfg.entryPoints?.websecure?.forwardedHeaders?.trustedIPs ?? [];
    expect(trusted).toContain("10.0.0.0/8");
  });

  it("trustedIPs covers RFC 1918 Class B (172.16.0.0/12 — Docker default bridge pool)", () => {
    const cfg = loadConfig();
    const trusted = cfg.entryPoints?.websecure?.forwardedHeaders?.trustedIPs ?? [];
    expect(trusted).toContain("172.16.0.0/12");
  });

  it("trustedIPs covers RFC 1918 Class C (192.168.0.0/16)", () => {
    const cfg = loadConfig();
    const trusted = cfg.entryPoints?.websecure?.forwardedHeaders?.trustedIPs ?? [];
    expect(trusted).toContain("192.168.0.0/16");
  });

  it("trustedIPs contains ONLY RFC 1918 private ranges — no public, no CGNAT, no loopback (D-03 production safety)", () => {
    const cfg = loadConfig();
    const trusted = cfg.entryPoints?.websecure?.forwardedHeaders?.trustedIPs ?? [];
    const allowedPrivateCIDRs = new Set(["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]);
    for (const cidr of trusted) {
      expect(
        allowedPrivateCIDRs.has(cidr),
        `trustedIPs entry "${cidr}" is NOT in the RFC 1918 private allowlist — would trust external XFF (production abuse vector)`,
      ).toBe(true);
    }
    // Sanity: no CGNAT/loopback/0.0.0.0 leakage.
    expect(trusted).not.toContain("0.0.0.0/0");
    expect(trusted).not.toContain("127.0.0.1/32");
    expect(trusted).not.toContain("100.64.0.0/10");
  });

  it("web (port 80) entrypoint does NOT need forwardedHeaders (only redirects to websecure — D-04)", () => {
    const cfg = loadConfig();
    const web = cfg.entryPoints?.web;
    // Acceptable: forwardedHeaders absent OR present (we don't mandate either way for the redirect-only entrypoint).
    // Hard rule: if it IS set, it must also be RFC 1918 only. We assert the safer default (absent).
    expect(web?.forwardedHeaders).toBeUndefined();
  });
});
