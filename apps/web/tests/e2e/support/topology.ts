// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 53 / Plan 53-14 — Playwright topology helper (D-TEST-3).
//
// The e2e suite runs against TWO supported deployment topologies:
//
//   1. `traefik` — host-split (production-equivalent). Web at
//      https://web.localhost, API at https://api.localhost, mkcert
//      dev certs, Traefik ingress. D-TEST-3 mandates this as the
//      default — requests traverse the same routing stack as prod.
//
//   2. `slim` — slim-core OSS-quickstart. Web at http://localhost:3000,
//      API at http://localhost:4000, no Traefik, no mkcert. Faster
//      local feedback loop for spec authoring + smoke runs.
//
// Topology is selected by Playwright project (--project=traefik|slim).
// Specs read origins through `getOrigins(testInfo)`; the helper is
// typed so a misspelled topology fails at TypeScript compile time
// rather than at runtime with a cryptic ECONNREFUSED.

import type { TestInfo } from "@playwright/test";

export type Topology = "traefik" | "slim";

export interface TopologyOrigins {
  /** Topology label — useful in test annotations + diagnostics. */
  readonly topology: Topology;
  /** Web origin (the Next.js app). */
  readonly webOrigin: string;
  /** API origin (Fastify + Better Auth). */
  readonly apiOrigin: string;
  /** Cookie domain — the hostname portion of webOrigin, used by
   *  specs that inject cookies via `context.addCookies()`. */
  readonly cookieDomain: string;
  /** True when the topology accepts the self-signed dev cert (Traefik
   *  + mkcert) and requires `ignoreHTTPSErrors: true`. */
  readonly ignoreHTTPSErrors: boolean;
}

const TRAEFIK_ORIGINS: TopologyOrigins = {
  topology: "traefik",
  webOrigin: "https://web.localhost",
  apiOrigin: "https://api.localhost",
  cookieDomain: "api.localhost",
  ignoreHTTPSErrors: true,
};

const SLIM_ORIGINS: TopologyOrigins = {
  topology: "slim",
  webOrigin: "http://localhost:3000",
  apiOrigin: "http://localhost:4000",
  cookieDomain: "localhost",
  ignoreHTTPSErrors: false,
};

const ORIGINS_BY_TOPOLOGY: Record<Topology, TopologyOrigins> = {
  traefik: TRAEFIK_ORIGINS,
  slim: SLIM_ORIGINS,
};

/**
 * Resolve the active topology's origins. Reads from
 * `testInfo.project.metadata.topology` (set by `playwright.config.ts`
 * `projects` array). Falls back to env (`OPENWHISPR_TOPOLOGY`) for
 * fixtures / helpers invoked outside a Playwright test (e.g.
 * `global-setup.ts` runs before the project is bound to a test).
 *
 * Errors loudly on unknown topology rather than silently defaulting —
 * a misconfigured project metadata is a test-infra bug we want surfaced
 * at the first spec, not 19 specs later.
 */
export function getOrigins(testInfo?: TestInfo): TopologyOrigins {
  const fromProject = testInfo?.project.metadata.topology as Topology | undefined;
  const fromEnv = process.env.OPENWHISPR_TOPOLOGY as Topology | undefined;
  const topology = fromProject ?? fromEnv ?? "traefik";
  const origins = ORIGINS_BY_TOPOLOGY[topology];
  if (!origins) {
    throw new Error(
      `topology: unknown "${topology}" — expected "traefik" or "slim". ` +
        `Set --project=<topology> on the playwright CLI or OPENWHISPR_TOPOLOGY env.`,
    );
  }
  return origins;
}

/**
 * Process-level topology — for fixtures that cannot reach a `testInfo`
 * (global-setup.ts, seed.ts, auth.ts module top). Reads the env var
 * directly; defaults to `traefik` (D-TEST-3 default).
 */
export function getProcessOrigins(): TopologyOrigins {
  return getOrigins(undefined);
}
