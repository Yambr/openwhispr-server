// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 14 / Plan 14-03 — compose overlay conformance.
 *
 * Static + merged-config conformance for the 6 opt-in overlays that
 * re-introduce every service slim-core (Plan 14-01) stripped from the
 * bare `docker-compose.yml`:
 *
 *   - compose/docker-compose.observability.yml   (5 services)
 *   - compose/docker-compose.storage.yml         (1 service: minio)
 *   - compose/docker-compose.ingress.yml         (1 service: traefik + !reset on api/web ports)
 *   - compose/docker-compose.pgbouncer.yml       (1 service: pgbouncer)
 *   - compose/docker-compose.dev-tools.yml       (1 service: mailpit)
 *   - compose/docker-compose.contract-test.yml   (3 services: fixture-idp, seed, contract-test-runner)
 *
 * Each overlay must:
 *  - Exist under compose/.
 *  - Declare exactly the expected service roster (set equality).
 *  - Re-inject the depends_on / environment deltas RESEARCH §A.3 requires.
 *  - Merge cleanly with the slim-core base (`docker compose -f base -f overlay config -q` exits 0).
 *
 * Plus integration assertions on consumer touch points:
 *  - compose/grafana/provisioning/datasources/postgres.yaml -> postgres:5432 direct
 *  - tests/e2e-cjm/support/compose-harness.ts COMPOSE_FILES extension
 *  - Makefile new targets
 *  - tools/compose-chart-parity.allowlist.json recognizes overlay-only services
 *  - Ingress overlay strips api/web host ports via compose 2.20+ `!reset []`
 *
 * Docker-dependent checks are guarded by `SKIP_DOCKER === "1"` env so CI
 * without Docker can still typecheck and run the pure-YAML portions.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO_ROOT = process.cwd().endsWith("/tests/integration")
  ? resolve(process.cwd(), "../..")
  : process.cwd();

const BASE_COMPOSE = resolve(REPO_ROOT, "docker-compose.yml");

interface ComposeService {
  image?: string;
  build?: unknown;
  ports?: unknown;
  depends_on?: string[] | Record<string, { condition?: string } | undefined>;
  environment?: Record<string, unknown> | string[];
  volumes?: unknown[];
  labels?: unknown;
  healthcheck?: unknown;
  networks?: unknown;
  command?: unknown;
  restart?: unknown;
  env_file?: unknown;
  entrypoint?: unknown;
}

interface ComposeDoc {
  services?: Record<string, ComposeService>;
  volumes?: Record<string, unknown>;
  networks?: Record<string, unknown>;
}

function loadYaml(path: string): ComposeDoc {
  return parse(readFileSync(path, "utf8")) as ComposeDoc;
}

function envMap(svc: ComposeService): Record<string, string> {
  const env = svc.environment;
  if (!env) return {};
  if (Array.isArray(env)) {
    const out: Record<string, string> = {};
    for (const line of env) {
      const idx = line.indexOf("=");
      if (idx > 0) out[line.slice(0, idx)] = line.slice(idx + 1);
    }
    return out;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = String(v);
  }
  return out;
}

function dependsOnMap(svc: ComposeService): Record<string, { condition?: string }> {
  const d = svc.depends_on;
  if (!d) return {};
  if (Array.isArray(d)) {
    const out: Record<string, { condition?: string }> = {};
    for (const k of d) out[k] = {};
    return out;
  }
  return d as Record<string, { condition?: string }>;
}

function dockerAvailable(): boolean {
  if (process.env.SKIP_DOCKER === "1") return false;
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

// Docker compose config calls take ~10s on cold cache; bump vitest's
// default 5s timeout for every docker-gated assertion below.
const DOCKER_TIMEOUT_MS = 30_000;

function composeConfigQuiet(files: string[]): { ok: boolean; stderr: string } {
  const args = ["compose"];
  for (const f of files) {
    args.push("-f", f);
  }
  args.push("config", "-q");
  try {
    execFileSync("docker", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stderr: "" };
  } catch (e) {
    const err = e as { stderr?: Buffer | string };
    const stderr =
      typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString("utf8") ?? String(e));
    return { ok: false, stderr };
  }
}

function composeConfigJson(files: string[]): unknown {
  const args = ["compose"];
  for (const f of files) {
    args.push("-f", f);
  }
  args.push("config", "--format", "json");
  const out = execFileSync("docker", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

// ─────────────────────────────────────────────────────────────────────────────
// Observability overlay
// ─────────────────────────────────────────────────────────────────────────────

describe("Phase 14 / Plan 14-03 — observability overlay", () => {
  const path = resolve(REPO_ROOT, "compose/docker-compose.observability.yml");

  it("file exists", () => {
    expect(existsSync(path), `${path} must exist`).toBe(true);
  });

  it("declares the 5 expected services", () => {
    const doc = loadYaml(path);
    const keys = new Set(Object.keys(doc.services ?? {}));
    // Overlay also re-declares api + worker for depends_on/env deltas.
    expect(keys.has("otel-collector")).toBe(true);
    expect(keys.has("loki")).toBe(true);
    expect(keys.has("tempo")).toBe(true);
    expect(keys.has("mimir")).toBe(true);
    expect(keys.has("grafana")).toBe(true);
  });

  it("re-injects api.depends_on.otel-collector AND OTEL_EXPORTER_OTLP_ENDPOINT default", () => {
    const doc = loadYaml(path);
    const api = doc.services?.api;
    expect(api, "overlay must re-declare api service for deltas").toBeTruthy();
    if (!api) return;
    const dep = dependsOnMap(api);
    expect(dep["otel-collector"]).toBeTruthy();
    expect(dep["otel-collector"]?.condition).toBe("service_started");
    const env = envMap(api);
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toMatch(/:-http:\/\/otel-collector:4317/);
  });

  it("re-injects worker.depends_on.otel-collector AND OTEL_EXPORTER_OTLP_ENDPOINT default", () => {
    const doc = loadYaml(path);
    const worker = doc.services?.worker;
    expect(worker).toBeTruthy();
    if (!worker) return;
    const dep = dependsOnMap(worker);
    expect(dep["otel-collector"]?.condition).toBe("service_started");
    const env = envMap(worker);
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toMatch(/:-http:\/\/otel-collector:4317/);
  });

  it.skipIf(!HAS_DOCKER)(
    "merges cleanly with slim-core base",
    { timeout: DOCKER_TIMEOUT_MS },
    () => {
      const res = composeConfigQuiet([BASE_COMPOSE, path]);
      expect(res.ok, `docker compose config -q failed: ${res.stderr}`).toBe(true);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Storage overlay
// ─────────────────────────────────────────────────────────────────────────────

describe("Phase 14 / Plan 14-03 — storage overlay", () => {
  const path = resolve(REPO_ROOT, "compose/docker-compose.storage.yml");

  it("file exists", () => {
    expect(existsSync(path)).toBe(true);
  });

  it("declares the minio service", () => {
    const doc = loadYaml(path);
    expect(doc.services?.minio).toBeTruthy();
  });

  it("re-injects api.depends_on.minio: service_healthy and S3_ENDPOINT default", () => {
    const doc = loadYaml(path);
    const api = doc.services?.api;
    expect(api).toBeTruthy();
    if (!api) return;
    const dep = dependsOnMap(api);
    expect(dep.minio?.condition).toBe("service_healthy");
    const env = envMap(api);
    expect(env.S3_ENDPOINT).toMatch(/:-http:\/\/minio:9000/);
  });

  it.skipIf(!HAS_DOCKER)(
    "merges cleanly with slim-core base",
    { timeout: DOCKER_TIMEOUT_MS },
    () => {
      const res = composeConfigQuiet([BASE_COMPOSE, path]);
      expect(res.ok, `docker compose config -q failed: ${res.stderr}`).toBe(true);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Ingress overlay — Traefik + ports !reset
// ─────────────────────────────────────────────────────────────────────────────

describe("Phase 14 / Plan 14-03 — ingress overlay", () => {
  const path = resolve(REPO_ROOT, "compose/docker-compose.ingress.yml");

  it("file exists", () => {
    expect(existsSync(path)).toBe(true);
  });

  it("declares the traefik service with the 4 host ports", () => {
    const doc = loadYaml(path);
    const traefik = doc.services?.traefik;
    expect(traefik).toBeTruthy();
    if (!traefik) return;
    const ports = traefik.ports as unknown[];
    expect(ports).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^80:80$/),
        expect.stringMatching(/^443:443$/),
        expect.stringMatching(/^8443:8443$/),
        expect.stringMatching(/^8080:8080$/),
      ]),
    );
  });

  it("declares the !reset [] directive textually on api and web ports", () => {
    // Compose 2.20+ supports `!reset []` (YAML tag) on list-typed overlay
    // fields to clear the base value rather than append. The `yaml` package
    // we use treats unknown tags as tagged scalars by default — easiest
    // assertion is regex over raw file text.
    const text = readFileSync(path, "utf8");
    // Match `ports: !reset []` (compact) or `ports: !reset\n  []` (split).
    expect(text).toMatch(/\bapi:[\s\S]*?\bports:\s*(!reset\s*\[\s*\]|!reset\s*\n\s*\[\s*\])/);
    expect(text).toMatch(/\bweb:[\s\S]*?\bports:\s*(!reset\s*\[\s*\]|!reset\s*\n\s*\[\s*\])/);
  });

  it.skipIf(!HAS_DOCKER)(
    "merges cleanly with slim-core base",
    { timeout: DOCKER_TIMEOUT_MS },
    () => {
      const res = composeConfigQuiet([BASE_COMPOSE, path]);
      expect(res.ok, `docker compose config -q failed: ${res.stderr}`).toBe(true);
    },
  );

  it.skipIf(!HAS_DOCKER)(
    "merged config strips api + web host ports via !reset",
    { timeout: DOCKER_TIMEOUT_MS },
    () => {
      const cfg = composeConfigJson([BASE_COMPOSE, path]) as {
        services?: Record<string, { ports?: unknown[] | null }>;
      };
      // `!reset []` clears the merged ports list. compose JSON omits a
      // null/empty `ports` key or emits `[]` depending on version —
      // accept both.
      const apiPorts = cfg.services?.api?.ports ?? [];
      const webPorts = cfg.services?.web?.ports ?? [];
      expect(apiPorts ?? []).toEqual([]);
      expect(webPorts ?? []).toEqual([]);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Pgbouncer overlay
// ─────────────────────────────────────────────────────────────────────────────

describe("Phase 14 / Plan 14-03 — pgbouncer overlay", () => {
  const path = resolve(REPO_ROOT, "compose/docker-compose.pgbouncer.yml");

  it("file exists", () => {
    expect(existsSync(path)).toBe(true);
  });

  it("declares the pgbouncer service", () => {
    const doc = loadYaml(path);
    expect(doc.services?.pgbouncer).toBeTruthy();
  });

  it("re-injects api.depends_on.pgbouncer: service_healthy and DATABASE_URL pointing at pgbouncer:5432", () => {
    // Phase 41.f-hotfix-2 (commit 3df1060): the pgbouncer container's
    // internal listen_port is 5432 (see compose/pgbouncer/pgbouncer.ini),
    // matching the healthcheck `pg_isready -h 127.0.0.1 -p 5432`. The
    // earlier `:6432` in this assertion shadowed a real production break
    // where the api ECONNREFUSED'd through the overlay.
    const doc = loadYaml(path);
    const api = doc.services?.api;
    expect(api).toBeTruthy();
    if (!api) return;
    const dep = dependsOnMap(api);
    expect(dep.pgbouncer?.condition).toBe("service_healthy");
    const env = envMap(api);
    expect(env.DATABASE_URL).toMatch(/pgbouncer:5432/);
  });

  it("re-injects migrate.depends_on.pgbouncer: service_healthy (sequencing barrier)", () => {
    const doc = loadYaml(path);
    const migrate = doc.services?.migrate;
    expect(migrate).toBeTruthy();
    if (!migrate) return;
    const dep = dependsOnMap(migrate);
    expect(dep.pgbouncer?.condition).toBe("service_healthy");
  });

  it.skipIf(!HAS_DOCKER)(
    "merges cleanly with slim-core base",
    { timeout: DOCKER_TIMEOUT_MS },
    () => {
      const res = composeConfigQuiet([BASE_COMPOSE, path]);
      expect(res.ok, `docker compose config -q failed: ${res.stderr}`).toBe(true);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Dev-tools overlay — mailpit ONLY (TD-14.a closure, CONTEXT decision 1)
// ─────────────────────────────────────────────────────────────────────────────

describe("Phase 14 / Plan 14-03 — dev-tools overlay", () => {
  const path = resolve(REPO_ROOT, "compose/docker-compose.dev-tools.yml");

  it("file exists", () => {
    expect(existsSync(path)).toBe(true);
  });

  // Phase 61 / R19 — mailpit + the SMTP wiring were PROMOTED into the
  // slim base (mailpit ships there behind the `dev` compose profile), so
  // the dev-tools overlay no longer redefines mailpit. It now only
  // carries dev-only ENV overrides on the base api/worker/litellm
  // services (NODE_ENV=development, rate-limit bypass, test-route seam,
  // well-known dev master key). It still declares NO standalone overlay
  // services — fixture-idp / seed / contract-test-runner live in the
  // contract-test overlay.
  it("declares NO standalone services — only env overrides on base api/worker/litellm", () => {
    const doc = loadYaml(path);
    const keys = new Set(Object.keys(doc.services ?? {}));
    expect(keys.has("mailpit")).toBe(false);
    expect(keys.has("fixture-idp")).toBe(false);
    expect(keys.has("seed")).toBe(false);
    expect(keys.has("contract-test-runner")).toBe(false);
    // The only stanzas present are env-override patches on base services.
    expect([...keys].sort()).toEqual(["api", "litellm", "worker"]);
  });

  it.skipIf(!HAS_DOCKER)(
    "merges cleanly with slim-core base",
    { timeout: DOCKER_TIMEOUT_MS },
    () => {
      const res = composeConfigQuiet([BASE_COMPOSE, path]);
      expect(res.ok, `docker compose config -q failed: ${res.stderr}`).toBe(true);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Contract-test overlay
// ─────────────────────────────────────────────────────────────────────────────

describe("Phase 14 / Plan 14-03 — contract-test overlay", () => {
  const path = resolve(REPO_ROOT, "compose/docker-compose.contract-test.yml");

  it("file exists", () => {
    expect(existsSync(path)).toBe(true);
  });

  it("declares fixture-idp + seed + contract-test-runner", () => {
    const doc = loadYaml(path);
    const keys = new Set(Object.keys(doc.services ?? {}));
    expect(keys.has("fixture-idp")).toBe(true);
    expect(keys.has("seed")).toBe(true);
    expect(keys.has("contract-test-runner")).toBe(true);
  });

  it.skipIf(!HAS_DOCKER)(
    "merges cleanly with slim-core base",
    { timeout: DOCKER_TIMEOUT_MS },
    () => {
      const res = composeConfigQuiet([BASE_COMPOSE, path]);
      expect(res.ok, `docker compose config -q failed: ${res.stderr}`).toBe(true);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Consumer touch points
// ─────────────────────────────────────────────────────────────────────────────

describe("Phase 14 / Plan 14-03 — consumer touch points", () => {
  it("grafana datasource points at postgres:5432 direct (not pgbouncer:6432)", () => {
    const text = readFileSync(
      resolve(REPO_ROOT, "compose/grafana/provisioning/datasources/postgres.yaml"),
      "utf8",
    );
    const doc = parse(text) as {
      datasources?: Array<{ url?: string }>;
    };
    const url = doc.datasources?.[0]?.url ?? "";
    expect(url).toBe("postgres:5432");
    expect(url).not.toMatch(/pgbouncer/);
  });

  it("compose-harness COMPOSE_FILES extends with the four cjm-relevant overlays", () => {
    const text = readFileSync(
      resolve(REPO_ROOT, "tests/e2e-cjm/support/compose-harness.ts"),
      "utf8",
    );
    // Pin the COMPOSE_FILES constant body and assert the four overlays.
    const m = text.match(
      /COMPOSE_FILES:\s*readonly\s*string\[\]\s*=\s*\[([\s\S]*?)\]\s*as\s*const;/,
    );
    expect(m, "COMPOSE_FILES constant must be present").not.toBeNull();
    const body = m?.[1] ?? "";
    expect(body).toMatch(/compose\/docker-compose\.observability\.yml/);
    expect(body).toMatch(/compose\/docker-compose\.pgbouncer\.yml/);
    expect(body).toMatch(/compose\/docker-compose\.dev-tools\.yml/);
    expect(body).toMatch(/compose\/docker-compose\.ingress\.yml/);
  });

  it("Makefile defines up + up-with-* + up-full targets", () => {
    const text = readFileSync(resolve(REPO_ROOT, "Makefile"), "utf8");
    for (const tgt of [
      "up:",
      "up-with-observability:",
      "up-with-storage:",
      "up-with-ingress:",
      "up-with-pgbouncer:",
      "up-with-dev-tools:",
      "up-full:",
    ]) {
      expect(text, `Makefile must declare target '${tgt}'`).toMatch(
        new RegExp(`^${tgt.replace(/[-/]/g, "\\$&")}`, "m"),
      );
    }
  });

  it("compose-chart-parity allowlist recognizes overlay-only services", () => {
    const text = readFileSync(
      resolve(REPO_ROOT, "tools/compose-chart-parity.allowlist.json"),
      "utf8",
    );
    const data = JSON.parse(text) as Record<string, { services?: string[] } | unknown>;
    const allServices = new Set<string>();
    for (const v of Object.values(data)) {
      if (v && typeof v === "object" && "services" in v) {
        const svcs = (v as { services?: string[] }).services ?? [];
        for (const s of svcs) allServices.add(s);
      }
    }
    expect(allServices.has("mailpit")).toBe(true);
    expect(allServices.has("fixture-idp")).toBe(true);
    expect(allServices.has("seed")).toBe(true);
    expect(allServices.has("contract-test-runner")).toBe(true);
  });

  it("compose-chart-parity linter DEFAULT_COMPOSE_FILES includes overlay files", () => {
    const text = readFileSync(resolve(REPO_ROOT, "tools/lint-compose-chart-parity.ts"), "utf8");
    const m = text.match(/DEFAULT_COMPOSE_FILES\s*=\s*\[([\s\S]*?)\];/);
    expect(m, "DEFAULT_COMPOSE_FILES must be declared").not.toBeNull();
    const body = m?.[1] ?? "";
    // The linter must see services from overlays via the merged file list.
    expect(body).toMatch(/compose\/docker-compose\.observability\.yml/);
    expect(body).toMatch(/compose\/docker-compose\.ingress\.yml/);
    expect(body).toMatch(/compose\/docker-compose\.contract-test\.yml/);
    expect(body).toMatch(/compose\/docker-compose\.dev-tools\.yml/);
  });
});
