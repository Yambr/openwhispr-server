// SPDX-License-Identifier: Apache-2.0
// Phase 1 Plan 01 — compose-schema unit tests.
//
// Structural lint of the repo-root docker-compose.yml. Does NOT boot Docker;
// parses YAML and asserts the contract Plan 01-01 ships:
//
//   1. Compose Spec v2 (no top-level `version:` key).
//   2. All ten data-plane services are declared with their verified image
//      pins, healthchecks, and attachment to the single internal network
//      `openwhispr_internal`.
//   3. Only Traefik publishes host ports.
//   4. PgBouncer waits for Postgres to be `service_healthy`.
//   5. The seven named state volumes are declared.
//   6. The OTel Collector pipeline carries `X-Scope-OrgID` (Mimir
//      multi-tenancy header — required even in single-tenant mode).
//
// Tests are deliberately read-only against the working-tree files; they
// fail RED until Task 2 expands the compose stack.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO_ROOT = process.cwd();
const COMPOSE_PATH = join(REPO_ROOT, "docker-compose.yml");
const OTEL_CONFIG_PATH = join(REPO_ROOT, "compose", "otel-collector", "config.yaml");

const REQUIRED_SERVICES = [
  "postgres",
  "pgbouncer",
  "valkey",
  "minio",
  "traefik",
  "otel-collector",
  "loki",
  "tempo",
  "mimir",
  "grafana",
] as const;

const REQUIRED_VOLUMES = [
  "postgres_data",
  "valkey_data",
  "minio_data",
  "loki_data",
  "tempo_data",
  "mimir_data",
  "grafana_data",
] as const;

const VERIFIED_IMAGE_PINS: Record<string, RegExp> = {
  postgres: /^postgres:17(\.\d+)?-alpine$/,
  pgbouncer: /^edoburu\/pgbouncer:1\.23\.1$/,
  valkey: /^valkey\/valkey:8(\.\d+)?-alpine$/,
  minio: /^minio\/minio:RELEASE\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(@sha256:[0-9a-f]+)?$/,
  traefik: /^traefik:v3(\.\d+)?$/,
  "otel-collector": /^otel\/opentelemetry-collector-contrib:0\.\d+\.\d+$/,
  loki: /^grafana\/loki:3(\.\d+(\.\d+)?)?$/,
  tempo: /^grafana\/tempo:2(\.\d+(\.\d+)?)?$/,
  mimir: /^grafana\/mimir:2(\.\d+(\.\d+)?)?$/,
  grafana: /^grafana\/grafana:11(\.\d+(\.\d+)?)?$/,
};

interface ComposeService {
  image?: string;
  healthcheck?: unknown;
  networks?: unknown;
  ports?: unknown;
  depends_on?: Record<string, { condition?: string }> | string[];
  environment?: Record<string, string> | string[];
  volumes?: unknown[];
}

interface ComposeFile {
  version?: unknown;
  name?: string;
  services?: Record<string, ComposeService>;
  networks?: Record<string, unknown>;
  volumes?: Record<string, unknown>;
}

function loadCompose(): ComposeFile {
  const raw = readFileSync(COMPOSE_PATH, "utf8");
  return parse(raw) as ComposeFile;
}

function networkNames(svc: ComposeService): string[] {
  const n = svc.networks;
  if (!n) return [];
  if (Array.isArray(n)) return n as string[];
  if (typeof n === "object") return Object.keys(n as Record<string, unknown>);
  return [];
}

describe("Phase 1 Plan 01: compose-schema", () => {
  it("Test 1: declares all ten services with verified image pins, healthchecks, and the openwhispr_internal network, and uses Compose Spec v2 (no version key)", () => {
    const compose = loadCompose();
    expect(compose.version).toBeUndefined();
    expect(compose.services).toBeDefined();
    const services = compose.services as Record<string, ComposeService>;

    for (const name of REQUIRED_SERVICES) {
      expect(services[name], `service ${name} missing`).toBeDefined();
      const svc = services[name];
      expect(svc.image, `service ${name} missing image`).toMatch(VERIFIED_IMAGE_PINS[name]);
      expect(svc.healthcheck, `service ${name} missing healthcheck`).toBeDefined();
      expect(networkNames(svc), `service ${name} not on openwhispr_internal`).toContain(
        "openwhispr_internal",
      );
    }
  });

  it("Test 2: only traefik publishes host ports", () => {
    const compose = loadCompose();
    const services = compose.services as Record<string, ComposeService>;
    for (const name of REQUIRED_SERVICES) {
      const svc = services[name];
      const ports = svc.ports;
      if (name === "traefik") {
        expect(Array.isArray(ports) && (ports as unknown[]).length > 0).toBe(true);
      } else {
        const hasPorts = Array.isArray(ports) && (ports as unknown[]).length > 0;
        expect(hasPorts, `service ${name} must not publish host ports`).toBe(false);
      }
    }
  });

  it("Test 3: pgbouncer depends on postgres being service_healthy", () => {
    const compose = loadCompose();
    const services = compose.services as Record<string, ComposeService>;
    const pgb = services.pgbouncer;
    expect(pgb).toBeDefined();
    const dep = pgb.depends_on;
    expect(dep && typeof dep === "object" && !Array.isArray(dep)).toBe(true);
    const depMap = dep as Record<string, { condition?: string }>;
    expect(depMap.postgres).toBeDefined();
    expect(depMap.postgres.condition).toBe("service_healthy");
  });

  it("Test 4: declares the seven named state volumes", () => {
    const compose = loadCompose();
    expect(compose.volumes).toBeDefined();
    const vols = compose.volumes as Record<string, unknown>;
    for (const v of REQUIRED_VOLUMES) {
      expect(vols[v], `volume ${v} not declared`).toBeDefined();
    }
  });

  it("Test 5: OTel Collector pipeline carries X-Scope-OrgID for Mimir", () => {
    const otelText = readFileSync(OTEL_CONFIG_PATH, "utf8");
    expect(otelText).toMatch(/X-Scope-OrgID/);
  });
});
