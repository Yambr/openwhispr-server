// tests/e2e/helpers/phase6-compose.ts
//
// Phase 6 Wave 3 — shared docker-compose harness for the 06-12a/b/c/d
// verification gate tests. Plan 06-12a is the first consumer; 12b
// (rate-limit + scale + ssrf) and 12c (otel + log-scrub + recon)
// re-import this module so the boot/teardown surface is consistent
// across the whole gate.
//
// Design:
//   - testcontainers v11 `DockerComposeEnvironment` boots the project
//     root `docker-compose.yml` with the `default` profile, the
//     hermetic mock-LiteLLM config (litellm_config.contract.yaml), and
//     MOCK_DIARIZATION=true. This avoids requiring provider keys
//     (no GROQ_API_KEY / OPENROUTER_API_KEY / PYANNOTE_API_KEY) so
//     the gate runs from a fresh clone with only `.env` + `make build`.
//   - Wait strategy: poll the api `/livez` route through the HOST
//     network (mapped Traefik :443) rather than the testcontainers
//     default per-container TCP wait. Probes are the canonical
//     readiness signal (Plan 06-04) and `/livez` is auth-free.
//   - Seed: run via `docker compose run --rm seed` (one-shot) after
//     stack-up because the conformance fixture user
//     (fixture@conformance.test) is what audit-log-write.test.ts
//     signs in as.
//   - Teardown: `down({ removeVolumes: true, timeout: 30_000 })` so
//     each suite starts from a clean Postgres state (the rate-limit
//     buckets in Valkey and any half-written audit rows must NOT
//     leak across suites).
//
// Why hybrid (testcontainers + shell `docker`):
//   - testcontainers v11 dropped `getContainer().pause()/unpause()`;
//     pause/unpause is exposed only via the Docker daemon directly.
//     Plan 06-12a's probes test needs `docker pause postgres` to
//     simulate a PG outage. We shell out via `node:child_process`.
//   - testcontainers `DockerComposeEnvironment` does not expose a
//     `run --rm <service>` analogue. Seed is invoked via the same
//     shell channel.
//   - Postgres exposes NO host port (security — only on the
//     openwhispr_internal docker network). We hit it via
//     `getContainer('postgres-1').exec(['psql', …])` rather than
//     opening a host port.
//
// Re-entrancy: each test file owns its compose stack lifecycle. Plans
// 06-12a/b/c run their tests sequentially via the Makefile target so
// only one stack is up at a time. The default testcontainers
// per-run UUID project name guarantees no cross-talk if a future
// CI matrix runs them in parallel shards.

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DockerComposeEnvironment,
  type StartedDockerComposeEnvironment,
  type StartedTestContainer,
} from "testcontainers";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "../../..");

/**
 * Public base URL — Traefik over TLS on the dev hostname (api.localhost).
 * RFC 6761 reserves *.localhost to loopback so this resolves on every
 * developer laptop and CI runner without /etc/hosts edits.
 */
export const BACKEND_URL = "https://api.localhost";

/**
 * Hermetic-mode env injected into the compose process — picked up by
 * docker-compose interpolation (`${LITELLM_CONFIG_FILE:-...}`). This
 * mirrors the canonical hermetic profile used by `make e2e-hermetic`
 * so any wire-shape covered by Phase 6 tests is exercised without
 * provider keys.
 */
export const HERMETIC_ENV: Record<string, string> = {
  LITELLM_CONFIG_FILE: "litellm_config.contract.yaml",
  OPENWHISPR_TEST_ROUTES: "true",
  MOCK_DIARIZATION: "true",
};

const COMPOSE_FILE = "docker-compose.yml";

/**
 * Default boot timeout. The api healthcheck depends on PG + Valkey +
 * PgBouncer + migrations all going green; cold-pull / cold-build on
 * a laptop runs ~120-180s, CI cold runners up to 240s. Callers MAY
 * extend via `phase6BringStackUp({ timeoutMs: …})`.
 */
export const DEFAULT_BOOT_TIMEOUT_MS = 240_000;

export interface Phase6Stack {
  env: StartedDockerComposeEnvironment;
  /**
   * The actual compose project name testcontainers assigned (UUID
   * suffix). Required for shell-level `docker compose` calls (seed
   * one-shot, pause/unpause) so they target the same instance the
   * test booted.
   */
  projectName: string;
  /** Resolve the `postgres` service container — handles -1 suffix. */
  postgres: StartedTestContainer;
  /** Resolve the `valkey` service container. */
  valkey: StartedTestContainer;
  /** Resolve the `api` service container. */
  api: StartedTestContainer;
  /** Tear the stack down + drop named volumes. */
  down: () => Promise<void>;
}

/**
 * Resolve a compose service to its StartedGenericContainer. testcontainers
 * v11 names containers `<service>-1` for the first replica (no scale).
 * We probe a small list of plausible names so the helper is robust to
 * docker-compose naming conventions (`_1` vs `-1`) and scale.
 */
function getServiceContainer(
  env: StartedDockerComposeEnvironment,
  service: string,
): StartedTestContainer {
  const candidates = [`${service}-1`, service, `${service}_1`];
  let lastErr: unknown;
  for (const name of candidates) {
    try {
      return env.getContainer(name);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `phase6-compose: cannot resolve service '${service}' — tried ${candidates.join(", ")}: ${String(lastErr)}`,
  );
}

/** Run a host command; resolve with exit code (does NOT throw). */
export function runCmd(
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; quiet?: boolean } = {},
): Promise<number> {
  return new Promise((res) => {
    const child = spawn(cmd, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...HERMETIC_ENV, ...opts.env },
      stdio: opts.quiet ? "ignore" : "inherit",
    });
    child.on("close", (code) => res(code ?? -1));
    child.on("error", () => res(-1));
  });
}

/**
 * Poll an URL until it responds with the expected status, or the
 * deadline expires. Returns the last response on success. Throws on
 * deadline with the last error/body in the message for triage.
 */
export async function pollUrl(
  url: string,
  opts: {
    expectStatus?: number | ((s: number) => boolean);
    deadlineMs: number;
    intervalMs?: number;
    init?: RequestInit;
  },
): Promise<Response> {
  const started = Date.now();
  const intervalMs = opts.intervalMs ?? 500;
  const checkStatus =
    typeof opts.expectStatus === "function"
      ? opts.expectStatus
      : (s: number) => s === (opts.expectStatus ?? 200);
  let lastErr: unknown;
  let lastBody = "";
  let lastStatus = -1;
  while (Date.now() - started < opts.deadlineMs) {
    try {
      const res = await fetch(url, {
        ...opts.init,
        signal: AbortSignal.timeout(Math.min(3000, opts.deadlineMs)),
      });
      lastStatus = res.status;
      if (checkStatus(res.status)) return res;
      lastBody = (
        await res
          .clone()
          .text()
          .catch(() => "")
      ).slice(0, 300);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `pollUrl: ${url} never matched within ${opts.deadlineMs}ms — last status=${lastStatus} body=${lastBody} err=${String(lastErr)}`,
  );
}

/**
 * Boot the default-profile compose stack via testcontainers. Returns
 * a handle with the started env + named-service shortcuts + a teardown
 * thunk.
 */
export async function phase6BringStackUp(
  opts: {
    /** Override the 240s default boot timeout. */
    timeoutMs?: number;
    /** Seed conformance fixtures (sign-in test relies on it). Default true. */
    seed?: boolean;
    /**
     * Override the compose project name. Defaults to `openwhispr` to
     * reuse pre-built `openwhispr-{api,worker,migrate}:latest` images.
     */
    projectName?: string;
  } = {},
): Promise<Phase6Stack> {
  // Self-signed Traefik dev cert — scope to this process only.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  const timeoutMs = opts.timeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
  const seed = opts.seed ?? true;

  // Reuse the default `openwhispr` project name so the api/worker/migrate
  // services (which use compose `build:` without an explicit `image:`) pick
  // up the pre-built `openwhispr-api:latest` / `openwhispr-worker:latest` /
  // `openwhispr-migrate:latest` tags rather than re-building from scratch
  // every suite. With testcontainers' default UUID project name compose
  // looks for `<uuid>-api:latest` which never exists → forces a rebuild
  // that adds ~5-15min per run on a cold cache. The contributor workflow
  // is `make build` once, then `make e2e-test-phase6` repeatedly; that
  // requires project-name stability.
  const projectName = opts.projectName ?? "openwhispr";
  // NOTE: `withNoRecreate()` in testcontainers v11 has a side effect of
  // resetting projectName to "testcontainers-node", which defeats our
  // image-cache reuse. We drop it and accept the per-suite container
  // recreation cost (~10-20s extra per boot).
  const env = await new DockerComposeEnvironment(REPO_ROOT, COMPOSE_FILE)
    .withProjectName(projectName)
    .withProfiles("default")
    .withEnvironment(HERMETIC_ENV)
    // --no-build: refuse to rebuild on `up`. The contributor / CI must
    // pre-build images (`docker compose build` or `make build`). Without
    // this flag, compose v2 auto-builds any service with a `build:`
    // directive whose tag isn't perfectly cached, which (a) takes
    // 10-15min on a cold layer cache, (b) is non-deterministic if the
    // workspace is dirty, and (c) re-runs `pnpm --filter @openwhispr/api
    // build` inside the image — that step recently broke for unrelated
    // reasons (typecheck failures in pre-existing test files). The e2e
    // gate's job is to test the image, not to test the image build.
    // `--no-build` refuses to rebuild on `up`; `--pull never` refuses to
    // pull from a registry. Together they pin the stack to whatever
    // images already exist locally (built via `docker compose build`
    // or pulled out-of-band). Without `--pull never`, compose tries to
    // pull the locally-tagged `openwhispr-api` from docker.io after
    // `--no-build` rules out a rebuild — which fails immediately on
    // offline / firewalled CI runners.
    .withClientOptions({ commandOptions: ["--no-build", "--pull", "never"] })
    // Don't try Wait.forHttp on every container — Traefik / api are
    // on an internal network with no host port; the project's own
    // docker HEALTHCHECK directives are the gate. testcontainers
    // honors `condition: service_healthy` on depends_on by default
    // when no explicit wait strategy is supplied for a container.
    .withStartupTimeout(timeoutMs)
    .up();

  // projectName is captured above before the .up() call so seed/pause
  // commands target the same compose namespace.

  const postgres = getServiceContainer(env, "postgres");
  const valkey = getServiceContainer(env, "valkey");
  const api = getServiceContainer(env, "api");

  // Belt-and-suspenders: poll Traefik → /livez until 200 so the api
  // is actually serving (the docker HEALTHCHECK guarantees the
  // container reports healthy but Traefik routing may still settle).
  await pollUrl(`${BACKEND_URL}/livez`, {
    expectStatus: 200,
    deadlineMs: 60_000,
    intervalMs: 1000,
  });

  if (seed) {
    // Run conformance seed via `docker compose run --rm seed`.
    // testcontainers doesn't expose a `run` analogue so we invoke
    // the compose CLI directly, targeting the SAME project name
    // testcontainers created so the seed container lands on the
    // same network and sees the same postgres/api.
    const code = await runCmd(
      "docker",
      [
        "compose",
        "-p",
        projectName,
        "--profile",
        "default",
        "--profile",
        "contract-test",
        "run",
        "--rm",
        "seed",
      ],
      { env: { ...HERMETIC_ENV } },
    );
    if (code !== 0) {
      // Tear down before throwing so a failed seed doesn't leak the stack.
      await env.down({ removeVolumes: true, timeout: 30_000 }).catch(() => {});
      throw new Error(`phase6-compose: seed failed with exit code ${code}`);
    }
  }

  const down = async (): Promise<void> => {
    await env.down({ removeVolumes: true, timeout: 30_000 });
  };

  return { env, projectName, postgres, valkey, api, down };
}

/**
 * Pause a service container via the Docker daemon. testcontainers v11
 * does not expose `.pause()` on StartedGenericContainer; we shell out
 * via the container id. This is exactly the call `docker pause` makes.
 */
export async function pauseContainer(container: StartedTestContainer): Promise<void> {
  const id = container.getId();
  const code = await runCmd("docker", ["pause", id], { quiet: true });
  if (code !== 0) {
    throw new Error(`docker pause ${id} failed with exit code ${code}`);
  }
}

/** Resume a paused container. */
export async function unpauseContainer(container: StartedTestContainer): Promise<void> {
  const id = container.getId();
  const code = await runCmd("docker", ["unpause", id], { quiet: true });
  if (code !== 0) {
    throw new Error(`docker unpause ${id} failed with exit code ${code}`);
  }
}

/**
 * Execute psql inside the postgres container as the owner role and
 * return stdout text. Avoids opening a host port (postgres has none)
 * and avoids dragging the `pg` driver into the e2e package deps.
 *
 * The owner-role .env values are read so the helper stays in sync
 * with the actual compose env (the operator MAY have rotated the
 * password via tools/bootstrap.sh).
 */
export async function psqlOwner(
  postgres: StartedTestContainer,
  database: string,
  sql: string,
): Promise<string> {
  // Use the POSTGRES_OWNER_USER / POSTGRES_OWNER_PASSWORD pair that
  // docker-compose injected into the postgres container env. psql
  // reads PGPASSWORD from the env we pass to exec().
  const env = readDotenv();
  const owner = env.POSTGRES_OWNER_USER ?? "openwhispr_owner";
  const password = env.POSTGRES_OWNER_PASSWORD ?? "";

  // -At: tuples only, unaligned (one row per line, columns separated by |).
  // ON_ERROR_STOP=1: psql exits non-zero on the first SQL error.
  const result = await postgres.exec(
    ["psql", "-U", owner, "-d", database, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { env: { PGPASSWORD: password } },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `psqlOwner: psql exited ${result.exitCode}\nsql=${sql}\nstdout=${result.output}`,
    );
  }
  return result.output;
}

/** Read .env file into a Record. Lightweight — no dotenv dep. */
function readDotenv(): Record<string, string> {
  // Lazy import so tests that don't need this don't pay the cost.
  // The .env file may not exist on a contributor's first clone — we
  // fall back to defaults seeded by tools/bootstrap.sh.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const envPath = resolve(REPO_ROOT, ".env");
  if (!fs.existsSync(envPath)) return {};
  const raw = fs.readFileSync(envPath, "utf8");
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && m[1] && m[2] !== undefined) out[m[1]] = m[2];
  }
  return out;
}
