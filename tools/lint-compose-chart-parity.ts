#!/usr/bin/env tsx
// SPDX-License-Identifier: Apache-2.0
/**
 * lint-compose-chart-parity.ts — DEPLOY-02 parity gate.
 *
 * Reads docker-compose.yml (+ load-test variants), enumerates service names,
 * shells out to `helm template` against charts/openwhispr/ to render every
 * chart manifest with bundledAi.enabled=true (covers conditional templates),
 * extracts Deployment / StatefulSet / Job / DaemonSet / CronJob names,
 * and asserts a 1:1 mapping minus an explicit allowlist.
 *
 * Exit codes:
 *   0  — all compose services are either in the chart or in the allowlist
 *   1  — at least one compose service is missing from both
 *
 * Per CLAUDE.md "no internal mocks" rule: tests mock only the
 * child_process.execFileSync + readFileSync boundaries.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parse, parseAllDocuments } from "yaml";

export const DEFAULT_COMPOSE_FILES = [
  "docker-compose.yml",
  "docker-compose.load-test.yml",
  "docker-compose.load-test.realistic.yml",
];

export const DEFAULT_HELM_ARGS = [
  "template",
  "ow",
  "charts/openwhispr",
  "-f",
  ".github/ci/values-ci.yaml",
  "--set",
  "bundledAi.enabled=true",
  // Plan 09-10 (Wave 3): exercise the OTel Collector DaemonSet path so the
  // parity gate sees `otel-collector` as a chart resource. Values-ci leaves
  // collector.enabled=false (kind hostNetwork friction); the lint overrides
  // it here to flip the DaemonSet on and validates compose-vs-chart parity.
  "--set",
  "observability.collector.enabled=true",
  "--set-string",
  "observability.lgtm.endpoint=https://otlp.parity-fake.example.com",
  "--set-string",
  "secrets.litellmMasterKey=parity-fake-1234567890abcdef1234567890",
  "--set-string",
  "secrets.openrouterApiKey=parity-fake-1234567890abcdef1234567890",
  "--set-string",
  "secrets.openaiApiKey=parity-fake-1234567890abcdef1234567890",
  "--set-string",
  "secrets.pyannoteApiKey=parity-fake-1234567890abcdef1234567890",
  "--set-string",
  "secrets.hfToken=parity-fake-1234567890abcdef1234567890",
  "--set-string",
  "secrets.postgresOwnerPassword=parity-fake-1234567890abcdef1234567890",
  "--set-string",
  "secrets.pgbouncerAdminPassword=parity-fake-1234567890abcdef1234567890",
  "--set-string",
  "secrets.betterAuthSecret=parity-fake-1234567890abcdef1234567890",
];

export const CHART_KINDS = new Set([
  "Deployment",
  "StatefulSet",
  "Job",
  "DaemonSet",
  "CronJob",
  // CloudNativePG CRDs that materialize as workload-equivalent resources
  // (the operator turns these into StatefulSets / Deployments at runtime).
  // Added in Plan 09-05 so the parity gate "sees" postgres + pgbouncer
  // as covered by chart resources rather than allowlisted forever.
  "Cluster",
  "Pooler",
]);

/**
 * Map a compose service name to the chart resource suffix it should match.
 * Used when the chart resource is a CRD whose naming convention differs from
 * the compose service name (Plan 09-05 A6: pgbouncer compose service maps to
 * a CNPG Pooler CR named `<fullname>-pg-pooler`, suffix `pg-pooler`).
 *
 * Right-hand side is the resource suffix AFTER the `<release>-openwhispr-`
 * prefix has been stripped by extractChartResources().
 */
export const COMPOSE_SERVICE_ALIASES: Record<string, string> = {
  postgres: "pg",
  pgbouncer: "pg-pooler",
  // Bitnami valkey sub-chart materializes the primary StatefulSet at
  // `<release>-valkey-primary`; map the compose service to that suffix.
  valkey: "valkey-primary",
};

export interface Allowlist {
  [category: string]: { _comment?: string; services?: string[] };
}

/** Extract service names from a single docker-compose file (top-level `services:`). */
export function extractComposeServices(yamlText: string): string[] {
  const doc = parse(yamlText) as { services?: Record<string, unknown> } | undefined;
  if (!doc || !doc.services || typeof doc.services !== "object") return [];
  return Object.keys(doc.services);
}

/** Collect the union of services across multiple compose files. */
export function collectComposeServices(
  files: string[],
  read: (f: string) => string = (f) => readFileSync(f, "utf8"),
): Set<string> {
  const all = new Set<string>();
  for (const f of files) {
    try {
      for (const s of extractComposeServices(read(f))) all.add(s);
    } catch {
      // file missing / unparseable -> skip
    }
  }
  return all;
}

/** Extract chart resource names (stripped of `<release>-` prefix). */
export function extractChartResources(helmStdout: string, releaseName = "ow"): Set<string> {
  const docs = parseAllDocuments(helmStdout);
  const out = new Set<string>();
  for (const d of docs) {
    const json = d.toJSON() as { kind?: string; metadata?: { name?: string } } | null;
    if (!json) continue;
    if (!json.kind || !CHART_KINDS.has(json.kind)) continue;
    let name = json.metadata?.name ?? "";
    const prefix = `${releaseName}-openwhispr-`;
    const altPrefix = `${releaseName}-`;
    if (name.startsWith(prefix)) {
      // First-party chart resource: strip "<release>-openwhispr-" entirely.
      name = name.slice(prefix.length);
    } else if (name.startsWith(altPrefix)) {
      // Sub-chart resource (e.g. Bitnami valkey/minio): strip only the
      // "<release>-" prefix so "ow-minio" -> "minio" matches compose service
      // names. We keep the rest verbatim so multi-resource sub-charts
      // (e.g. ow-valkey-primary, ow-valkey-headless) remain distinguishable.
      name = name.slice(altPrefix.length);
    }
    if (name) out.add(name);
  }
  return out;
}

/** Flatten allowlist to a single Set of service names. */
export function flattenAllowlist(a: Allowlist): Set<string> {
  const set = new Set<string>();
  for (const [k, v] of Object.entries(a)) {
    if (k.startsWith("_")) continue;
    for (const s of v.services ?? []) set.add(s);
  }
  return set;
}

/** Render the chart and return the templated YAML stream. */
export function renderChart(
  helmArgs: string[] = DEFAULT_HELM_ARGS,
  runner: (cmd: string, args: string[]) => string = defaultHelmRunner,
): string {
  return runner("helm", helmArgs);
}

/* c8 ignore start — real binary; integration-tested in main() smoke */
const defaultHelmRunner = (cmd: string, args: string[]): string =>
  execFileSync(cmd, args, { encoding: "utf8" });
/* c8 ignore stop */

export interface ParityReport {
  composeServices: string[];
  chartResources: string[];
  allowlisted: string[];
  missing: string[];
}

/** Compute the parity diff. */
export function computeParity(
  composeServices: Set<string>,
  chartResources: Set<string>,
  allowlist: Set<string>,
): ParityReport {
  const allowlisted: string[] = [];
  const missing: string[] = [];
  for (const svc of composeServices) {
    if (chartResources.has(svc)) continue;
    const alias = COMPOSE_SERVICE_ALIASES[svc];
    if (alias && chartResources.has(alias)) continue;
    if (allowlist.has(svc)) {
      allowlisted.push(svc);
      continue;
    }
    missing.push(svc);
  }
  return {
    composeServices: [...composeServices].sort(),
    chartResources: [...chartResources].sort(),
    allowlisted: allowlisted.sort(),
    missing: missing.sort(),
  };
}

export function formatReport(r: ParityReport): string {
  const parts: string[] = [];
  parts.push(`Compose services: ${r.composeServices.length}`);
  parts.push(`Chart resources:  ${r.chartResources.length}`);
  parts.push(`Allowlisted:      ${r.allowlisted.length} (${r.allowlisted.join(", ")})`);
  if (r.missing.length === 0) {
    parts.push("Result: PASS — every compose service has a chart resource or allowlist entry.");
  } else {
    parts.push(`Result: FAIL — Missing chart resource(s): ${r.missing.join(", ")}`);
  }
  return parts.join("\n");
}

export interface MainOpts {
  composeFiles?: string[];
  allowlistPath?: string;
  helmArgs?: string[];
  helmRunner?: (cmd: string, args: string[]) => string;
  read?: (f: string) => string;
  exists?: (f: string) => boolean;
}

export function main(opts: MainOpts = {}): number {
  const composeFiles = opts.composeFiles ?? DEFAULT_COMPOSE_FILES;
  const allowlistPath = opts.allowlistPath ?? "tools/compose-chart-parity.allowlist.json";
  const helmArgs = opts.helmArgs ?? DEFAULT_HELM_ARGS;
  const read = opts.read ?? ((f: string) => readFileSync(f, "utf8"));
  const exists = opts.exists ?? existsSync;

  const compose = collectComposeServices(
    composeFiles.filter((f) => exists(f)),
    read,
  );
  let allowlist = new Set<string>();
  if (exists(allowlistPath)) {
    const raw = JSON.parse(read(allowlistPath)) as Allowlist;
    allowlist = flattenAllowlist(raw);
  }
  const helmOut = renderChart(helmArgs, opts.helmRunner ?? defaultHelmRunner);
  const chart = extractChartResources(helmOut);
  const report = computeParity(compose, chart, allowlist);
  process.stdout.write(`${formatReport(report)}\n`);
  return report.missing.length === 0 ? 0 : 1;
}

/* c8 ignore start */
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  process.exit(main());
}
/* c8 ignore stop */
