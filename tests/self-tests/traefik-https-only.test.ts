// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 04 / Task 3 — WIRE-20 self-test: HTTP -> HTTPS
// permanent (308) redirect at the Traefik :80 entrypoint.
//
// Skip-clean when Docker / Compose unavailable (matches the Plan 02
// self-test pattern). When present:
//   1. Write a fixture .env (so compose env interpolation succeeds).
//   2. Bring up just the `traefik` service. The redirect happens at
//      the entrypoint level before any upstream is consulted, so we
//      don't need the api container.
//   3. HTTP GET to http://127.0.0.1:80/api/health with Host header
//      `api.localhost`.
//   4. Assert status in [301, 302, 308] and Location starts with
//      `https://`.
//   5. Tear down + restore .env.
import { copyFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  composeAtLeast,
  dockerAvailable,
  dockerCompose,
  fixtureSecrets,
} from "./_helpers.js";

const SHOULD_RUN = dockerAvailable && composeAtLeast(2, 20);

const ROOT = process.cwd();
const ENV_BACKUP = join(ROOT, ".env.bak-02-04-wire20");

function writeFixtureEnv(): void {
  const env = fixtureSecrets();
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  writeFileSync(join(ROOT, ".env"), `${lines.join("\n")}\n`);
}

describe.skipIf(!SHOULD_RUN)(
  "WIRE-20 — Traefik HTTPS-only redirect (HTTP -> 308 HTTPS)",
  () => {
    beforeAll(async () => {
      const envPath = join(ROOT, ".env");
      if (existsSync(envPath)) copyFileSync(envPath, ENV_BACKUP);
      writeFixtureEnv();

      const r = dockerCompose(["up", "-d", "traefik"], {
        timeoutMs: 90_000,
      });
      if (r.exitCode !== 0) {
        // biome-ignore lint/suspicious/noConsole: failure-only diagnostics
        console.error("traefik up failed:", r.stderr || r.stdout);
      }
      // Brief settle for Traefik to bind 80/443.
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }, 120_000);

    afterAll(async () => {
      dockerCompose(["down", "-v"], { timeoutMs: 60_000 });
      const envPath = join(ROOT, ".env");
      if (existsSync(ENV_BACKUP)) {
        copyFileSync(ENV_BACKUP, envPath);
        rmSync(ENV_BACKUP, { force: true });
      } else if (existsSync(envPath)) {
        rmSync(envPath, { force: true });
      }
    }, 90_000);

    it(
      "http://api.localhost/api/health -> 301/302/308 with Location: https://...",
      async () => {
        // Use plain HTTP, do NOT follow redirects. The Host header makes
        // Traefik route through its file-provider router but the redirect
        // fires at entrypoint level regardless.
        const res = await fetch("http://127.0.0.1:80/api/health", {
          redirect: "manual",
          headers: { Host: "api.localhost" },
        });
        expect([301, 302, 308]).toContain(res.status);
        const location = res.headers.get("location") ?? "";
        expect(location.startsWith("https://")).toBe(true);
      },
      30_000,
    );
  },
);
