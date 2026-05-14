// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 02.4 / G4 — observability stack (tempo + mimir + loki + otel-collector) starts clean.
 *
 * Source-of-record commit: 059b948
 *
 * Reverts: this test goes RED if any of the following is reverted:
 *   1. Delete compose/tempo/tempo.yaml's storage.trace.backend block (or revert to default empty) →
 *      tempo crashes on boot → "tempo running" assertion fails (status != running).
 *   2. Delete compose/mimir/mimir.yaml's common.storage.backend block →
 *      mimir crashes on boot → "mimir running" assertion fails.
 *   3. Replace `otlphttp/loki:` with the deprecated `loki:` exporter in
 *      compose/otel-collector/config.yaml → otel-collector exits with
 *      "error decoding 'exporters': unknown type loki" → "otel-collector running"
 *      AND log-sentinel assertion both fail.
 *
 * Real docker compose stack-up per CONTEXT D-04. Skipped in environments
 * without docker available (e.g. some CI matrix legs).
 */

import { type ExecFileSyncOptions, execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Phase 14 / Plan 14-03 — slim-core base no longer carries the obs
// services; they live in `compose/docker-compose.observability.yml`.
// Replace the `--profile obs-only` selector with the explicit overlay
// chain so this smoke still exercises the 4-service obs core.
const COMPOSE_PROFILE = [
  "-f",
  "docker-compose.yml",
  "-f",
  "compose/docker-compose.observability.yml",
];
const SERVICES = ["tempo", "mimir", "loki", "otel-collector"];

function run(
  args: string[],
  opts: ExecFileSyncOptions = {},
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
    return {
      code: 0,
      stdout: typeof stdout === "string" ? stdout : stdout.toString(),
      stderr: "",
    };
  } catch (err: unknown) {
    const e = err as {
      status: number | null;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

function dockerAvailable(): boolean {
  return run(["version", "--format", "{{.Server.Version}}"]).code === 0;
}

const skipIfNoDocker = dockerAvailable() ? describe : describe.skip;

skipIfNoDocker("Phase 02.4 G4 — observability stack-up smoke", () => {
  beforeAll(() => {
    // Pre-clean to handle leftover state from prior runs.
    run(["compose", ...COMPOSE_PROFILE, "down", "-v", "--remove-orphans"], {
      stdio: "ignore",
    });
  }, 60_000);

  afterAll(() => {
    run(["compose", ...COMPOSE_PROFILE, "down", "-v", "--remove-orphans"], {
      stdio: "ignore",
    });
  }, 60_000);

  it("obs-only profile starts cleanly with --wait", () => {
    // Plan internal note: `obs-only` includes grafana too, but grafana's
    // first-boot installs the grafana-pyroscope-app plugin over the
    // network (~22s+) and its healthcheck has a 90s start_period — under
    // CI/test conditions it can flap "unhealthy" past `--wait`'s window
    // even though the 4 services under test (tempo/mimir/loki/otel-collector)
    // reach Healthy. The behavior under test (per plan <behavior> + SERVICES
    // array) is the four-service obs core, not grafana. Scope `up --wait`
    // to those four explicitly so this assertion measures what we claim.
    const r = run(["compose", ...COMPOSE_PROFILE, "up", "-d", "--wait", ...SERVICES]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  }, 240_000);

  it("each obs service is in 'running' state per docker compose ps --format json", () => {
    const r = run(["compose", ...COMPOSE_PROFILE, "ps", "--format", "json"]);
    expect(r.code).toBe(0);
    // ps --format json emits NDJSON (one container per line).
    const containers = r.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { Service: string; State: string });

    for (const svc of SERVICES) {
      const found = containers.find((c) => c.Service === svc);
      expect(found, `${svc} not present in ps output`).toBeDefined();
      expect(found!.State, `${svc} state was ${found!.State}`).toBe("running");
    }
  });

  it("otel-collector logs do NOT contain 'unknown type loki' regression sentinel", () => {
    const r = run(["compose", ...COMPOSE_PROFILE, "logs", "--no-color", "otel-collector"]);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toMatch(/unknown\s+type\s+loki/i);
  });

  it("tempo logs do NOT contain 'no backend configured' regression sentinel", () => {
    const r = run(["compose", ...COMPOSE_PROFILE, "logs", "--no-color", "tempo"]);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toMatch(/no\s+backend\s+configured/i);
  });

  it("mimir logs do NOT contain 'no backend configured' regression sentinel", () => {
    const r = run(["compose", ...COMPOSE_PROFILE, "logs", "--no-color", "mimir"]);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toMatch(/no\s+backend\s+configured/i);
  });

  it("teardown via 'down -v' removes all obs containers", () => {
    const downR = run(["compose", ...COMPOSE_PROFILE, "down", "-v"]);
    expect(downR.code).toBe(0);
    const psR = run(["compose", ...COMPOSE_PROFILE, "ps", "--format", "json"]);
    const lines = psR.stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(0);
  }, 60_000);
});
