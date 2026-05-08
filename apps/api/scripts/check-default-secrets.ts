#!/usr/bin/env node
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

const here = dirname(fileURLToPath(import.meta.url));

const denyPath = resolve(
  process.env.DENY_LIST_PATH ??
    resolve(here, "..", "..", "..", "tools", "bootstrap", "default-secrets.txt"),
);

const deny = readFileSync(denyPath, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith("#"));

const REQUIRED_KEYS = [
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
