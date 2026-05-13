// SPDX-License-Identifier: Apache-2.0
/**
 * Phase 02.15 — Traefik network aliases for in-cluster api.localhost resolution.
 *
 * Closes Group G (surfaced by Phase 02.14): the contract-test runner inside
 * `openwhispr_internal` can reach `api:3000` directly, but the api 302s OAuth
 * flows back to its publicly-configured `OPENWHISPR_API_URL=https://api.localhost`.
 * Inside the container, `api.localhost` resolves to 127.0.0.1 → port 443 unbound
 * → ECONNREFUSED. The fix is to make `api.localhost` (and `auth.localhost`)
 * resolve to the traefik container's IP from inside the network via Docker
 * embedded-DNS network aliases (CONTEXT D-01).
 *
 * D-02 (D-02a chosen): runner trusts the bootstrap-generated cert by mounting
 * `compose/traefik/certs/local.crt` into the runner and setting
 * `NODE_EXTRA_CA_CERTS=/certs/local.crt`. No image rebuild on cert rotation.
 *
 * D-03: runner BACKEND_URL/AUTH_URL flip to `https://api.localhost` so the
 * full Traefik+TLS+cert SAN path is exercised end-to-end. Drop
 * `AUTH_TRUSTED_ORIGINS_EXTRA: http://api:3000` from the runner block (still
 * required on the api service for the seed flow — leave it there).
 *
 * D-04 TDD: this test asserts the docker-compose.yml changes via
 * `docker compose --profile contract-test config` introspection. Mirrors
 * Phase 02.14 contract-test-runner-compose.test.ts pattern.
 *
 * No docker daemon required: `docker compose config` is a pure YAML merge.
 */

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function composeConfig(profiles: string[]): string {
  const args = ["compose"];
  for (const p of profiles) {
    args.push("--profile", p);
  }
  args.push("config");
  return execFileSync("docker", args, {
    cwd: process.cwd().endsWith("/tests/integration") ? `${process.cwd()}/../..` : process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function extractServiceBlock(merged: string, service: string): string {
  const re = new RegExp(
    `\\n {2}${service}:\\n([\\s\\S]*?)(?=\\n {2}[a-z][\\w-]*:\\n|\\n[a-z]|\\n$)`,
  );
  const m = merged.match(re);
  return m?.[1] ?? "";
}

function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version", "--format", "{{.Client.Version}}"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

const HAS_DOCKER = dockerAvailable();

describe.skipIf(!HAS_DOCKER)("Phase 02.15 — traefik network aliases + runner CA trust", () => {
  it("traefik service announces api.localhost as a network alias on openwhispr_internal", () => {
    const merged = composeConfig(["default", "contract-test"]);
    const traefik = extractServiceBlock(merged, "traefik");
    expect(traefik).toMatch(/aliases:[\s\S]*?- api\.localhost/);
  });

  it("traefik service announces auth.localhost as a network alias on openwhispr_internal", () => {
    const merged = composeConfig(["default", "contract-test"]);
    const traefik = extractServiceBlock(merged, "traefik");
    expect(traefik).toMatch(/aliases:[\s\S]*?- auth\.localhost/);
  });

  it("contract-test-runner BACKEND_URL flips to https://api.localhost (Traefik path, full TLS)", () => {
    const merged = composeConfig(["default", "contract-test"]);
    const runner = extractServiceBlock(merged, "contract-test-runner");
    expect(runner).toMatch(/BACKEND_URL:\s*https:\/\/api\.localhost/);
  });

  it("contract-test-runner AUTH_URL flips to https://api.localhost", () => {
    const merged = composeConfig(["default", "contract-test"]);
    const runner = extractServiceBlock(merged, "contract-test-runner");
    expect(runner).toMatch(/AUTH_URL:\s*https:\/\/api\.localhost/);
  });

  // Phase 02.22 — NODE_EXTRA_CA_CERTS must point at the issuing CA, not the
  // end-entity leaf. Node 24 + OpenSSL 3 reject a leaf (CA:FALSE) as a trust
  // anchor (X509Certificate.ca === false → DEPTH_ZERO_SELF_SIGNED_CERT). The
  // bootstrap-generated root-ca.crt is what Node trusts; the leaf chains up.
  it("contract-test-runner trusts bootstrap-generated root CA via NODE_EXTRA_CA_CERTS (Phase 02.22)", () => {
    const merged = composeConfig(["default", "contract-test"]);
    const runner = extractServiceBlock(merged, "contract-test-runner");
    expect(runner).toMatch(/NODE_EXTRA_CA_CERTS:\s*\/certs\/root-ca\.crt/);
  });

  it("contract-test-runner mounts root-ca.crt read-only at /certs/root-ca.crt (Phase 02.22 — no image rebuild on rotation)", () => {
    const merged = composeConfig(["default", "contract-test"]);
    const runner = extractServiceBlock(merged, "contract-test-runner");
    expect(runner).toMatch(/root-ca\.crt/);
    expect(runner).toMatch(/target:\s*\/certs\/root-ca\.crt/);
    expect(runner).toMatch(/read_only:\s*true/);
  });

  it("contract-test-runner does NOT carry AUTH_TRUSTED_ORIGINS_EXTRA (it is a seed-side concern)", () => {
    const merged = composeConfig(["default", "contract-test"]);
    const runner = extractServiceBlock(merged, "contract-test-runner");
    expect(runner).not.toMatch(/AUTH_TRUSTED_ORIGINS_EXTRA/);
  });

  it("api service still carries AUTH_TRUSTED_ORIGINS_EXTRA for the in-cluster seed POST", () => {
    const merged = composeConfig(["default", "contract-test"]);
    const api = extractServiceBlock(merged, "api");
    expect(api).toMatch(/AUTH_TRUSTED_ORIGINS_EXTRA:\s*http:\/\/api:3000/);
  });

  it("contract-test-runner does NOT set NODE_TLS_REJECT_UNAUTHORIZED (CA trust is the proper fix; CLAUDE.md no-workarounds)", () => {
    const merged = composeConfig(["default", "contract-test"]);
    const runner = extractServiceBlock(merged, "contract-test-runner");
    expect(runner).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/);
  });
});
