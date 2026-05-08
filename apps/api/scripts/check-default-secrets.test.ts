import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const SCRIPT = join(process.cwd(), "apps", "api", "scripts", "check-default-secrets.ts");

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
  try {
    const stdout = execFileSync("pnpm", ["exec", "tsx", SCRIPT], {
      encoding: "utf8",
      env: cleanEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status: number | null; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
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
