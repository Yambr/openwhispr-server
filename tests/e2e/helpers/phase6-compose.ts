// SPDX-License-Identifier: FSL-1.1-ALv2
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
  // Plan 51-25 — explicitly route OTel spans through the collector
  // bundled by the observability overlay. The local `.env` may carry
  // `OTEL_EXPORTER_OTLP_ENDPOINT=disabled` (slim-core default); without
  // this override the api boots with OTel disabled and
  // otel-trace-propagation.test.ts finds no traces in Tempo.
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector:4317",
  // Plan 51-25 — raise per-route limiter ceilings to non-limit-tripping
  // levels for the e2e suite. The audit-log-write test signs in then
  // calls /api/v1/keys/create exactly once and gets 429 in the wild —
  // the 5/hour route ceiling collides with seed-container traffic on
  // shared compose Valkey buckets keyed on req.ip. Tests that
  // explicitly exercise rate-limit semantics (rate-limit-layered.test)
  // override these to assert the production posture.
  RATE_LIMIT_GLOBAL_USER_MAX: "10000",
  RATE_LIMIT_GLOBAL_IP_CEILING: "10000",
  // The per-route hardcoded 5/hour on /api/v1/keys/create collides
  // with the seed container's shared-IP traffic; disable the limiter
  // entirely for e2e. rate-limit-layered.test brings up its own stack
  // with the limiter ON and asserts the production posture.
  OPENWHISPR_DISABLE_RATE_LIMIT: "true",
};

// Phase 53 — Plan 14 moved observability (grafana, loki, otel-collector,
// tempo, mimir) into the `compose/docker-compose.observability.yml`
// overlay. Phase 6 e2e helpers (`phase6BringStackUp` + `forwardThrough*`)
// still rely on `grafana` being part of the spawned stack to validate
// log/trace propagation, so the canonical phase 6 file list layers the
// observability overlay on top of the slim-core base file.
// Phase 14 / Plan 14-03 moved Traefik (with its `https://api.localhost`
// + `:8443` realtime entrypoint TLS termination) to the ingress overlay.
// Phase 6 e2e harness asserts against BACKEND_URL=https://api.localhost
// so we layer the ingress overlay alongside observability into the base.
const COMPOSE_FILES = [
  "docker-compose.yml",
  "compose/docker-compose.observability.yml",
  "compose/docker-compose.ingress.yml",
  "tests/e2e/helpers/phase6-e2e-env-override.yml",
  // Phase 53 — Plan 14 also moved the `seed` service (conformance
  // fixture loader) into compose/docker-compose.contract-test.yml.
  // Phase 6 e2e helper calls `docker compose run --rm seed` so we
  // layer this overlay too. The seed service `restart: "no"` keeps
  // it inert until explicitly invoked.
  "compose/docker-compose.contract-test.yml",
];

/**
 * Default boot timeout. The api healthcheck depends on PG + Valkey +
 * PgBouncer + migrations all going green; cold-pull / cold-build on
 * a laptop runs ~120-180s, CI cold runners up to 240s. Callers MAY
 * extend via `phase6BringStackUp({ timeoutMs: …})`.
 */
export const DEFAULT_BOOT_TIMEOUT_MS = 420_000;

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
  /** Resolve the `worker` service container. */
  worker: StartedTestContainer;
  /** Resolve the `grafana` service container (has wget; LGTM gateway). */
  grafana: StartedTestContainer;
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
/**
 * Phase 6 / Plan 06-12e — disable testcontainers' ryuk reaper for this
 * harness.  Ryuk's `addComposeProject('openwhispr')` instructs the
 * reaper to delete EVERYTHING with the
 * `com.docker.compose.project=openwhispr` label on test-process exit —
 * including the locally-built `openwhispr-{api,worker,migrate}:latest`
 * images that compose tags with that label.  The next test run then
 * fails its `--no-build --pull never` boot with `No such image:
 * openwhispr-migrate:latest`.  We own teardown explicitly via the
 * `down()` thunk on each Phase6Stack, so ryuk's "best-effort cleanup
 * on process exit" is strictly counterproductive here.  Set the env
 * BEFORE any DockerComposeEnvironment is constructed.
 */
if (process.env.TESTCONTAINERS_RYUK_DISABLED === undefined) {
  process.env.TESTCONTAINERS_RYUK_DISABLED = "true";
}

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
    /**
     * Phase 6 / Plan 06-12b — extra compose files layered on top of
     * `docker-compose.yml`. Each entry MUST be a path relative to
     * REPO_ROOT.  testcontainers' DockerComposeEnvironment accepts the
     * second constructor arg as `string | string[]`; we surface the
     * array form so suites can add per-test env overrides (e.g.
     * NODE_ENV=test + OUTBOUND_ALLOWED_HOSTS for the ssrf-block
     * suite, or RATE_LIMIT_* env knobs for rate-limit-layered).
     *
     * Override files MUST live under `tests/e2e/helpers/` and SHOULD
     * be named `phase6-<scenario>-override.yml` so the conventions are
     * obvious to the next test author.
     */
    overrideComposeFiles?: string[];
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
  const composeFiles: string | string[] =
    opts.overrideComposeFiles && opts.overrideComposeFiles.length > 0
      ? [...COMPOSE_FILES, ...opts.overrideComposeFiles]
      : COMPOSE_FILES;
  const env = await new DockerComposeEnvironment(REPO_ROOT, composeFiles)
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
  const worker = getServiceContainer(env, "worker");
  const grafana = getServiceContainer(env, "grafana");

  // Belt-and-suspenders: poll Traefik → /livez until 200 so the api
  // is actually serving (the docker HEALTHCHECK guarantees the
  // container reports healthy but Traefik routing may still settle).
  //
  // Phase 53 — Traefik dynamic config gained an `api-probes` router that
  // exposes /livez, /readyz, /startupz, /healthz alongside /api/*.
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
    //
    // Plan 06-12e — CRITICAL: pass the SAME override files (`-f
    // docker-compose.yml -f <override>`) that the `up` step used.
    // Without this, `compose run` invoked with only the base compose
    // file detects a service-config divergence vs. the running stack
    // (api's `environment:` block contains `NODE_ENV=production` in
    // base but `NODE_ENV=test` after override) and recreates the api
    // container under the BASE config — silently dropping the
    // override env block and de-registering the NODE_ENV='test'-gated
    // `/__test/fetch` debug route.  This caused the 12d-deferred
    // ssrf-block test to 404 on the test surface despite the api
    // healthcheck passing.
    const seedFileArgs: string[] = [];
    for (const f of COMPOSE_FILES) {
      seedFileArgs.push("-f", f);
    }
    for (const f of opts.overrideComposeFiles ?? []) {
      seedFileArgs.push("-f", f);
    }
    // `--no-deps` so `compose run` does NOT recreate the api container
    // under a stale compose-file view.  api is already up + healthy
    // from testcontainers' `.up()` step; we skip the depends_on bootstrap.
    const code = await runCmd(
      "docker",
      [
        "compose",
        "-p",
        projectName,
        ...seedFileArgs,
        "--profile",
        "default",
        "--profile",
        "contract-test",
        "run",
        "--rm",
        "--no-deps",
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

  return { env, projectName, postgres, valkey, api, worker, grafana, down };
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

/**
 * Phase 6 / Plan 06-12c — enqueue a BullMQ job from outside the worker.
 *
 * Shells out via `docker compose -p <project> exec worker node -e <script>`
 * because (a) valkey has no host port (internal network only) and (b) the
 * worker image is the only container that already has bullmq + ioredis in
 * /app/node_modules. We avoid adding a debug `/__test/enqueue` route per
 * Plan 06-12c's "no scope creep" guidance — direct enqueue keeps the test
 * isolated from API changes.
 *
 * Returns the job id assigned by BullMQ.
 */
export async function enqueueBullMQJob(
  projectName: string,
  queueName: string,
  jobName: string,
  data: Record<string, unknown>,
): Promise<string> {
  const env = readDotenv();
  const valkeyPassword = env.VALKEY_PASSWORD ?? "";
  const script = `
    const { Queue } = require('bullmq');
    const connection = { host: 'valkey', port: 6379, password: ${JSON.stringify(valkeyPassword)} };
    const q = new Queue(${JSON.stringify(queueName)}, { connection });
    q.add(${JSON.stringify(jobName)}, ${JSON.stringify(data)})
      .then(job => { console.log(job.id); return q.close(); })
      .then(() => process.exit(0))
      .catch(err => { console.error(err); process.exit(1); });
  `.replace(/\s+/g, " ");
  return await new Promise<string>((res, rej) => {
    const child = spawn(
      "docker",
      ["compose", "-p", projectName, "exec", "-T", "worker", "node", "-e", script],
      { cwd: REPO_ROOT },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      if (code === 0) res(out.trim().split("\n").pop()!.trim());
      else rej(new Error(`enqueueBullMQJob exit=${code} stderr=${err} stdout=${out}`));
    });
  });
}

/**
 * Phase 6 / Plan 06-12c — poll a BullMQ job until it reaches the
 * `completed` or `failed` state. Returns `{state, returnValue?, failedReason?}`.
 * Uses the same docker-compose-exec channel as enqueueBullMQJob.
 */
export async function waitForBullMQJob(
  projectName: string,
  queueName: string,
  jobId: string,
  opts: { deadlineMs: number; intervalMs?: number } = { deadlineMs: 60_000 },
): Promise<{ state: string; returnValue?: unknown; failedReason?: string }> {
  const env = readDotenv();
  const valkeyPassword = env.VALKEY_PASSWORD ?? "";
  const start = Date.now();
  const interval = opts.intervalMs ?? 1000;
  let last: { state: string; returnValue?: unknown; failedReason?: string } = {
    state: "unknown",
  };
  while (Date.now() - start < opts.deadlineMs) {
    const script = `
      const { Queue } = require('bullmq');
      const connection = { host: 'valkey', port: 6379, password: ${JSON.stringify(valkeyPassword)} };
      const q = new Queue(${JSON.stringify(queueName)}, { connection });
      (async () => {
        const job = await q.getJob(${JSON.stringify(jobId)});
        if (!job) { console.log(JSON.stringify({ state: 'missing' })); }
        else {
          const state = await job.getState();
          console.log(JSON.stringify({
            state,
            returnValue: job.returnvalue,
            failedReason: job.failedReason,
          }));
        }
        await q.close();
      })().catch(err => { console.error(err); process.exit(1); });
    `.replace(/\s+/g, " ");
    last = await new Promise((res, rej) => {
      const child = spawn(
        "docker",
        ["compose", "-p", projectName, "exec", "-T", "worker", "node", "-e", script],
        { cwd: REPO_ROOT },
      );
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.stderr.on("data", (d) => (err += d.toString()));
      child.on("close", (code) => {
        if (code !== 0) return rej(new Error(`waitForBullMQJob exit=${code} stderr=${err}`));
        try {
          const lines = out.trim().split("\n").filter(Boolean);
          res(JSON.parse(lines[lines.length - 1] ?? "{}"));
        } catch (e) {
          rej(new Error(`parse failed: ${out} ${String(e)}`));
        }
      });
    });
    if (last.state === "completed" || last.state === "failed") return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `waitForBullMQJob: ${queueName}/${jobId} never finished in ${opts.deadlineMs}ms; last=${JSON.stringify(last)}`,
  );
}

/**
 * Phase 6 / Plan 06-12c — count jobs in a BullMQ queue across the given
 * states. Useful for asserting a child job was enqueued by a parent.
 */
export async function getBullMQJobsByName(
  projectName: string,
  queueName: string,
  jobName: string,
  opts: { types?: string[] } = {},
): Promise<Array<{ id: string; data: unknown; state: string }>> {
  const env = readDotenv();
  const valkeyPassword = env.VALKEY_PASSWORD ?? "";
  const types = opts.types ?? ["completed", "active", "waiting", "delayed", "failed"];
  const script = `
    const { Queue } = require('bullmq');
    const connection = { host: 'valkey', port: 6379, password: ${JSON.stringify(valkeyPassword)} };
    const q = new Queue(${JSON.stringify(queueName)}, { connection });
    (async () => {
      const jobs = await q.getJobs(${JSON.stringify(types)}, 0, 200);
      const out = [];
      for (const j of jobs) {
        if (j.name === ${JSON.stringify(jobName)}) {
          out.push({ id: j.id, data: j.data, state: await j.getState() });
        }
      }
      console.log(JSON.stringify(out));
      await q.close();
    })().catch(err => { console.error(err); process.exit(1); });
  `.replace(/\s+/g, " ");
  return await new Promise((res, rej) => {
    const child = spawn(
      "docker",
      ["compose", "-p", projectName, "exec", "-T", "worker", "node", "-e", script],
      { cwd: REPO_ROOT },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) return rej(new Error(`getBullMQJobsByName exit=${code} stderr=${err}`));
      try {
        const lines = out.trim().split("\n").filter(Boolean);
        res(JSON.parse(lines[lines.length - 1] ?? "[]"));
      } catch (e) {
        rej(new Error(`parse failed: ${out} ${String(e)}`));
      }
    });
  });
}

/**
 * Phase 6 / Plan 06-12c — capture container stdout/stderr SINCE an epoch
 * timestamp WITHOUT following. testcontainers v11's
 * `StartedTestContainer.logs()` hard-codes `follow: true` on the Docker
 * Engine API call, which produces a Readable that never terminates while
 * the container is running — `for await` on it hangs the test.
 *
 * We shell out to `docker logs --since <epoch>` which closes the stream
 * once caught up to "now", giving a deterministic snapshot for substring
 * assertions. Used by the log-scrub-sentinel and otel-trace-propagation
 * e2e suites.
 */
export async function containerLogsSnapshot(
  container: StartedTestContainer,
  sinceEpochSec: number,
  opts: { composeProject?: string; composeService?: string } = {},
): Promise<string> {
  const secondsAgo = Math.max(1, Math.floor(Date.now() / 1000) - sinceEpochSec);
  // If compose project + service are supplied, prefer
  // `docker compose -p <p> logs <s> --since <Ns> --no-color` over raw
  // `docker logs <id>`. This is resilient to container recreation
  // mid-suite (compose-level service name persists) and explicit about
  // intent. Falls back to `docker logs <id>` when caller can't supply.
  return await new Promise<string>((res, rej) => {
    const args =
      opts.composeProject && opts.composeService
        ? [
            "compose",
            "-p",
            opts.composeProject,
            "logs",
            "--no-color",
            "--since",
            `${secondsAgo}s`,
            opts.composeService,
          ]
        : ["logs", "--since", `${secondsAgo}s`, container.getId()];
    const child = spawn("docker", args, { cwd: REPO_ROOT });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      // `docker logs` writes container stderr to the parent stderr and
      // container stdout to parent stdout. We merge both so substring
      // sweeps see everything pino emitted (pino writes JSON lines to
      // stdout in our config, but other libs may go to stderr).
      if (code === 0) res(out + err);
      else rej(new Error(`docker logs exit=${code}: ${err} ${out}`));
    });
  });
}

/**
 * Phase 6 / Plan 06-12c — fetch a URL from inside the grafana container
 * (which has wget). Used to query Tempo, Loki, Mimir which only expose
 * HTTP on the internal docker network.
 */
export async function curlInContainer(
  container: StartedTestContainer,
  url: string,
  opts: { headers?: Record<string, string>; bodyOnly?: boolean } = {},
): Promise<{ exitCode: number; body: string }> {
  const headerArgs: string[] = [];
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    headerArgs.push("--header", `${k}: ${v}`);
  }
  const result = await container.exec(["wget", "-qO-", ...headerArgs, url]);
  return { exitCode: result.exitCode, body: result.output };
}

/**
 * Phase 6 / Plan 06-12b — handle returned by `phase6BringStackUpScaled`.
 *
 * Unlike `Phase6Stack`, this is shell-managed: testcontainers v11 does
 * NOT expose a `withScale(service, n)` method, so we bypass
 * DockerComposeEnvironment entirely and drive the compose CLI ourselves.
 * The handle exposes `projectName` (so callers can shell-exec follow-on
 * docker commands), a teardown thunk, and the same `pollUrl` /
 * `BACKEND_URL` exports the test reaches for.
 */
export interface Phase6ScaledStack {
  projectName: string;
  /** Tear the stack down + drop named volumes. */
  down: () => Promise<void>;
}

/**
 * Phase 6 / Plan 06-12b / SCALE-01 — boot the compose stack with
 * `--scale api=N` for the horizontal-scale e2e. Pure shell because
 * testcontainers v11 has no `withScale` API.
 *
 * The caller MUST supply a compose override file that swaps Traefik's
 * dynamic.yml mount onto one that enumerates ALL N replica DNS names
 * as discrete `servers:` entries (otherwise the production file-provider
 * dynamic.yml pins to one replica via a single `url: http://api:3000`
 * server entry, defeating the SCALE-01 round-robin invariant).  See
 * tests/e2e/helpers/phase6-scale-dynamic.yml + phase6-scale-override.yml.
 *
 * Boot timeline (informational, sets caller expectation):
 *   - `up -d --scale api=2` against the openwhispr project on a warm
 *     image cache: ~30-60s.
 *   - poll /livez until 200: usually fast once api containers are
 *     up; budget 60s.
 *   - Total beforeAll budget should be ≥ 180_000 ms.
 */
export async function phase6BringStackUpScaled(opts: {
  /** Number of api replicas. */
  apiScale: number;
  /** Compose override files to layer on top of docker-compose.yml.
   *  REQUIRED: must include phase6-scale-override.yml or the Traefik
   *  routing will pin to one replica. */
  overrideComposeFiles: string[];
  /** Override the compose project name. Defaults to `openwhispr`. */
  projectName?: string;
  /** Boot poll deadline in ms. Defaults to 180_000. */
  timeoutMs?: number;
  /** Skip seeding (the scale test does not need conformance fixtures). */
  seed?: boolean;
}): Promise<Phase6ScaledStack> {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const projectName = opts.projectName ?? "openwhispr";
  const timeoutMs = opts.timeoutMs ?? 420_000;

  // Compose the `-f docker-compose.yml -f <ingress> -f <override...>`
  // argument list. Override files are paths relative to REPO_ROOT.
  // Plan 51-25 — layer the ingress overlay (which defines the
  // `traefik` service) BEFORE the override files: the scale-override
  // adjusts `traefik.volumes` and needs the base traefik definition
  // already in scope.
  const fileArgs: string[] = [
    "-f",
    "docker-compose.yml",
    "-f",
    "compose/docker-compose.ingress.yml",
    // Plan 51-25 — the contract-test overlay defines the `seed`
    // service the scaled helper invokes via `compose run --rm seed`
    // when opts.seed is true. Without it `no such service: seed`.
    "-f",
    "compose/docker-compose.contract-test.yml",
  ];
  for (const f of opts.overrideComposeFiles) {
    fileArgs.push("-f", f);
  }

  // Bring the stack up scaled.  `--no-build --pull never` mirrors the
  // phase6BringStackUp posture (image-cache reuse, no registry pulls).
  //
  // Plan 06-12e — do NOT pass `--wait` here.  `docker compose --wait`
  // gates on EVERY service's healthcheck across the stack, including
  // the (pre-existing-flaky) grafana healthcheck whose pattern
  // `grep -q '"database":"ok"'` doesn't match Grafana 11.6's
  // pretty-printed JSON response shape `"database": "ok"` (note the
  // space after the colon).  That false-negative trips compose-up
  // exit=1 even though api/postgres/valkey/litellm/traefik all reached
  // `healthy`.  We poll Traefik → /livez below — the api is the only
  // dependency the test actually exercises, and its docker
  // HEALTHCHECK is the gate that matters for the SCALE-01 invariant.
  // The non-scaled `phase6BringStackUp` already takes this posture
  // via testcontainers' per-container wait strategy; we mirror it for
  // the shell-driven scaled path.
  const upCode = await runCmd(
    "docker",
    [
      "compose",
      "-p",
      projectName,
      ...fileArgs,
      "--profile",
      "default",
      "up",
      "-d",
      "--no-build",
      "--pull",
      "never",
      "--scale",
      `api=${opts.apiScale}`,
    ],
    { env: { ...HERMETIC_ENV } },
  );
  if (upCode !== 0) {
    // Best-effort teardown so a half-up stack doesn't poison subsequent
    // suites.
    await runCmd(
      "docker",
      ["compose", "-p", projectName, ...fileArgs, "down", "-v", "--remove-orphans"],
      { quiet: true },
    ).catch(() => {});
    throw new Error(
      `phase6BringStackUpScaled: \`docker compose up\` exit=${upCode}; \`docker compose ps\` for triage`,
    );
  }

  // Poll Traefik → /livez until at least one api replica is serving.
  // This is the ONLY readiness gate the test depends on; per-container
  // HEALTHCHECKs on api/postgres/valkey/litellm/traefik are already
  // strict, and grafana's pre-existing healthcheck false-negative
  // (see comment in the compose-up call above) does NOT block us.
  await pollUrl(`${BACKEND_URL}/livez`, {
    expectStatus: 200,
    deadlineMs: timeoutMs,
    intervalMs: 1000,
  });

  // Plan 06-12e — for the scaled-up path we MUST further confirm that
  // EVERY replica is responsive, not just one.  Traefik round-robins
  // across all `servers:` entries in the static dynamic.yml; if api-2
  // is still booting when the test fires its first request, Traefik
  // can pick api-2 and return 502 Bad Gateway even though api-1 is
  // healthy and answered /livez.  We burst N×scale `/livez` GETs and
  // require all of them to be 200 — this saturates the round-robin
  // and surfaces any not-yet-ready backend before sign-in is attempted.
  const livezBurst = Math.max(opts.apiScale * 4, 10);
  for (let attempt = 0; attempt < 30; attempt++) {
    let allOk = true;
    for (let i = 0; i < livezBurst; i++) {
      try {
        const res = await fetch(`${BACKEND_URL}/livez`, {
          signal: AbortSignal.timeout(3000),
        });
        await res.text().catch(() => undefined);
        if (res.status !== 200) {
          allOk = false;
          break;
        }
      } catch {
        allOk = false;
        break;
      }
    }
    if (allOk) break;
    await new Promise((r) => setTimeout(r, 2000));
    if (attempt === 29) {
      throw new Error(
        `phase6BringStackUpScaled: not all ${opts.apiScale} api replicas became Traefik-routable within 60s after /livez first succeeded`,
      );
    }
  }

  if (opts.seed) {
    // Plan 06-12e — `--no-deps` so `compose run` does NOT touch the
    // already-running api containers.  Without this, `compose run --rm
    // seed` notices the api service is "over-scaled" relative to the
    // compose-file default of 1 and silently stops api-2, killing the
    // SCALE-01 invariant before the test even starts.  api is already
    // up + healthy from the earlier `up --scale api=N` step, so we
    // safely skip the depends_on bootstrap.
    const seedCode = await runCmd(
      "docker",
      [
        "compose",
        "-p",
        projectName,
        ...fileArgs,
        "--profile",
        "default",
        "--profile",
        "contract-test",
        "run",
        "--rm",
        "--no-deps",
        "seed",
      ],
      { env: { ...HERMETIC_ENV } },
    );
    if (seedCode !== 0) {
      await runCmd(
        "docker",
        ["compose", "-p", projectName, ...fileArgs, "down", "-v", "--remove-orphans"],
        { quiet: true },
      ).catch(() => {});
      throw new Error(`phase6BringStackUpScaled: seed exited ${seedCode}`);
    }
  }

  const down = async (): Promise<void> => {
    const code = await runCmd(
      "docker",
      ["compose", "-p", projectName, ...fileArgs, "down", "-v", "--remove-orphans"],
      { quiet: true },
    );
    if (code !== 0) {
      // Best-effort: surface non-fatal so afterAll cleanup continues.
      // biome-ignore lint/suspicious/noConsole: e2e teardown diagnostic
      console.warn(`phase6BringStackUpScaled.down: exit=${code}`);
    }
  };

  return { projectName, down };
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
