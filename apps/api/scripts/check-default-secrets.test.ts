// SPDX-License-Identifier: FSL-1.1-ALv2
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// DATA-06 defense-in-depth self-test: apps/api/scripts/check-default-secrets.ts
// is invoked by the API container ENTRYPOINT before `node dist/index.js`. It
// must:
//   1. exit 1 with stderr listing each missing key when REQUIRED_KEYS unset
//   2. exit 0 when every REQUIRED_KEY holds a non-deny-list value
//   3. exit 1 with the offending key on stderr when one REQUIRED_KEY matches
//      the deny-list
//   4. honor a DENY_LIST_PATH env override so operators can extend the
//      deny-list without rebuilding the image

// Resolve the script path relative to THIS test file (not process.cwd()) —
// vitest workspaces invoke per-package vitest from `apps/api`, so joining
// against `process.cwd()` produced the duplicated path
// `apps/api/apps/api/scripts/check-default-secrets.ts`. Bug previously
// hidden under "Stage 4 fails" before Plan 51-26 inverted-mutation sweep.
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, "check-default-secrets.ts");

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
];

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCheck(env: Record<string, string | undefined>): RunResult {
  // Build a clean env that does NOT inherit REQUIRED_KEYS from the parent
  // process; otherwise a stray .env in the dev shell could pollute the test.
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !REQUIRED_KEYS.includes(k)) cleanEnv[k] = v;
  }
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) cleanEnv[k] = v;
  }
  // spawnSync (not execFileSync) so stderr is captured on BOTH success
  // and failure paths — execFileSync only returns stderr inside the
  // thrown error object on non-zero exit, hiding the success-path
  // "deployment mode = …" operator-visibility log from the test surface.
  const r = spawnSync("pnpm", ["exec", "tsx", SCRIPT], {
    encoding: "utf8",
    env: cleanEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    code: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function strongValueFor(key: string): string {
  // Deterministic but not deny-listed; suffix with the key to keep values
  // distinct so a swapped-key bug would surface in other tests.
  return `STRONG_RANDOM_VALUE_${key}_8a3f9c2d1e7b4a6f`;
}

function allValid(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of REQUIRED_KEYS) out[k] = strongValueFor(k);
  return out;
}

describe("DATA-06: apps/api/scripts/check-default-secrets.ts", () => {
  it("exits 1 and names every missing key when REQUIRED_KEYS are unset", () => {
    const r = runCheck({});
    expect(r.code).toBe(1);
    for (const key of REQUIRED_KEYS) {
      expect(r.stderr, `mentions ${key}`).toMatch(new RegExp(key));
    }
  }, 30_000);

  it("exits 0 when every REQUIRED_KEY holds a strong, non-deny-list value", () => {
    const r = runCheck(allValid());
    expect(r.code).toBe(0);
  }, 30_000);

  it("exits 1 and names the offending key when one value matches the deny-list", () => {
    const env = allValid();
    env.MASTER_KEK = "changeme";
    const r = runCheck(env);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/MASTER_KEK/);
    expect(r.stderr).not.toMatch(/POSTGRES_OWNER_PASSWORD/);
  }, 30_000);

  describe("OPENWHISPR_DEPLOYMENT_MODE=k8s deployment mode", () => {
    // K8s operators provide infra credentials (Postgres / Valkey / MinIO /
    // Traefik / Grafana / age-backup) via Kubernetes Secrets bound to
    // their own platform primitives — NOT the compose-era env vars this
    // entrypoint script enforces. In k8s mode REQUIRED_KEYS shrinks to
    // just the application-secret essentials (MASTER_KEK + BETTER_AUTH_SECRET)
    // — everything else is operator-managed out-of-band.

    function k8sMinimalEnv(): Record<string, string> {
      return {
        MASTER_KEK: strongValueFor("MASTER_KEK"),
        BETTER_AUTH_SECRET: strongValueFor("BETTER_AUTH_SECRET"),
      };
    }

    it("k8s mode — exits 0 with only MASTER_KEK + BETTER_AUTH_SECRET set", () => {
      const env = { ...k8sMinimalEnv(), OPENWHISPR_DEPLOYMENT_MODE: "k8s" };
      const r = runCheck(env);
      expect(r.code).toBe(0);
    }, 30_000);

    it("k8s mode — still rejects MASTER_KEK matching deny-list", () => {
      const env = { ...k8sMinimalEnv(), OPENWHISPR_DEPLOYMENT_MODE: "k8s" };
      env.MASTER_KEK = "changeme";
      const r = runCheck(env);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/MASTER_KEK/);
    }, 30_000);

    it("k8s mode — still rejects unset MASTER_KEK", () => {
      const env: Record<string, string> = {
        BETTER_AUTH_SECRET: strongValueFor("BETTER_AUTH_SECRET"),
        OPENWHISPR_DEPLOYMENT_MODE: "k8s",
      };
      const r = runCheck(env);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/MASTER_KEK/);
    }, 30_000);

    it("k8s mode — still rejects unset BETTER_AUTH_SECRET", () => {
      const env: Record<string, string> = {
        MASTER_KEK: strongValueFor("MASTER_KEK"),
        OPENWHISPR_DEPLOYMENT_MODE: "k8s",
      };
      const r = runCheck(env);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/BETTER_AUTH_SECRET/);
    }, 30_000);

    it("k8s mode — does NOT require POSTGRES_OWNER_PASSWORD or other compose-era keys", () => {
      const env = { ...k8sMinimalEnv(), OPENWHISPR_DEPLOYMENT_MODE: "k8s" };
      const r = runCheck(env);
      expect(r.code).toBe(0);
      // Stderr should NOT name any of the compose-era-only keys.
      const composeOnly = [
        "POSTGRES_OWNER_PASSWORD",
        "POSTGRES_APP_PASSWORD",
        "PGBOUNCER_ADMIN_PASSWORD",
        "VALKEY_PASSWORD",
        "MINIO_ROOT_PASSWORD",
        "TRAEFIK_ADMIN_PASSWORD",
        "GRAFANA_ADMIN_PASSWORD",
        "BACKUP_AGE_IDENTITY",
      ];
      for (const key of composeOnly) {
        expect(r.stderr, `does not mention ${key}`).not.toMatch(new RegExp(key));
      }
    }, 30_000);

    it("k8s mode — case-insensitive: K8S accepted", () => {
      const env = { ...k8sMinimalEnv(), OPENWHISPR_DEPLOYMENT_MODE: "K8S" };
      const r = runCheck(env);
      expect(r.code).toBe(0);
    }, 30_000);

    it("k8s mode — case-insensitive: K8s accepted", () => {
      const env = { ...k8sMinimalEnv(), OPENWHISPR_DEPLOYMENT_MODE: "K8s" };
      const r = runCheck(env);
      expect(r.code).toBe(0);
    }, 30_000);

    it("k8s mode — whitespace-tolerant: ' k8s ' accepted", () => {
      const env = { ...k8sMinimalEnv(), OPENWHISPR_DEPLOYMENT_MODE: " k8s " };
      const r = runCheck(env);
      expect(r.code).toBe(0);
    }, 30_000);

    it("k8s mode — trailing whitespace 'k8s ' accepted", () => {
      const env = { ...k8sMinimalEnv(), OPENWHISPR_DEPLOYMENT_MODE: "k8s " };
      const r = runCheck(env);
      expect(r.code).toBe(0);
    }, 30_000);

    it("compose mode (default, unset) — still requires all 10 keys", () => {
      const env = k8sMinimalEnv(); // OPENWHISPR_DEPLOYMENT_MODE NOT set
      const r = runCheck(env);
      expect(r.code).toBe(1);
      // All compose-era keys should be reported as missing.
      const composeOnly = [
        "POSTGRES_OWNER_PASSWORD",
        "POSTGRES_APP_PASSWORD",
        "PGBOUNCER_ADMIN_PASSWORD",
        "VALKEY_PASSWORD",
        "MINIO_ROOT_PASSWORD",
        "TRAEFIK_ADMIN_PASSWORD",
        "GRAFANA_ADMIN_PASSWORD",
        "BACKUP_AGE_IDENTITY",
      ];
      for (const key of composeOnly) {
        expect(r.stderr, `mentions ${key}`).toMatch(new RegExp(key));
      }
    }, 30_000);

    it("compose mode (explicit) — still requires all 10 keys", () => {
      const env = { ...k8sMinimalEnv(), OPENWHISPR_DEPLOYMENT_MODE: "compose" };
      const r = runCheck(env);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/POSTGRES_OWNER_PASSWORD/);
    }, 30_000);

    it("unrelated value — not 'k8s', still requires all 10 keys", () => {
      const env = { ...k8sMinimalEnv(), OPENWHISPR_DEPLOYMENT_MODE: "kubernetes" };
      const r = runCheck(env);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/POSTGRES_OWNER_PASSWORD/);
    }, 30_000);

    it("k8s mode — logs chosen mode to stderr for operator visibility", () => {
      const env = { ...k8sMinimalEnv(), OPENWHISPR_DEPLOYMENT_MODE: "k8s" };
      const r = runCheck(env);
      expect(r.code).toBe(0);
      // Mode line written to stderr (not stdout — preserves stdout for
      // structured downstream consumers).
      expect(r.stderr).toMatch(/deployment mode/i);
      expect(r.stderr).toMatch(/k8s/);
    }, 30_000);
  });

  it("honors DENY_LIST_PATH env override", () => {
    // Use a custom deny-list that does NOT contain "changeme" but DOES contain
    // a weird literal — verifies the script reads the override path.
    const root = mkdtempSync(join(tmpdir(), "check-deny-"));
    try {
      const customPath = join(root, "deny.txt");
      writeFileSync(customPath, "# custom deny-list\nMY_CUSTOM_BAD_VALUE\n");
      const env = allValid();
      env.MASTER_KEK = "MY_CUSTOM_BAD_VALUE";
      env.DENY_LIST_PATH = customPath;
      const r = runCheck(env);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/MASTER_KEK/);

      // Sanity: same value with the production deny-list (no override) passes,
      // because MY_CUSTOM_BAD_VALUE is not in the production deny-list.
      const env2 = allValid();
      env2.MASTER_KEK = "MY_CUSTOM_BAD_VALUE";
      const r2 = runCheck(env2);
      expect(r2.code).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
