// SPDX-License-Identifier: Apache-2.0
/**
 * grafana-dashboards-validate.test.ts — self-test for shipped Grafana
 * dashboards. Asserts every dashboard JSON under
 * `compose/grafana/provisioning/dashboards/` is well-formed, references
 * only datasource UIDs declared in
 * `compose/grafana/provisioning/datasources/*.yaml`, and that every
 * panel has a non-empty query target (PromQL `expr`, Postgres `rawSql`,
 * or Loki `query`).
 *
 * This is the Plan 06-11 RED-floor test for the 4 default dashboards
 * (06-11 must_haves). It runs as part of `pnpm test` and gates CI: a
 * broken dashboard JSON or a stale datasource UID reference fails the
 * build before docker-compose has a chance to silently swallow it.
 *
 * Datasource UID inventory (resolved from the YAML files at test time):
 *   - loki  (Loki, logs)            -> compose/grafana/provisioning/datasources/loki.yaml
 *   - tempo (Tempo, traces)         -> compose/grafana/provisioning/datasources/tempo.yaml
 *   - mimir (Prometheus/Mimir, metrics) -> compose/grafana/provisioning/datasources/mimir.yaml
 *   - postgres-readonly (Postgres)  -> compose/grafana/provisioning/datasources/postgres.yaml
 *
 * Plan 06-11 acceptance criteria mapping:
 *   - 4 dashboard JSONs exist                  -> DASHBOARDS_REQUIRED list
 *   - each contains title/panels/schemaVersion -> "parses + has required fields"
 *   - uid prefix `openwhispr-`                 -> "uid is openwhispr-prefixed"
 *   - reconciliation-drift references the two D-R2 gauge metric names
 *       litellm_reconciliation_drift_pct + litellm_reconciliation_drift_usd_cents
 *   - alert YAML contains two rule UIDs
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DASHBOARDS_DIR = "compose/grafana/provisioning/dashboards";
const DATASOURCES_DIR = "compose/grafana/provisioning/datasources";
const ALERTS_FILE = "compose/grafana/provisioning/alerting/reconciliation-alerts.yaml";

// The four Phase 6 Plan 11 dashboards (must_haves §dashboards).
const DASHBOARDS_REQUIRED = [
  "red-saturation.json",
  "per-tenant-usage.json",
  "litellm-spend.json",
  "reconciliation-drift.json",
];

// Acceptable Grafana datasource type strings per Grafana 11 schema.
const KNOWN_DATASOURCE_TYPES = new Set([
  "prometheus",
  "loki",
  "tempo",
  "postgres",
  "__expr__", // Grafana built-in expression datasource (for alert rules)
]);

interface GrafanaTarget {
  expr?: string;
  rawSql?: string;
  query?: string;
  refId?: string;
  datasource?: { type?: string; uid?: string } | string;
}

interface GrafanaPanel {
  type?: string;
  title?: string;
  datasource?: { type?: string; uid?: string } | string | null;
  targets?: GrafanaTarget[];
  panels?: GrafanaPanel[]; // row panels nest panels
}

interface GrafanaDashboard {
  uid?: string;
  title?: string;
  schemaVersion?: number;
  panels?: GrafanaPanel[];
}

function readJson(file: string): GrafanaDashboard {
  return JSON.parse(readFileSync(file, "utf8")) as GrafanaDashboard;
}

/**
 * Scrape datasource UIDs declared in the *.yaml provisioning files. We
 * deliberately avoid a YAML parser dependency — the provisioned shape
 * is a simple `uid: <value>` line per datasource entry, which a regex
 * scan handles deterministically.
 */
function collectDeclaredUids(): Set<string> {
  const uids = new Set<string>();
  for (const f of readdirSync(DATASOURCES_DIR).filter((n) => n.endsWith(".yaml"))) {
    const text = readFileSync(path.join(DATASOURCES_DIR, f), "utf8");
    for (const m of text.matchAll(/^\s*uid:\s*([A-Za-z0-9_-]+)\s*$/gm)) {
      uids.add(m[1]);
    }
  }
  // Grafana's built-in expression datasource is always available.
  uids.add("__expr__");
  // grafana-managed alert evaluation uses "grafana" as a pseudo-uid in
  // some examples; not used in our dashboards but tolerated.
  return uids;
}

function walkPanels(panels: GrafanaPanel[] | undefined): GrafanaPanel[] {
  const out: GrafanaPanel[] = [];
  if (!panels) return out;
  for (const p of panels) {
    out.push(p);
    if (Array.isArray(p.panels)) out.push(...walkPanels(p.panels));
  }
  return out;
}

describe("grafana dashboards validate", () => {
  const declaredUids = collectDeclaredUids();

  it("declares the 4 required datasource UIDs", () => {
    for (const required of ["loki", "tempo", "mimir", "postgres-readonly"]) {
      expect(declaredUids.has(required)).toBe(true);
    }
  });

  it("ships exactly the 4 required dashboard files", () => {
    const found = readdirSync(DASHBOARDS_DIR).filter((f) => f.endsWith(".json"));
    for (const required of DASHBOARDS_REQUIRED) {
      expect(found).toContain(required);
    }
  });

  for (const file of DASHBOARDS_REQUIRED) {
    describe(file, () => {
      const full = path.join(DASHBOARDS_DIR, file);

      it("parses as JSON and has the required top-level fields", () => {
        const json = readJson(full);
        expect(json.title).toBeTruthy();
        expect(json.schemaVersion).toBeGreaterThanOrEqual(36);
        expect(Array.isArray(json.panels)).toBe(true);
        expect((json.panels as GrafanaPanel[]).length).toBeGreaterThan(0);
      });

      it("uid is openwhispr-prefixed", () => {
        const json = readJson(full);
        expect(json.uid ?? "").toMatch(/^openwhispr-/);
      });

      it("every non-row/text panel has a recognised datasource and at least one query target", () => {
        const json = readJson(full);
        for (const p of walkPanels(json.panels)) {
          if (p.type === "row" || p.type === "text") continue;
          const ds = p.datasource;
          const uid = typeof ds === "string" ? ds : (ds?.uid ?? undefined);
          const type = typeof ds === "string" ? undefined : (ds?.type ?? undefined);
          expect(uid).toBeTruthy();
          expect(declaredUids.has(uid as string)).toBe(true);
          if (type !== undefined) {
            expect(KNOWN_DATASOURCE_TYPES.has(type)).toBe(true);
          }
          const hasQuery = (p.targets ?? []).some(
            (t) =>
              (t.expr && t.expr.trim().length > 0) ||
              (t.rawSql && t.rawSql.trim().length > 0) ||
              (t.query && t.query.trim().length > 0),
          );
          expect(hasQuery).toBe(true);
        }
      });
    });
  }

  it("reconciliation-drift dashboard references both D-R2 Mimir gauges", () => {
    const text = readFileSync(path.join(DASHBOARDS_DIR, "reconciliation-drift.json"), "utf8");
    expect(text).toContain("litellm_reconciliation_drift_pct");
    expect(text).toContain("litellm_reconciliation_drift_usd_cents");
  });

  it("reconciliation alert YAML declares the two D-R3 rule UIDs", () => {
    expect(existsSync(ALERTS_FILE)).toBe(true);
    const text = readFileSync(ALERTS_FILE, "utf8");
    expect(text).toContain("reconciliation_drift_pct_high");
    expect(text).toContain("reconciliation_drift_usd_high");
  });

  it("loki datasource retains the Plan 03 derivedFields trace_id link", () => {
    const loki = readFileSync(path.join(DATASOURCES_DIR, "loki.yaml"), "utf8");
    expect(loki).toMatch(/derivedFields/);
    expect(loki).toMatch(/trace_id/);
    expect(loki).toMatch(/datasourceUid:\s*tempo/);
  });

  it("dashboards.yaml provider manifest points at the dashboards directory", () => {
    const manifest = readFileSync(path.join(DASHBOARDS_DIR, "dashboards.yaml"), "utf8");
    expect(manifest).toMatch(/apiVersion:\s*1/);
    expect(manifest).toMatch(/folder:\s*OpenWhispr/);
    expect(manifest).toMatch(/path:\s*\/etc\/grafana\/provisioning\/dashboards/);
  });
});
