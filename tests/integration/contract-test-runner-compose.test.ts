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

function composeServices(profiles: string[]): string[] {
  const args = ["compose"];
  for (const p of profiles) {
    args.push("--profile", p);
  }
  args.push("config", "--services");
  const out = execFileSync("docker", args, {
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

describe.skipIf(!HAS_DOCKER)("Phase 02.14 — contract-test-runner in compose network", () => {
  it("contract-test profile registers the contract-test-runner service", () => {
    const services = composeServices(["default", "contract-test"]);
    expect(services).toContain("contract-test-runner");
  });

  it("contract-test-runner is NOT present in the default profile", () => {
    const services = composeServices(["default"]);
    expect(services).not.toContain("contract-test-runner");
  });

  it("contract-test-runner BACKEND_URL points at the in-cluster api:3000 (not Traefik)", () => {
    const merged = composeConfig(["default", "contract-test"]);
    expect(merged).toMatch(/BACKEND_URL:\s*http:\/\/api:3000/);
  });

  it("contract-test-runner AUTH_URL points at the in-cluster api:3000", () => {
    const merged = composeConfig(["default", "contract-test"]);
    expect(merged).toMatch(/AUTH_URL:\s*http:\/\/api:3000/);
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
});
