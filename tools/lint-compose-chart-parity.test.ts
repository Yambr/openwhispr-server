// SPDX-License-Identifier: Apache-2.0

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type Allowlist,
  CHART_KINDS,
  COMPOSE_SERVICE_ALIASES,
  collectComposeServices,
  computeParity,
  extractChartResources,
  extractComposeServices,
  flattenAllowlist,
  formatReport,
  isVariantCOnlyKey,
  main,
  renderChart,
  VARIANT_C_ONLY_KEYS,
} from "./lint-compose-chart-parity.js";

describe("CHART_KINDS", () => {
  it("includes the canonical workload kinds", () => {
    expect(CHART_KINDS.has("Deployment")).toBe(true);
    expect(CHART_KINDS.has("StatefulSet")).toBe(true);
    expect(CHART_KINDS.has("Job")).toBe(true);
    expect(CHART_KINDS.has("DaemonSet")).toBe(true);
    expect(CHART_KINDS.has("CronJob")).toBe(true);
  });

  it("includes CNPG CRDs (Cluster + Pooler) per Plan 09-05 A6", () => {
    expect(CHART_KINDS.has("Cluster")).toBe(true);
    expect(CHART_KINDS.has("Pooler")).toBe(true);
  });
});

describe("COMPOSE_SERVICE_ALIASES", () => {
  it("maps postgres compose service to CNPG Cluster resource suffix", () => {
    expect(COMPOSE_SERVICE_ALIASES.postgres).toBe("pg");
  });
  it("maps pgbouncer compose service to CNPG Pooler resource suffix", () => {
    expect(COMPOSE_SERVICE_ALIASES.pgbouncer).toBe("pg-pooler");
  });
});

describe("extractComposeServices", () => {
  it("returns top-level service names", () => {
    const yaml = `
services:
  api:
    image: a
  web:
    image: b
`;
    expect(extractComposeServices(yaml).sort()).toEqual(["api", "web"]);
  });

  it("returns empty array when no services key", () => {
    expect(extractComposeServices("version: '3'")).toEqual([]);
  });

  it("returns empty array on empty input", () => {
    expect(extractComposeServices("")).toEqual([]);
  });

  it("returns empty array when services is not an object", () => {
    expect(extractComposeServices("services: foo")).toEqual([]);
  });
});

describe("collectComposeServices", () => {
  it("unions services across multiple files", () => {
    const read = (f: string): string =>
      f === "a.yml"
        ? "services:\n  api: {}\n  web: {}\n"
        : "services:\n  api: {}\n  speaches: {}\n";
    const set = collectComposeServices(["a.yml", "b.yml"], read);
    expect([...set].sort()).toEqual(["api", "speaches", "web"]);
  });

  it("skips files that throw on read", () => {
    const read = (f: string): string => {
      if (f === "missing.yml") throw new Error("nope");
      return "services:\n  ok: {}\n";
    };
    const set = collectComposeServices(["missing.yml", "ok.yml"], read);
    expect([...set]).toEqual(["ok"]);
  });
});

describe("extractChartResources", () => {
  it("collects Deployment / StatefulSet / Job names and strips release prefix", () => {
    const stream = `---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ow-openwhispr-api
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ow-openwhispr-postgres
---
apiVersion: batch/v1
kind: Job
metadata:
  name: ow-openwhispr-migrate
---
apiVersion: v1
kind: Service
metadata:
  name: ow-openwhispr-api
`;
    expect([...extractChartResources(stream)].sort()).toEqual(["api", "migrate", "postgres"]);
  });

  it("ignores non-workload kinds", () => {
    const stream = `---
apiVersion: v1
kind: ConfigMap
metadata:
  name: ow-openwhispr-otel
---
apiVersion: v1
kind: Secret
metadata:
  name: ow-openwhispr-secrets
`;
    expect([...extractChartResources(stream)]).toEqual([]);
  });

  it("ignores documents without metadata.name", () => {
    const stream = `---
apiVersion: apps/v1
kind: Deployment
spec: {}
`;
    expect([...extractChartResources(stream)]).toEqual([]);
  });

  it("skips null documents (leading separator etc.)", () => {
    const stream =
      "---\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ow-openwhispr-x\n";
    expect([...extractChartResources(stream)]).toEqual(["x"]);
  });
});

describe("flattenAllowlist", () => {
  it("ignores _comment keys at top level", () => {
    const al: Allowlist = {
      _comment: { _comment: "top-level comment" },
      "test-only": { services: ["fixture-idp", "seed"] },
      "cluster-prereq": { services: ["traefik"] },
    };
    expect([...flattenAllowlist(al)].sort()).toEqual(["fixture-idp", "seed", "traefik"]);
  });

  it("handles missing services arrays", () => {
    const al: Allowlist = { foo: {} };
    expect([...flattenAllowlist(al)]).toEqual([]);
  });
});

describe("computeParity", () => {
  it("returns no missing when every compose service is in chart or allowlist", () => {
    const compose = new Set(["api", "web", "traefik", "seed"]);
    const chart = new Set(["api", "web"]);
    const allow = new Set(["traefik", "seed"]);
    const r = computeParity(compose, chart, allow);
    expect(r.missing).toEqual([]);
    expect(r.allowlisted.sort()).toEqual(["seed", "traefik"]);
  });

  it("flags services missing from both chart and allowlist", () => {
    const compose = new Set(["api", "quibblr"]);
    const chart = new Set(["api"]);
    const allow = new Set<string>();
    const r = computeParity(compose, chart, allow);
    expect(r.missing).toEqual(["quibblr"]);
  });

  it("sorts each output array deterministically", () => {
    const compose = new Set(["z", "a", "m"]);
    const chart = new Set<string>();
    const allow = new Set(["z", "a"]);
    const r = computeParity(compose, chart, allow);
    expect(r.composeServices).toEqual(["a", "m", "z"]);
    expect(r.allowlisted).toEqual(["a", "z"]);
    expect(r.missing).toEqual(["m"]);
  });

  it("resolves postgres -> pg via COMPOSE_SERVICE_ALIASES without allowlisting", () => {
    const compose = new Set(["postgres"]);
    const chart = new Set(["pg"]); // CNPG Cluster name suffix
    const allow = new Set<string>();
    const r = computeParity(compose, chart, allow);
    expect(r.missing).toEqual([]);
    expect(r.allowlisted).toEqual([]);
  });

  it("resolves pgbouncer -> pg-pooler via COMPOSE_SERVICE_ALIASES", () => {
    const compose = new Set(["pgbouncer"]);
    const chart = new Set(["pg-pooler"]);
    const allow = new Set<string>();
    const r = computeParity(compose, chart, allow);
    expect(r.missing).toEqual([]);
    expect(r.allowlisted).toEqual([]);
  });

  it("falls back to allowlist when no alias mapping exists for compose service", () => {
    const compose = new Set(["traefik"]);
    const chart = new Set<string>();
    const allow = new Set(["traefik"]);
    const r = computeParity(compose, chart, allow);
    expect(r.allowlisted).toEqual(["traefik"]);
    expect(r.missing).toEqual([]);
  });
});

describe("formatReport", () => {
  it("includes a PASS line when no missing services", () => {
    const r = formatReport({
      composeServices: ["api"],
      chartResources: ["api"],
      allowlisted: [],
      missing: [],
    });
    expect(r).toContain("Result: PASS");
  });

  it("includes a FAIL line with missing names", () => {
    const r = formatReport({
      composeServices: ["api", "x"],
      chartResources: ["api"],
      allowlisted: [],
      missing: ["x"],
    });
    expect(r).toContain("Result: FAIL");
    expect(r).toContain("x");
  });
});

describe("renderChart", () => {
  it("invokes helm with the passed argv", () => {
    let captured: string[] = [];
    const fake = (_cmd: string, args: string[]): string => {
      captured = args;
      return "";
    };
    renderChart(["template", "ow", "charts/openwhispr"], fake);
    expect(captured[0]).toBe("template");
  });
});

describe("main (integration with mocked helm)", () => {
  it("returns 0 when every compose service is in chart or allowlist", () => {
    const helmStream = `---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ow-openwhispr-api
`;
    const code = main({
      composeFiles: ["fixture-compose.yml"],
      allowlistPath: "fixture-allow.json",
      helmRunner: () => helmStream,
      exists: () => true,
      read: (f: string) => {
        if (f === "fixture-compose.yml") {
          return "services:\n  api: {}\n  traefik: {}\n";
        }
        return JSON.stringify({
          "cluster-prereq": { services: ["traefik"] },
        });
      },
    });
    expect(code).toBe(0);
  });

  it("returns 1 when an unallowed compose service is missing from chart", () => {
    const helmStream =
      "---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ow-openwhispr-api\n";
    const code = main({
      composeFiles: ["fixture-compose.yml"],
      allowlistPath: "fixture-allow.json",
      helmRunner: () => helmStream,
      exists: () => true,
      read: (f: string) => {
        if (f === "fixture-compose.yml") {
          return "services:\n  api: {}\n  quibblr: {}\n";
        }
        return JSON.stringify({});
      },
    });
    expect(code).toBe(1);
  });

  it("handles missing allowlist file gracefully (treats as empty)", () => {
    const helmStream =
      "---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ow-openwhispr-api\n";
    const code = main({
      composeFiles: ["fixture-compose.yml"],
      allowlistPath: "missing.json",
      helmRunner: () => helmStream,
      exists: (f: string) => f === "fixture-compose.yml",
      read: (f: string) => {
        if (f === "fixture-compose.yml") return "services:\n  api: {}\n";
        throw new Error("should not read missing allowlist");
      },
    });
    expect(code).toBe(0);
  });

  it("smoke: against real repo compose + allowlist + chart, exits 0", () => {
    // This is the canonical integration test — exercises the real binaries.
    const code = main();
    expect(code).toBe(0);
  }, 60_000);

  // Plan 11-01 — Variant A parity: the new docker-compose.embedded-litellm.yml
  // must agree with values-embedded-litellm.yaml without drift. Service-level
  // chart resource names are values-independent (Deployment / StatefulSet
  // names are derived from .Release.Name + chart resource), so swapping the
  // compose file is the meaningful axis. We re-use the canonical DEFAULT_HELM_ARGS
  // template render but point composeFiles at the new Variant A file.
  it("variant A parity: docker-compose.embedded-litellm.yml has no drift against chart", () => {
    const code = main({
      composeFiles: ["compose/docker-compose.embedded-litellm.yml"],
    });
    expect(code).toBe(0);
  }, 60_000);

  // Plan 11-01 — Variant C scope guard. The variant-C overlay
  // `examples/docker-compose.local-speaches.yml` is owned by Plan 11-03;
  // skip the assertion when the file is not yet present so this case
  // green-passes during the 11-01 wave and starts asserting once 11-03
  // lands the overlay.
  it("variant C scope: local-speaches overlay parity (skip if 11-03 has not landed)", () => {
    const variantCFile = "examples/docker-compose.local-speaches.yml";
    if (!existsSync(variantCFile)) {
      expect(true).toBe(true);
      return;
    }
    const code = main({
      composeFiles: [variantCFile],
    });
    expect(code).toBe(0);
  }, 60_000);
});

describe("VARIANT_C_ONLY_KEYS (Plan 11-01)", () => {
  it("contains HF_TOKEN", () => {
    expect(VARIANT_C_ONLY_KEYS.has("HF_TOKEN")).toBe(true);
  });

  it("does not contain any non-Variant-C key", () => {
    expect(VARIANT_C_ONLY_KEYS.has("LITELLM_MASTER_KEY")).toBe(false);
    expect(VARIANT_C_ONLY_KEYS.has("OPENROUTER_API_KEY")).toBe(false);
    expect(VARIANT_C_ONLY_KEYS.has("POSTGRES_OWNER_PASSWORD")).toBe(false);
  });
});

describe("isVariantCOnlyKey", () => {
  it("returns true for HF_TOKEN", () => {
    expect(isVariantCOnlyKey("HF_TOKEN")).toBe(true);
  });

  it("returns false for keys present in every variant", () => {
    expect(isVariantCOnlyKey("LITELLM_MASTER_KEY")).toBe(false);
    expect(isVariantCOnlyKey("BETTER_AUTH_SECRET")).toBe(false);
  });

  it("returns false for an arbitrary unrelated key", () => {
    expect(isVariantCOnlyKey("FOO_BAR")).toBe(false);
  });
});
