// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 19b / SR-19b.1 — lint guard against the STRUCT-05 host-split
// regression (SERVER-ERRORS Entry 10).
//
// Detects the exact shape of the Phase 15 STRUCT-05 violation that
// shadowed the file-provider `api` router behind a docker-label `web`
// router on `Host(api.localhost)`:
//
//   V1 — docker-provider router targeting `web-svc` declares
//        Host(`api.localhost`) in its rule.
//   V2 — a docker-provider router pointing at `web-svc` has a rule that
//        does NOT contain Host(`web.localhost`) (catch-all guard).
//   V3 — compose/traefik/dynamic.dev.yml's `web-svc` loadBalancer.servers
//        url does not end in `:3000` (the web container's actual port per
//        apps/web/Dockerfile:110 `ENV PORT=3000`).
//   V4 — compose/traefik/dynamic.dev.yml is missing the canonical `web`
//        router declaration on Host(`web.localhost`).
//   V5 — compose/docker-compose.ingress.yml does not mount + load
//        dynamic.dev.yml. Either the volume mount is absent OR the
//        --providers.file.filename= single-file pin is still in place.
//
// The lint runs as a vitest case (tools/lint-traefik-routes.test.ts) so
// the regression fails at pre-commit / CI BEFORE any compose stack boot.
//
// Repo-root resolution: defaults to walking up from this file's location.
// Tests inject a custom root for synthetic-fixture coverage.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export interface Violation {
  readonly code: "V1" | "V2" | "V3" | "V4" | "V5";
  readonly file: string;
  readonly message: string;
}

const DOCKER_LABEL_ROUTER_RULE_RE = /^traefik\.http\.routers\.([\w-]+)\.rule\s*=\s*(.+)$/;
const DOCKER_LABEL_ROUTER_SERVICE_RE = /^traefik\.http\.routers\.([\w-]+)\.service\s*=\s*(.+)$/;

interface ComposeServiceLabels {
  readonly serviceName: string;
  readonly labels: readonly string[];
}

interface ParsedDockerRouter {
  readonly routerName: string;
  readonly rule: string;
  readonly service: string;
}

function readYamlSafe(path: string): unknown {
  try {
    return parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function collectServiceLabels(composeYaml: unknown): ComposeServiceLabels[] {
  if (!composeYaml || typeof composeYaml !== "object") return [];
  const services = (composeYaml as { services?: Record<string, unknown> }).services;
  if (!services || typeof services !== "object") return [];
  const out: ComposeServiceLabels[] = [];
  for (const [name, svcRaw] of Object.entries(services)) {
    if (!svcRaw || typeof svcRaw !== "object") continue;
    const labels = (svcRaw as { labels?: unknown }).labels;
    if (Array.isArray(labels)) {
      out.push({ serviceName: name, labels: labels.map(String) });
    }
  }
  return out;
}

function parseDockerRouters(svc: ComposeServiceLabels): ParsedDockerRouter[] {
  const ruleByRouter = new Map<string, string>();
  const serviceByRouter = new Map<string, string>();
  for (const label of svc.labels) {
    const ruleMatch = DOCKER_LABEL_ROUTER_RULE_RE.exec(label);
    if (ruleMatch) {
      ruleByRouter.set(ruleMatch[1], ruleMatch[2]);
      continue;
    }
    const svcMatch = DOCKER_LABEL_ROUTER_SERVICE_RE.exec(label);
    if (svcMatch) {
      serviceByRouter.set(svcMatch[1], svcMatch[2]);
    }
  }
  const out: ParsedDockerRouter[] = [];
  for (const [routerName, rule] of ruleByRouter) {
    const service = serviceByRouter.get(routerName) ?? "";
    out.push({ routerName, rule, service });
  }
  return out;
}

function auditDockerCompose(composePath: string): Violation[] {
  const out: Violation[] = [];
  const composeYaml = readYamlSafe(composePath);
  for (const svc of collectServiceLabels(composeYaml)) {
    const routers = parseDockerRouters(svc);
    for (const r of routers) {
      // Only audit routers whose `.service=` (or per-router fallback) points
      // at `web-svc`. Docker-label routers without an explicit `.service=`
      // implicitly bind to the declaring compose service of the same name;
      // for the web service the convention is `web-svc`, so we also match
      // routers declared on the `web` compose service.
      const targetsWebSvc =
        r.service === "web-svc" || (r.service === "" && svc.serviceName === "web");
      if (!targetsWebSvc) continue;
      if (r.rule.includes("Host(`api.localhost`)")) {
        out.push({
          code: "V1",
          file: composePath,
          message: `docker-label router '${r.routerName}' on service '${svc.serviceName}' targets web-svc with Host(\`api.localhost\`) — must use Host(\`web.localhost\`)`,
        });
      }
      if (!r.rule.includes("Host(`web.localhost`)")) {
        out.push({
          code: "V2",
          file: composePath,
          message: `docker-label router '${r.routerName}' targeting web-svc has rule missing Host(\`web.localhost\`): ${r.rule}`,
        });
      }
    }
  }
  return out;
}

function auditDynamicDev(dynamicDevPath: string): Violation[] {
  const out: Violation[] = [];
  const yamlContent = readYamlSafe(dynamicDevPath);
  if (!yamlContent || typeof yamlContent !== "object") {
    out.push({
      code: "V4",
      file: dynamicDevPath,
      message: "dynamic.dev.yml missing or unparseable — file provider has no web router",
    });
    return out;
  }
  const http = (yamlContent as { http?: unknown }).http;
  if (!http || typeof http !== "object") {
    out.push({
      code: "V4",
      file: dynamicDevPath,
      message: "dynamic.dev.yml missing top-level `http:` block",
    });
    return out;
  }
  const routers = (http as { routers?: Record<string, unknown> }).routers ?? {};
  const webRouter = routers.web;
  if (!webRouter || typeof webRouter !== "object") {
    out.push({
      code: "V4",
      file: dynamicDevPath,
      message: "dynamic.dev.yml missing `http.routers.web` declaration",
    });
  } else {
    const rule = (webRouter as { rule?: string }).rule ?? "";
    if (!rule.includes("Host(`web.localhost`)")) {
      out.push({
        code: "V4",
        file: dynamicDevPath,
        message: `dynamic.dev.yml \`http.routers.web.rule\` missing Host(\`web.localhost\`): ${rule}`,
      });
    }
  }
  const services = (http as { services?: Record<string, unknown> }).services ?? {};
  const webSvc = services["web-svc"];
  if (webSvc && typeof webSvc === "object") {
    const lb = (webSvc as { loadBalancer?: { servers?: Array<{ url?: string }> } }).loadBalancer;
    const servers = lb?.servers ?? [];
    for (const server of servers) {
      const url = server?.url ?? "";
      if (url && !url.endsWith(":3000")) {
        out.push({
          code: "V3",
          file: dynamicDevPath,
          message: `dynamic.dev.yml web-svc upstream url must end in :3000 (apps/web/Dockerfile ENV PORT=3000), got: ${url}`,
        });
      }
    }
  }
  return out;
}

function auditIngressOverlay(ingressPath: string): Violation[] {
  const out: Violation[] = [];
  const yamlContent = readYamlSafe(ingressPath);
  if (!yamlContent || typeof yamlContent !== "object") {
    out.push({
      code: "V5",
      file: ingressPath,
      message: "ingress overlay missing or unparseable",
    });
    return out;
  }
  const services = (yamlContent as { services?: Record<string, unknown> }).services ?? {};
  const traefik = services.traefik;
  if (!traefik || typeof traefik !== "object") {
    out.push({
      code: "V5",
      file: ingressPath,
      message: "ingress overlay missing `services.traefik`",
    });
    return out;
  }
  const volumes = (traefik as { volumes?: unknown }).volumes;
  const volumesList = Array.isArray(volumes) ? volumes.map(String) : [];
  const mountsDynamicDev = volumesList.some((v) => v.includes("dynamic.dev.yml"));
  if (!mountsDynamicDev) {
    out.push({
      code: "V5",
      file: ingressPath,
      message:
        "ingress overlay does not mount compose/traefik/dynamic.dev.yml into the traefik container",
    });
  }
  const command = (traefik as { command?: unknown }).command;
  const commandList = Array.isArray(command) ? command.map(String) : [];
  const usesDirectory = commandList.some((c) => c.startsWith("--providers.file.directory="));
  const pinsSingleFile = commandList.some((c) => c.startsWith("--providers.file.filename="));
  if (!usesDirectory || pinsSingleFile) {
    out.push({
      code: "V5",
      file: ingressPath,
      message: pinsSingleFile
        ? "ingress overlay pins --providers.file.filename= which precludes loading dynamic.dev.yml — switch to --providers.file.directory="
        : "ingress overlay missing --providers.file.directory= for file-provider directory mode",
    });
  }
  return out;
}

export interface AuditOptions {
  readonly composeFile?: string;
  readonly dynamicDevFile?: string;
  readonly ingressFile?: string;
}

/**
 * Audit the repo's Traefik routing topology. Returns a list of
 * STRUCT-05 violations; empty array means clean. Paths default to the
 * canonical layout; tests override them for synthetic fixtures.
 */
export function auditTraefikRoutes(repoRoot: string, opts: AuditOptions = {}): Violation[] {
  const composeFile = opts.composeFile ?? resolve(repoRoot, "docker-compose.yml");
  const dynamicDevFile =
    opts.dynamicDevFile ?? resolve(repoRoot, "compose/traefik/dynamic.dev.yml");
  const ingressFile = opts.ingressFile ?? resolve(repoRoot, "compose/docker-compose.ingress.yml");
  return [
    ...auditDockerCompose(composeFile),
    ...auditDynamicDev(dynamicDevFile),
    ...auditIngressOverlay(ingressFile),
  ];
}

function findRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // tools/ sits at the repo root, so the file's parent IS the root.
  return resolve(here, "..");
}

// CLI entrypoint: print violations + exit non-zero. Mirrors
// tools/lint-cjm-doc.ts shape (Phase 13) and tools/lint-compose-chart-parity.ts
// (Phase 09).
if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = auditTraefikRoutes(findRepoRoot());
  if (violations.length === 0) {
    console.log("lint-traefik-routes: clean");
    process.exit(0);
  }
  for (const v of violations) {
    console.error(`${v.file}: [${v.code}] ${v.message}`);
  }
  process.exit(1);
}
