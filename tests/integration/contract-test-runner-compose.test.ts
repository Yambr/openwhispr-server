// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 02.14 — contract-test runner inside the openwhispr_internal docker network.
 *
 * Closes Group E (surfaced by Phase 02.13): the host-side contract-test runner
 * cannot resolve docker-internal DNS (e.g. `fixture-idp`), so OAuth-redirect
 * tests fail with `getaddrinfo ENOTFOUND fixture-idp` after the api correctly
 * 302s to `http://fixture-idp:9000/authorize?...`. Mirrors the Phase 02.3
 * `seed` service pattern: a one-shot compose service in the contract-test
 * profile, attached to `openwhispr_internal`, BACKEND_URL/AUTH_URL pointing
 * at the in-cluster `api:3000` endpoint (no Traefik/TLS hop).
 *
 * D-01: NODE_TLS_REJECT_UNAUTHORIZED is intentionally NOT set on the runner
 *       — URLs are http:// so Node never validates TLS. Setting it would be
 *       a CLAUDE.md-prohibited workaround for a problem that doesn't exist.
 *
 * D-03: TDD — this test asserts the docker-compose.yml service block is
 *       present AND wired with the right BACKEND_URL/AUTH_URL via
 *       `docker compose --profile contract-test config` introspection.
 *       Mirrors Phase 02.13 `oidc-env-wiring.test.ts` execFileSync pattern.
 *
 * No docker daemon required: `docker compose config` is a pure YAML merge
 * (no containers started).
 */

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Phase 14 / Plan 14-03 — slim-core inverted the base. fixture-idp +
// contract-test-runner are now in `compose/docker-compose.contract-test.yml`.
// Tests merge base + ingress (for Traefik) + contract-test in place of the
// old `--profile contract-test` selector.
const BASE_FILES = ["-f", "docker-compose.yml"];
const CONTRACT_FILES = [
  ...BASE_FILES,
  "-f",
  "compose/docker-compose.ingress.yml",
  "-f",
  "compose/docker-compose.contract-test.yml",
];

function composeConfig(profiles: string[]): string {
  // Phase 14: `profiles` argument retained for call-site compatibility but
  // ignored — overlay-merge selects services explicitly. When the input
  // includes `contract-test` we merge the contract-test overlay; otherwise
  // (default-only) we stay on bare slim-core.
  const files = profiles.includes("contract-test") ? CONTRACT_FILES : BASE_FILES;
  return execFileSync("docker", ["compose", ...files, "config"], {
    cwd: process.cwd().endsWith("/tests/integration") ? `${process.cwd()}/../..` : process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function composeServices(profiles: string[]): string[] {
  const files = profiles.includes("contract-test") ? CONTRACT_FILES : BASE_FILES;
  const out = execFileSync("docker", ["compose", ...files, "config", "--services"], {
    cwd: process.cwd().endsWith("/tests/integration") ? `${process.cwd()}/../..` : process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
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
  "Phase 02.14 — contract-test-runner in compose network",
  { timeout: 30_000 },
  () => {
    it("contract-test profile registers the contract-test-runner service", () => {
      const services = composeServices(["default", "contract-test"]);
      expect(services).toContain("contract-test-runner");
    });

    it("contract-test-runner is NOT present in the default profile", () => {
      const services = composeServices(["default"]);
      expect(services).not.toContain("contract-test-runner");
    });

    // Phase 02.15 update: Group G closure flipped BACKEND_URL/AUTH_URL from
    // the in-cluster `http://api:3000` shortcut to the canonical-public
    // `https://api.localhost` URL. Docker network aliases (traefik service
    // block) make `api.localhost` resolve in-cluster, and the runner trusts
    // the bootstrap-generated cert via NODE_EXTRA_CA_CERTS. The Phase 02.14
    // contract is preserved by the network-residence + DNS-view assertions
    // (above); URL is now the public one because OAuth-redirect tests follow
    // 302s the api emits to its publicly-configured callback URL — those
    // URLs MUST match what the api advertises, otherwise the redirect
    // chain ECONNREFUSEs (Group G defect this update closed).
    it("contract-test-runner BACKEND_URL points at the canonical-public https://api.localhost (Phase 02.15 — network alias + CA trust)", () => {
      const merged = composeConfig(["default", "contract-test"]);
      expect(merged).toMatch(/BACKEND_URL:\s*https:\/\/api\.localhost/);
    });

    it("contract-test-runner AUTH_URL points at the canonical-public https://api.localhost (Phase 02.15)", () => {
      const merged = composeConfig(["default", "contract-test"]);
      expect(merged).toMatch(/AUTH_URL:\s*https:\/\/api\.localhost/);
    });

    it("contract-test-runner does NOT set NODE_TLS_REJECT_UNAUTHORIZED (http only — no TLS to validate)", () => {
      // CLAUDE.md hard rule: refuse `--legacy` / suppressed-warning workarounds.
      // BACKEND_URL/AUTH_URL are http://, so Node fetch() never engages TLS.
      // Setting NODE_TLS_REJECT_UNAUTHORIZED=0 would be a workaround for a
      // problem that does not exist on internal http traffic.
      const merged = composeConfig(["default", "contract-test"]);
      // Find the contract-test-runner service block and assert no
      // NODE_TLS_REJECT_UNAUTHORIZED inside it.
      const runnerMatch = merged.match(
        /\n {2}contract-test-runner:\n([\s\S]*?)(?=\n {2}[a-z][\w-]*:\n|\n[a-z]|\n$)/,
      );
      expect(runnerMatch).not.toBeNull();
      const block = runnerMatch?.[1] ?? "";
      expect(block).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/);
    });
  },
);
