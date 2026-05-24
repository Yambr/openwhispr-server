// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 20 / Plan 20-01 — SR-20.1 + SR-20.2 guardrail lint.
//
// Audits every long-running compose service across the canonical compose
// file matrix and emits violations for any of:
//
//   R1-MISSING-MEMORY-LIMIT — service lacks deploy.resources.limits.memory
//   R2-MISSING-RESTART      — service lacks an acceptable `restart:` policy
//                             (unless-stopped / always / on-failure)
//   R3-MEMORY-BELOW-FLOOR   — service memory limit declared but below the
//                             ROADMAP-locked floor for that service name
//
// Short-lived services (one-shots, test bots, build-only fixtures) are
// exempt via SHORT_LIVED_ALLOWLIST. The lint runs as a vitest case
// (tools/lint-compose-resources.test.ts) so the regression fails at
// pre-commit / CI BEFORE any compose stack boot, and as a CLI for
// human-readable reports.
//
// Repo-root resolution: defaults to walking up from this file's location.
// Tests inject a custom root for synthetic-fixture coverage.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export interface Violation {
  readonly code: "R1-MISSING-MEMORY-LIMIT" | "R2-MISSING-RESTART" | "R3-MEMORY-BELOW-FLOOR";
  readonly file: string;
  readonly service: string;
  readonly message: string;
}

/**
 * Canonical compose file list audited by the lint. Per the 20-01 plan's
 * <interfaces> block — every long-running service across these 10 files
 * MUST declare deploy.resources.limits.memory + restart: unless-stopped.
 */
export const COMPOSE_FILES: readonly string[] = [
  "docker-compose.yml",
  "compose/docker-compose.ingress.yml",
  "compose/docker-compose.pgbouncer.yml",
  "compose/docker-compose.storage.yml",
  "compose/docker-compose.observability.yml",
  "compose/docker-compose.embedded-litellm.yml",
  "compose/docker-compose.load-test.yml",
  "compose/docker-compose.load-test.realistic.yml",
  "compose/e2e/docker-compose.e2e.yml",
  "compose/live-soak/docker-compose.live.yml",
];

/**
 * Short-lived service names exempt from R1/R2/R3. Sourced from the 20-01
 * plan's <interfaces> block plus the in-tree compose files (one-shots /
 * test bots / build-only fixtures).
 */
export const SHORT_LIVED_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  "migrate",
  "seed",
  "contract-test-runner",
  "fixture-idp",
  "k6",
  "mailpit",
  "speaches",
  "mock-realtime",
  "cjm-runner",
]);

/**
 * ROADMAP-locked memory floors (bytes). Services not listed have no
 * floor — R1/R2 still apply, R3 is skipped. Values from 20-01 PLAN
 * <interfaces> recommended-write-values table.
 */
export const MEMORY_FLOORS_BYTES: Readonly<Record<string, number>> = {
  postgres: 2 * 1024 ** 3,
  // Raised 1G→1.5G on 2026-05-24 — CI red-sweep evidence: with
  // num_workers=2 and post-R31 stale-pycache deletion, uvicorn child
  // workers OOM-kill at peak boot (985 MiB / 1 GiB observed locally
  // during prisma migrate deploy + child re-spawn loop). The
  // harness-self-check `migrate-gates-api.test.ts` reported
  // `container openwhispr-self-test-litellm-1 is unhealthy` because the
  // worker never bound :4000 long enough for `/health/liveliness`.
  // Floor lives in lockstep with `charts/openwhispr/templates/litellm-
  // deployment.yaml` `resources.limits.memory` (cross-checked by
  // lint-compose-chart-parity).
  litellm: Math.floor(1.5 * 1024 ** 3),
  api: 1 * 1024 ** 3,
  worker: 512 * 1024 ** 2,
  web: 384 * 1024 ** 2,
  loki: 512 * 1024 ** 2,
  tempo: 512 * 1024 ** 2,
  mimir: 512 * 1024 ** 2,
  grafana: 256 * 1024 ** 2,
  "otel-collector": 256 * 1024 ** 2,
};

const ACCEPTABLE_RESTART = new Set<string>(["unless-stopped", "always", "on-failure"]);

/**
 * Parse a Docker Compose memory string into bytes. Accepts SI units
 * (k/m/g/t/kb/mb/gb/tb) and IEC units (ki/mi/gi/ti). Compose itself
 * accepts these per `man docker-compose.yml` § deploy.resources.
 */
export function parseMemoryString(s: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(b|k|m|g|t|kb|mb|gb|tb|ki|mi|gi|ti)?$/i.exec(s.trim());
  if (!m) {
    throw new Error(`unparseable memory: ${s}`);
  }
  const n = parseFloat(m[1]);
  const unit = (m[2] || "b").toLowerCase();
  const mults: Record<string, number> = {
    b: 1,
    k: 1024,
    m: 1024 ** 2,
    g: 1024 ** 3,
    t: 1024 ** 4,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    tb: 1024 ** 4,
    ki: 1024,
    mi: 1024 ** 2,
    gi: 1024 ** 3,
    ti: 1024 ** 4,
  };
  const mult = mults[unit];
  return Math.floor(n * mult);
}

function readYamlSafe(path: string): unknown {
  try {
    return parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

interface ParsedService {
  readonly restart?: unknown;
  readonly deploy?: { resources?: { limits?: { memory?: unknown } } };
}

function auditFile(repoRoot: string, rel: string): Violation[] {
  const out: Violation[] = [];
  const fullPath = resolve(repoRoot, rel);
  const doc = readYamlSafe(fullPath);
  if (!doc || typeof doc !== "object") {
    return out;
  }
  const services = (doc as { services?: Record<string, unknown> }).services;
  if (!services || typeof services !== "object") {
    return out;
  }
  for (const [name, raw] of Object.entries(services)) {
    if (SHORT_LIVED_ALLOWLIST.has(name)) {
      continue;
    }
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const svc = raw as ParsedService;
    // Short-lived sentinel: explicit `restart: "no"` exempts the service
    // from R1/R2/R3 too (one-shots like migrate already use this).
    if (svc.restart === "no" || svc.restart === false) {
      continue;
    }
    // R2 — restart policy
    if (typeof svc.restart !== "string" || !ACCEPTABLE_RESTART.has(svc.restart)) {
      out.push({
        code: "R2-MISSING-RESTART",
        file: rel,
        service: name,
        message: `service '${name}' missing restart: unless-stopped (or always / on-failure)`,
      });
    }
    // R1 — memory limit
    const memRaw = svc.deploy?.resources?.limits?.memory;
    if (memRaw === undefined || memRaw === null) {
      out.push({
        code: "R1-MISSING-MEMORY-LIMIT",
        file: rel,
        service: name,
        message: `service '${name}' missing deploy.resources.limits.memory`,
      });
      continue;
    }
    // R3 — floor check
    const floor = MEMORY_FLOORS_BYTES[name];
    if (floor !== undefined) {
      const bytes = parseMemoryString(String(memRaw));
      if (bytes < floor) {
        out.push({
          code: "R3-MEMORY-BELOW-FLOOR",
          file: rel,
          service: name,
          message: `service '${name}' memory ${String(memRaw)} below floor ${(
            floor / 1024 ** 2
          ).toFixed(0)}Mi`,
        });
      }
    }
  }
  return out;
}

/**
 * Audit the repo's compose tree against SR-20.1 (deploy.resources.limits)
 * and SR-20.2 (restart: unless-stopped). Returns a list of violations;
 * empty array means clean.
 */
export function auditComposeResources(repoRoot: string): Violation[] {
  const out: Violation[] = [];
  for (const rel of COMPOSE_FILES) {
    out.push(...auditFile(repoRoot, rel));
  }
  return out;
}

export function findRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // tools/ sits at the repo root, so the file's parent IS the root.
  return resolve(here, "..");
}

/* c8 ignore start */
// CLI entrypoint: print violations + exit non-zero. Mirrors
// tools/lint-traefik-routes.ts shape.
if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = auditComposeResources(findRepoRoot());
  if (violations.length === 0) {
    console.log("lint-compose-resources: clean");
    process.exit(0);
  }
  for (const v of violations) {
    console.error(`${v.file}: [${v.code}] ${v.message}`);
  }
  process.exit(1);
}
/* c8 ignore stop */
