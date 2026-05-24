// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick-task 260524-u00 / Task F5 — chart-render regression guards.
//
// These tests catch the F1-class bug found in chart 1.0.6 (published before
// these tests existed): production code reads an env var that the chart
// silently fails to project, and a feature (in F1's case, POST /api/setup/
// admin first-run admin onboarding) 404s in production with no startup
// error.
//
// We assert the rendered api Deployment env block contains every env var
// the production api code requires for full route registration. The
// negative-space is anchored: any future chart edit that removes one of
// these projections fails this test BEFORE the chart hits OCI.
//
// Scope: openwhispr-server chart only. Worker / web have parallel render
// tests when their own equivalent bugs are found.
//
// Why vitest + execFileSync over a custom shell script: this repo already
// has tools/lint-compose-chart-parity.test.ts as the canonical
// shell-out-and-parse pattern. Keeping the same convention reduces test-
// infra cognitive load and lets `pnpm test` run it alongside everything
// else.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAllDocuments } from "yaml";

const REPO_ROOT = resolve(__dirname, "..");
const CHART_PATH = "charts/openwhispr-server";
const VALUES_YAMBR = "charts/openwhispr-server/examples/values-yambr.yaml";

interface K8sResource {
  kind?: string;
  metadata?: { name?: string };
  spec?: {
    template?: {
      spec?: {
        containers?: Array<{
          name?: string;
          env?: Array<{
            name?: string;
            value?: string;
            valueFrom?: { secretKeyRef?: { name?: string; key?: string } };
          }>;
        }>;
      };
    };
  };
}

function renderChartWithYambrValues(): K8sResource[] {
  const stdout = execFileSync("helm", ["template", "ow", CHART_PATH, "-f", VALUES_YAMBR], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseAllDocuments(stdout)
    .map((d) => d.toJSON() as K8sResource | null)
    .filter((d): d is K8sResource => d !== null && d.kind !== undefined);
}

function findContainer(
  resources: K8sResource[],
  workloadName: string,
  containerName: string,
): K8sResource["spec"] extends infer S
  ? S extends { template?: { spec?: { containers?: infer C } } }
    ? C extends Array<infer Container>
      ? Container | undefined
      : never
    : never
  : never {
  const workload = resources.find(
    (r) => r.kind === "Deployment" && r.metadata?.name === workloadName,
  );
  // biome-ignore lint/suspicious/noExplicitAny: the K8sResource container shape is structural
  return workload?.spec?.template?.spec?.containers?.find(
    (c: any) => c.name === containerName,
  ) as any;
}

describe("chart 1.0.7+ api Deployment env block — regression guards", () => {
  // Render once; reuse across all assertions. helm template is ~200ms but
  // the test file is small enough that one render keeps the test fast.
  const resources = renderChartWithYambrValues();

  it("renders the api Deployment (sanity check)", () => {
    const apiDeployment = resources.find(
      (r) => r.kind === "Deployment" && r.metadata?.name === "ow-openwhispr-server-api",
    );
    expect(apiDeployment).toBeDefined();
  });

  it("F1 regression guard: api Deployment env projects DATABASE_URL_OWNER from ownerUrlSecretRef", () => {
    // F1 bug: chart 1.0.5-1.0.6 omitted this projection. apps/api/src/
    // index.ts:1066 reads process.env.DATABASE_URL_OWNER; when undefined,
    // probeOwnerPool resolves undefined; routes/index.ts:511 skips
    // buildSetupAdminRoutes; POST /api/setup/admin returns 404; first-
    // run admin onboarding wizard at /setup is unrecoverable without
    // kubectl exec corrective SQL. Live prod evidence at
    // openwhispr.yambr.com 2026-05-24.
    const api = findContainer(resources, "ow-openwhispr-server-api", "api");
    expect(api).toBeDefined();
    // biome-ignore lint/suspicious/noExplicitAny: structural lookup
    const env = (api as any).env as Array<{
      name: string;
      valueFrom?: { secretKeyRef?: { name: string; key: string } };
    }>;
    const dbOwner = env.find((e) => e.name === "DATABASE_URL_OWNER");
    expect(dbOwner).toBeDefined();
    expect(dbOwner?.valueFrom?.secretKeyRef?.name).toBe("openwhispr-database");
    expect(dbOwner?.valueFrom?.secretKeyRef?.key).toBe("owner-url");
  });

  it("api Deployment env still projects DATABASE_URL (pre-existing, regression guard)", () => {
    const api = findContainer(resources, "ow-openwhispr-server-api", "api");
    // biome-ignore lint/suspicious/noExplicitAny: structural lookup
    const env = (api as any).env as Array<{ name: string }>;
    expect(env.some((e) => e.name === "DATABASE_URL")).toBe(true);
  });

  it("api Deployment env projects VALKEY_URL (chart 1.0.6+ A4)", () => {
    const api = findContainer(resources, "ow-openwhispr-server-api", "api");
    // biome-ignore lint/suspicious/noExplicitAny: structural lookup
    const env = (api as any).env as Array<{ name: string }>;
    expect(env.some((e) => e.name === "VALKEY_URL")).toBe(true);
  });

  it("api Deployment env projects LITELLM_BASE_URL + LITELLM_MASTER_KEY", () => {
    const api = findContainer(resources, "ow-openwhispr-server-api", "api");
    // biome-ignore lint/suspicious/noExplicitAny: structural lookup
    const env = (api as any).env as Array<{ name: string }>;
    expect(env.some((e) => e.name === "LITELLM_BASE_URL")).toBe(true);
    expect(env.some((e) => e.name === "LITELLM_MASTER_KEY")).toBe(true);
  });

  it("worker Deployment env projects DATABASE_URL_OWNER (chart 1.0.6 B2)", () => {
    const worker = findContainer(resources, "ow-openwhispr-server-worker", "worker");
    expect(worker).toBeDefined();
    // biome-ignore lint/suspicious/noExplicitAny: structural lookup
    const env = (worker as any).env as Array<{ name: string }>;
    expect(env.some((e) => e.name === "DATABASE_URL_OWNER")).toBe(true);
    expect(env.some((e) => e.name === "VALKEY_URL")).toBe(true);
  });

  it("ConfigMap bakes OPENWHISPR_DEPLOYMENT_MODE=k8s (chart 1.0.6 B3b)", () => {
    const cm = resources.find(
      (r) => r.kind === "ConfigMap" && r.metadata?.name === "ow-openwhispr-server-config",
    );
    expect(cm).toBeDefined();
    // biome-ignore lint/suspicious/noExplicitAny: structural lookup
    expect((cm as any).data?.OPENWHISPR_DEPLOYMENT_MODE).toBe("k8s");
  });

  it("worker Deployment uses correct CJS bundle pgrep path (chart 1.0.6 B1)", () => {
    const worker = findContainer(resources, "ow-openwhispr-server-worker", "worker");
    expect(worker).toBeDefined();
    // biome-ignore lint/suspicious/noExplicitAny: structural lookup
    const probes = (worker as any).startupProbe?.exec?.command as string[];
    expect(probes.join(" ")).toContain("/app/apps/worker/dist/index.cjs");
    // Negative assertion: old broken path absent
    expect(probes.join(" ")).not.toContain("node /app/dist/index.js");
  });
});
