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

// BUG-53-37: self-tests previously ran with the same default project name
// (`openwhispr`, derived from cwd) as the developer's running dev compose
// stack — `dockerCompose(["down", "-v"])` in `afterAll` would silently
// remove every dev container. Isolate the self-test project so test
// teardown can only touch test-owned resources.
//
// Override via `COMPOSE_PROJECT_NAME` env if a CI matrix needs a unique
// project per run; the env var natively takes precedence over `-p` in
// docker compose.
export const COMPOSE_PROJECT = "openwhispr-self-test";

// BUG-53-37 (follow-up): even with isolated project names, host ports
// 5432 (postgres), 4000 (api), and a few others are bound exclusively
// by whichever project boots first. When the developer's `openwhispr`
// dev stack is up, the self-test stack's `compose up --wait` fails on
// port allocation and the test reports a misleading "exit 1" with no
// hint that the dev stack is the actual blocker.
//
// `devStackUp()` returns true when ANY `openwhispr-*` container in the
// default `openwhispr` project is currently running. Self-tests gate
// their `describe.skipIf(...)` predicate on this so the suite skips
// cleanly with a clear log line instead of failing on port conflict.
//
// We probe by listing running container names in the `openwhispr`
// project — NOT the self-test project — so this never races with our
// own teardown.
export function devStackUp(): boolean {
  try {
    const r = spawnSync(
      "docker",
      ["compose", "-p", "openwhispr", "ps", "--quiet", "--status=running"],
      { encoding: "utf8", timeout: 5_000 },
    );
    if (r.status !== 0) return false;
    return r.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function dockerCompose(
  args: string[],
  opts: {
    env?: Record<string, string>;
    timeoutMs?: number;
    /**
     * Extra `-f <path>` overlay files prepended to the `compose` invocation.
     * Phase 14 / SLIM-03 moved several services (traefik, pgbouncer, minio,
     * observability stack, mailpit) into overlay files. Self-tests that
     * need those services MUST opt in by listing the overlay relative to
     * the repo root (e.g. `compose/docker-compose.ingress.yml`).
     */
    composeFiles?: readonly string[];
  } = {},
): RunResult {
  const fileFlags: string[] = [];
  if (opts.composeFiles && opts.composeFiles.length > 0) {
    fileFlags.push("-f", "docker-compose.yml");
    for (const f of opts.composeFiles) {
      fileFlags.push("-f", f);
    }
  }
  // BUG-53-37: always pin the project name so `down -v` in test teardown
  // cannot touch the developer's `openwhispr` dev stack. The shell env's
  // `COMPOSE_PROJECT_NAME` natively overrides `-p` if a CI matrix sets
  // it, so this is safe to apply unconditionally.
  const projectFlags = ["-p", COMPOSE_PROJECT];
  const r = spawnSync("docker", ["compose", ...projectFlags, ...fileFlags, ...args], {
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
 * Phase 33 / LOCKER-08 — `validateMasterKek` in
 * `packages/data/src/encryption/boot.ts` rejects boot when `MASTER_KEK`
 * does NOT base64url-decode to exactly 32 bytes (AES-256 key length).
 * The legacy `STRONG_FIXTURE_MASTER_KEK_8a3f9c2d1e7b4a6f` placeholder
 * decodes to 31 bytes and api crashed at boot with
 * `MasterKekInvalidLengthError`, masquerading as a healthcheck failure
 * in the docker-compose self-tests. This deterministic 43-char value
 * (`Buffer.alloc(32).fill(...).toString("base64url")`) decodes to
 * exactly 32 bytes and is therefore Phase 33 boot-valid. Hardcoded
 * (not random) so subsequent test runs reuse the same encrypted-at-rest
 * envelope and don't churn migration round-trips.
 */
const FIXTURE_MASTER_KEK_VALID_32_BYTES = "o8LhAB8-XXybutn4FzZVdJOy0fAPLk1si6rJ6AcmRWQ";

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
    MASTER_KEK: FIXTURE_MASTER_KEK_VALID_32_BYTES,
    BACKUP_AGE_IDENTITY: strong("BACKUP_AGE_IDENTITY"),
    BETTER_AUTH_SECRET: strong("BETTER_AUTH_SECRET"),
    // packages/litellm-client/src/config.ts:200 throws "LITELLM_MASTER_KEY
    // is required" when this is unset → apps/api catch at index.ts:891
    // skips litellm client construction → /api/ready returns 503 by
    // design (readiness.ts:116, docker-compose.yml:398-402) → api
    // container healthcheck fails → `docker compose up --wait api` exits
    // 1. The `litellm:` compose service also interpolates ${LITELLM_MASTER_KEY}
    // with no `:-` default (docker-compose.yml:176), so an unset value
    // makes the litellm container itself boot with an empty master key
    // and fail /health/liveliness. Both failures were silently hidden
    // for months by the broken vitest filter (commit 5aaa3bab fixed
    // the filter; this commit makes the self-test fixture honest).
    LITELLM_MASTER_KEY: strong("LITELLM_MASTER_KEY"),
    OPENWHISPR_KEY_PROVIDER: "env",
    // Phase 31 / BYOK guard rows (packages/byok-guard/src/index.ts) —
    // every overlay's required env is checked at api boot regardless of
    // NODE_ENV. The self-test stack ships the base compose without
    // overlays, so we provide every required env value here.
    // OTEL has a `disabled` sentinel that short-circuits the row without
    // bringing up the observability stack; the others require concrete
    // (but locally fake) values.
    S3_ENDPOINT: "http://minio:9000",
    S3_ACCESS_KEY: "fixture-access-key",
    S3_SECRET_KEY: "fixture-secret-key-min-16chars",
    S3_BUCKET: "fixture-bucket",
    // Phase 51 / Plan 51-16 — BYOK ingress row demands INGRESS_TLS_CERT_PATH
    // when the base URL uses the https scheme. Self-tests run against the
    // base compose without the ingress overlay (no Traefik TLS chain
    // available), so the fixture base URL stays on http — which satisfies
    // the guard without forcing a stub cert path that no file actually
    // backs. Operators wiring real TLS still go through the ingress
    // overlay + acme/cert-manager.
    INGRESS_BASE_URL: "http://api.localhost",
    OTEL_EXPORTER_OTLP_ENDPOINT: "disabled",
    SMTP_HOST: "mailpit",
    // Phase 14 / SLIM-03 — pgbouncer moved into an overlay
    // (compose/docker-compose.pgbouncer.yml); the slim-core base
    // docker-compose.yml does NOT declare a pgbouncer service. Self-tests
    // run against the base compose without overlays, so the app pool MUST
    // connect direct to `postgres:5432`. Overriding to `pgbouncer:5432`
    // earlier caused `no such service: pgbouncer` and a 168 ms early-exit
    // on every self-test that exercised `docker compose up --wait api`.
    // `?sslmode=disable` is the canonical libpq escape-hatch that
    // `buildPoolConfig()` (packages/data/src/client.ts) matches to
    // produce `ssl: false`. WITHOUT it, the post-Phase-2 SSL-by-default
    // contract turns TLS on, and the bundled fixture postgres (slim-
    // core base, no SSL cert) returns `error: The server does not
    // support SSL connections` at handshake — Phase 51.27 root cause.
    DATABASE_URL: `postgres://openwhispr_app:${overrides.POSTGRES_APP_PASSWORD ?? strong("POSTGRES_APP_PASSWORD")}@postgres:5432/openwhispr?sslmode=disable`,
    DATABASE_URL_OWNER: `postgres://openwhispr_owner:${overrides.POSTGRES_OWNER_PASSWORD ?? strong("POSTGRES_OWNER_PASSWORD")}@postgres:5432/openwhispr?sslmode=disable`,
    ...overrides,
  };
}
