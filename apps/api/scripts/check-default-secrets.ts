#!/usr/bin/env node
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * apps/api/scripts/check-default-secrets.ts — defense-in-depth check
 * invoked by the API container ENTRYPOINT before `node dist/index.js`.
 *
 * Reads the same deny-list as `tools/bootstrap.sh`
 * (`tools/bootstrap/default-secrets.txt` by default; overridable via the
 * DENY_LIST_PATH env var). Exits non-zero if any REQUIRED_KEY is unset or
 * matches the deny-list, naming the offending KEY (not its value) on
 * stderr. The two-layer model means an operator who skips bootstrap
 * still cannot ship `changeme` to production.
 *
 * Exit codes:
 *   0 — every REQUIRED_KEY is set to a non-deny-list value
 *   1 — at least one REQUIRED_KEY is unset or matches the deny-list
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the script directory in a way that survives both runtime modes:
//   - tsx (ESM) loads this file directly from source; import.meta.url is set.
//   - tsup --format cjs strips import.meta; we fall back to __dirname which
//     CJS provides natively at runtime (and which the bundle injects).
// Using a typeof guard keeps both paths first-class.
// Phase 52 / Plan 52-09 — biome 2.x flagged the old `biome-ignore`
// comments as unused because the underlying rules no longer fire on
// this construct (biome handles `globalThis.__dirname` and the
// `typeof __dirname !== "undefined"` guard natively). Strip the
// stale suppressions; runtime behaviour identical.
const here =
  typeof import.meta?.url === "string"
    ? dirname(fileURLToPath(import.meta.url))
    : ((globalThis as { __dirname?: string }).__dirname ??
      (typeof __dirname !== "undefined" ? __dirname : ""));

// In the container image the deny-list ships at /app/tools/bootstrap/default-secrets.txt
// (Dockerfile COPY). Local invocation (tsx, vitest) finds it via the
// monorepo-relative path. Operators can override via DENY_LIST_PATH.
const containerDenyPath = "/app/tools/bootstrap/default-secrets.txt";
const monorepoDenyPath = resolve(
  here,
  "..",
  "..",
  "..",
  "tools",
  "bootstrap",
  "default-secrets.txt",
);

const denyPath = resolve(
  process.env.DENY_LIST_PATH ?? (here.startsWith("/app") ? containerDenyPath : monorepoDenyPath),
);

const deny = readFileSync(denyPath, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith("#"));

// Compose-era key list: full 10-key contract assumed by the default
// docker-compose self-host profile. POSTGRES_*, PGBOUNCER_*, VALKEY_*,
// MINIO_*, TRAEFIK_*, GRAFANA_*, BACKUP_AGE_IDENTITY all originate from
// services the compose bundle stands up itself, so the entrypoint MUST
// refuse to start if any are unset or carry deny-list values.
const COMPOSE_REQUIRED_KEYS = [
  "POSTGRES_OWNER_PASSWORD",
  "POSTGRES_APP_PASSWORD",
  "PGBOUNCER_ADMIN_PASSWORD",
  "VALKEY_PASSWORD",
  "MINIO_ROOT_PASSWORD",
  "TRAEFIK_ADMIN_PASSWORD",
  "GRAFANA_ADMIN_PASSWORD",
  "MASTER_KEK",
  "BACKUP_AGE_IDENTITY",
  "BETTER_AUTH_SECRET",
] as const;

// K8s-mode key list: only the application-secret essentials the app
// process itself reads directly. Everything else (Postgres / Valkey /
// MinIO / Traefik / Grafana / age-backup) is operator-managed via
// Kubernetes Secrets bound to platform primitives outside this
// container's purview. MASTER_KEK + BETTER_AUTH_SECRET MUST still be
// enforced — they are the in-app crypto roots and a deny-list value
// here is a CRIT-FIX-class regression.
const K8S_REQUIRED_KEYS = ["MASTER_KEK", "BETTER_AUTH_SECRET"] as const;

// OPENWHISPR_DEPLOYMENT_MODE kill-switch (downstream Yambr fix).
// Case-insensitive + whitespace-tolerant — operators paste from kubectl
// describe / Helm values output where trailing newlines and capital-K
// variants are common-typo territory.
const deploymentMode = (process.env.OPENWHISPR_DEPLOYMENT_MODE ?? "").trim().toLowerCase();
const isK8sMode = deploymentMode === "k8s";

const REQUIRED_KEYS = isK8sMode ? K8S_REQUIRED_KEYS : COMPOSE_REQUIRED_KEYS;

// One-line stderr log of the chosen mode so operators can audit which
// gate the entrypoint applied. Written to stderr (fd 2) to preserve
// stdout for any downstream structured-log consumer.
process.stderr.write(`check-default-secrets: deployment mode = ${isK8sMode ? "k8s" : "compose"}\n`);

const offenders: string[] = [];
for (const k of REQUIRED_KEYS) {
  const v = process.env[k];
  if (v === undefined || v.length === 0 || deny.includes(v)) {
    offenders.push(k);
  }
}

if (offenders.length > 0) {
  for (const k of offenders) {
    process.stderr.write(`refusing to start: ${k} is unset or matches deny-list\n`);
  }
  process.exit(1);
}
