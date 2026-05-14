// SPDX-License-Identifier: FSL-1.1-ALv2
// Self-test helpers for the docker-compose-touching suite — Phase 2 Plan 02.
//
// `dockerAvailable` is a sync gate evaluated at module-load. We probe by
// shelling out to `docker version --format` once; if the daemon is
// unreachable, every docker self-test in this directory uses
// `describe.skipIf(!dockerAvailable)` so the suite passes cleanly on CI
// without Docker (e.g., act, tiny GHA runners) and on contributor
// laptops with the daemon stopped.
//
// `composeVersionAtLeast` parses `docker compose version --short` (e.g.
// "2.30.3-desktop.1" -> [2, 30, 3]) and compares to a [major, minor]
// requirement. CONTAINER Pitfall #6: `service_completed_successfully`
// requires Compose v2.20+.
import { spawnSync } from "node:child_process";

function probeDockerDaemon(): boolean {
  try {
    const r = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    return r.status === 0 && r.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export const dockerAvailable: boolean = probeDockerDaemon();

export function composeVersion(): [number, number, number] | null {
  try {
    const r = spawnSync("docker", ["compose", "version", "--short"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    if (r.status !== 0) return null;
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(r.stdout.trim());
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  } catch {
    return null;
  }
}

export function composeAtLeast(major: number, minor: number): boolean {
  const v = composeVersion();
  if (!v) return false;
  if (v[0] !== major) return v[0] > major;
  return v[1] >= minor;
}

export const COMPOSE_PROJECT = "openwhispr";

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function dockerCompose(
  args: string[],
  opts: { env?: Record<string, string>; timeoutMs?: number } = {},
): RunResult {
  const r = spawnSync("docker", ["compose", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...(opts.env ?? {}) },
    timeout: opts.timeoutMs ?? 240_000,
  });
  return {
    exitCode: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

/**
 * Build a fixture .env-style env map with valid (non-deny-listed) values
 * for every REQUIRED_KEY plus the connection strings. Caller can override
 * specific keys (e.g. `MASTER_KEK: "changeme"` for the deny-list test).
 */
export function fixtureSecrets(overrides: Record<string, string> = {}): Record<string, string> {
  const strong = (k: string) => `STRONG_FIXTURE_${k}_8a3f9c2d1e7b4a6f`;
  return {
    POSTGRES_OWNER_USER: "openwhispr_owner",
    POSTGRES_OWNER_PASSWORD: strong("POSTGRES_OWNER_PASSWORD"),
    POSTGRES_APP_USER: "openwhispr_app",
    POSTGRES_APP_PASSWORD: strong("POSTGRES_APP_PASSWORD"),
    POSTGRES_DB: "openwhispr",
    PGBOUNCER_ADMIN_PASSWORD: strong("PGBOUNCER_ADMIN_PASSWORD"),
    VALKEY_PASSWORD: strong("VALKEY_PASSWORD"),
    MINIO_ROOT_USER: "openwhispr",
    MINIO_ROOT_PASSWORD: strong("MINIO_ROOT_PASSWORD"),
    TRAEFIK_ADMIN_PASSWORD: strong("TRAEFIK_ADMIN_PASSWORD"),
    GRAFANA_ADMIN_PASSWORD: strong("GRAFANA_ADMIN_PASSWORD"),
    MASTER_KEK: strong("MASTER_KEK"),
    BACKUP_AGE_IDENTITY: strong("BACKUP_AGE_IDENTITY"),
    BETTER_AUTH_SECRET: strong("BETTER_AUTH_SECRET"),
    OPENWHISPR_KEY_PROVIDER: "env",
    DATABASE_URL: `postgres://openwhispr_app:${overrides.POSTGRES_APP_PASSWORD ?? strong("POSTGRES_APP_PASSWORD")}@pgbouncer:5432/openwhispr`,
    DATABASE_URL_OWNER: `postgres://openwhispr_owner:${overrides.POSTGRES_OWNER_PASSWORD ?? strong("POSTGRES_OWNER_PASSWORD")}@postgres:5432/openwhispr`,
    ...overrides,
  };
}
