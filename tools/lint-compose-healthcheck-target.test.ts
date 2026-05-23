// SPDX-License-Identifier: FSL-1.1-ALv2
// CI smoke regression — Plan ci-smoke-api-unhealthy.
//
// Asserts: every `healthcheck.test` array AND every Dockerfile HEALTHCHECK
// targeting the api/worker/web service's in-container HTTP port uses an
// IPv4 LITERAL (`127.0.0.1`), NEVER the `localhost` hostname.
//
// Why: `localhost` in the alpine container's `/etc/hosts` resolves to
// BOTH `127.0.0.1` and `::1` (docker injects both). The api Fastify
// listen call binds `0.0.0.0:3000` (IPv4 only — Fastify does NOT dual-
// bind for `0.0.0.0`). BusyBox wget calls `getaddrinfo` which may return
// the IPv6 address first depending on the host kernel's `gai.conf` (GHA
// ubuntu-24.04 runners differ from Docker Desktop on macOS). When wget
// gets `::1` first and the api is IPv4-only, `wget --tries=1` exits non-
// zero WITHOUT falling back to the v4 address (BusyBox wget has no
// happy-eyeballs / address-iteration), the healthcheck reports
// `unhealthy`, and `docker compose up --wait` aborts with
// `dependency failed to start: container openwhispr-api-1 is unhealthy`.
//
// The CI smoke job (run 26337800406, job 77534390507) hit exactly this
// path: the api logged `Server listening at http://127.0.0.1:3000` +
// `http://172.18.0.15:3000` (no IPv6 binding), litellm logged ZERO
// `/health/readiness` hits (confirming /api/ready handler never ran),
// and the api log captured ZERO request entries despite 30s of wget
// probes — wget never reached fastify.
//
// The fix is to use the IPv4 literal `127.0.0.1` in every api/worker/web
// healthcheck command, matching the base `docker-compose.yml` pattern
// that pre-dated the embedded-litellm overlay. The base healthcheck
// (`http://127.0.0.1:3000/api/ready`) does NOT hit this trap; only the
// overlay (`http://localhost:3000/api/health`) does, and the overlay
// REPLACES the base when both are merged.
//
// This lint is a regression guard — it runs in the standard unit suite
// and refuses any future compose/Dockerfile edit that re-introduces a
// `localhost`-in-container-healthcheck shape.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");

/** Compose files whose healthcheck blocks must be scanned. */
const COMPOSE_FILES = [
  "docker-compose.yml",
  ...readdirSync(join(REPO_ROOT, "compose"))
    .filter((f) => f.startsWith("docker-compose.") && f.endsWith(".yml"))
    .map((f) => `compose/${f}`),
];

/** Dockerfile HEALTHCHECK directives that bind the in-container port. */
const DOCKERFILES = ["apps/api/Dockerfile", "apps/worker/Dockerfile", "apps/web/Dockerfile"];

/**
 * Match a healthcheck `test:` array element OR a Dockerfile HEALTHCHECK
 * CMD line that contains a `localhost:<port>` URL targeting a port the
 * in-container service binds (3000 = api/web, 4000 = litellm/api-bridge,
 * 5000 = worker if it ever gains HTTP). The litellm container's own
 * healthcheck uses python urllib which has happy-eyeballs and is NOT
 * subject to this bug; we scope the lint to the api/worker/web ports.
 */
const LOCALHOST_PROBE_REGEX = /https?:\/\/localhost:(3000|4000|5000)\//;

describe("lint: compose + Dockerfile healthcheck target", () => {
  for (const composeFile of COMPOSE_FILES) {
    it(`${composeFile} — no localhost:* probes in api/worker/web healthchecks`, () => {
      const source = readFileSync(join(REPO_ROOT, composeFile), "utf8");
      const offenders: string[] = [];
      for (const line of source.split("\n")) {
        // Skip comments and the litellm self-probe (python urllib, not
        // wget — different resolver semantics, immune to the bug).
        if (line.trim().startsWith("#")) continue;
        if (line.includes("python3 -c") || line.includes("urllib.request")) continue;
        if (LOCALHOST_PROBE_REGEX.test(line)) {
          offenders.push(line.trim());
        }
      }
      expect(offenders, `expected no localhost probes; found:\n${offenders.join("\n")}`).toEqual(
        [],
      );
    });
  }

  for (const dockerfile of DOCKERFILES) {
    it(`${dockerfile} — HEALTHCHECK CMD uses 127.0.0.1, not localhost`, () => {
      let source: string;
      try {
        source = readFileSync(join(REPO_ROOT, dockerfile), "utf8");
      } catch (err) {
        // Worker/web may not have a HEALTHCHECK; skip if file missing.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw err;
      }
      const offenders: string[] = [];
      for (const line of source.split("\n")) {
        if (line.trim().startsWith("#")) continue;
        // Only inspect HEALTHCHECK directive lines (or their CMD continuations).
        if (!/HEALTHCHECK|wget|curl/i.test(line)) continue;
        if (LOCALHOST_PROBE_REGEX.test(line)) {
          offenders.push(line.trim());
        }
      }
      expect(offenders, `expected no localhost probes; found:\n${offenders.join("\n")}`).toEqual(
        [],
      );
    });
  }
});
