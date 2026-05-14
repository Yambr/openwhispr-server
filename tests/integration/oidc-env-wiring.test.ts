// SPDX-License-Identifier: Apache-2.0
/**
 * Phase 02.13 — OIDC env provisioning for contract-test fixture-idp.
 *
 * Closes Group B cascade tail: 5 OAuth contract tests (`oauth-redirect.test.ts`)
 * fail HTTP 503 because `apps/api/src/auth.ts:81-86` silently disables the
 * `genericOAuth` Better Auth plugin when `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` /
 * `OIDC_CLIENT_SECRET` are unset, but the contract-test profile already runs
 * `fixture-idp` (`docker-compose.yml` service `fixture-idp`, port 9000) which
 * accepts ANY client_id / client_secret (`tests/fixtures/idp/server.mjs:84-105`
 * — no validation in the /token endpoint).
 *
 * D-01: provision OIDC env defaults on the api service environment block,
 *       pointing at fixture-idp DNS. Default-profile boot is unaffected
 *       because Better Auth's genericOAuth uses lazy discovery (only fetches
 *       /.well-known/openid-configuration when an OAuth flow is attempted).
 *
 * D-02: fixture-idp does NOT validate client_id / client_secret. Any value
 *       resolves; we use `conformance-test-client` / `conformance-test-secret-do-not-use-in-prod`
 *       as documentation-grade defaults so the values appear intentional.
 *
 * Reverse-patch evidence: revert the OIDC_* lines in docker-compose.yml api
 * environment → `docker compose config` no longer shows them → assertions
 * below fail RED.
 *
 * No docker daemon required: this test invokes only `docker compose config`
 * which is a pure YAML merge and does not start containers.
 */

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Phase 14 / Plan 14-03 — slim-core inverted the base; fixture-idp is now
// in the contract-test overlay. OIDC env defaults on api STAY in slim-core
// base (lazy discovery is safe — see test 4 below), so for the
// default-only assertion we read bare slim-core; for contract-test
// assertions we merge base + contract-test.
const BASE_FILES = ["-f", "docker-compose.yml"];
const CONTRACT_FILES = [...BASE_FILES, "-f", "compose/docker-compose.contract-test.yml"];

function composeConfig(profiles: string[]): string {
  const files = profiles.includes("contract-test") ? CONTRACT_FILES : BASE_FILES;
  return execFileSync("docker", ["compose", ...files, "config"], {
    cwd: process.cwd().endsWith("/tests/integration") ? `${process.cwd()}/../..` : process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
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

describe.skipIf(!HAS_DOCKER)(
  "Phase 02.13 — OIDC env wired into api service",
  { timeout: 30_000 },
  () => {
    // The `api` service is in `profiles: [default]`; `fixture-idp` is in
    // `profiles: [contract-test]`. Contract-test E2E activates BOTH (Makefile
    // contract-test target). We assert against the merged config of both.
    it("api service environment declares OIDC_ISSUER_URL pointing at fixture-idp by default", () => {
      const merged = composeConfig(["default", "contract-test"]);
      expect(merged).toMatch(/OIDC_ISSUER_URL:\s*http:\/\/fixture-idp:9000/);
    });

    it("api service environment declares OIDC_CLIENT_ID with a non-empty default", () => {
      const merged = composeConfig(["default", "contract-test"]);
      expect(merged).toMatch(/OIDC_CLIENT_ID:\s*conformance-test-client/);
    });

    it("api service environment declares OIDC_CLIENT_SECRET with a non-empty default", () => {
      const merged = composeConfig(["default", "contract-test"]);
      expect(merged).toMatch(/OIDC_CLIENT_SECRET:\s*conformance-test-secret-do-not-use-in-prod/);
    });

    it("default profile alone still ships OIDC env (lazy-discovery is safe)", () => {
      // D-01: keeping the env on the api service unconditionally is safe
      // because Better Auth genericOAuth fetches the discovery doc lazily on
      // first OAuth attempt — default-profile users never trigger that path
      // unless they intentionally call /api/desktop-signin/oidc. The
      // fixture-idp DNS name resolves to NXDOMAIN outside the contract-test
      // network, but no resolution is attempted at boot.
      const merged = composeConfig(["default"]);
      expect(merged).toMatch(/OIDC_ISSUER_URL:\s*http:\/\/fixture-idp:9000/);
    });
  },
);
