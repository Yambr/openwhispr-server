// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// DATA-05/DATA-06 self-test: tools/bootstrap.sh must
//   1. abort non-zero with the offending KEY name on stderr if any current
//      .env value matches a deny-list entry
//   2. produce a valid .env (every key non-empty, non-placeholder,
//      non-deny-list) when invoked on placeholders
//   3. be idempotent — a second run preserves operator-set values
//   4. carry a BASH_VERSINFO < 4 guard at the top of the script
//
// CRITICAL (RESEARCH-TOOLING Pitfall 7): every test runs against a freshly
// minted mkdtempSync directory and passes that path through the
// BOOTSTRAP_REPO_ROOT env var. Tests must never write to the real repo .env.

const SCRIPT = join(process.cwd(), "tools", "bootstrap.sh");
const DENY_LIST_SRC = join(process.cwd(), "tools", "bootstrap", "default-secrets.txt");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runBootstrap(repoRoot: string): RunResult {
  try {
    const stdout = execFileSync("bash", [SCRIPT], {
      encoding: "utf8",
      env: {
        ...process.env,
        BOOTSTRAP_REPO_ROOT: repoRoot,
        // Phase 14 / Plan 02 — bootstrap.sh now defaults to .env.slim.example.
        // This test fixture writes .env.example; override the template path
        // so the test stays exercising the same monolithic-template surface.
        BOOTSTRAP_ENV_TEMPLATE: join(repoRoot, ".env.example"),
      },
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

const PLACEHOLDER_ENV_EXAMPLE = [
  // tools/bootstrap.sh substitutes ONLY the literal sentinel
  // `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` (see the script's header). Earlier
  // per-key placeholders like `PLACEHOLDER_OWNER` are treated as "concrete
  // defaults" and left untouched, yielding a false-positive failure on
  // this self-test. Use the canonical sentinel so substitution is the
  // only thing under test.
  "POSTGRES_OWNER_PASSWORD=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE",
  "POSTGRES_APP_PASSWORD=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE",
  "PGBOUNCER_ADMIN_PASSWORD=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE",
  "VALKEY_PASSWORD=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE",
  "MINIO_ROOT_PASSWORD=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE",
  "TRAEFIK_ADMIN_PASSWORD=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE",
  "GRAFANA_ADMIN_PASSWORD=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE",
  "MASTER_KEK=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE",
  "BACKUP_AGE_IDENTITY=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE",
  "BETTER_AUTH_SECRET=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE",
  "",
].join("\n");

function setupRepoRoot(envFileBody: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "bootstrap-"));
  mkdirSync(join(root, "tools", "bootstrap"), { recursive: true });
  writeFileSync(join(root, ".env.example"), PLACEHOLDER_ENV_EXAMPLE);
  // Copy the production deny-list so the test exercises real data.
  writeFileSync(
    join(root, "tools", "bootstrap", "default-secrets.txt"),
    readFileSync(DENY_LIST_SRC, "utf8"),
  );
  if (envFileBody !== null) {
    writeFileSync(join(root, ".env"), envFileBody);
  }
  return root;
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

describe("DATA-05 self-test: bootstrap.sh refuses deny-listed values", () => {
  it("aborts non-zero when POSTGRES_OWNER_PASSWORD=changeme", () => {
    const root = setupRepoRoot("POSTGRES_OWNER_PASSWORD=changeme\n");
    try {
      const r = runBootstrap(root);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toMatch(/POSTGRES_OWNER_PASSWORD/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("aborts non-zero when MASTER_KEK=changeme", () => {
    const root = setupRepoRoot("MASTER_KEK=changeme\n");
    try {
      const r = runBootstrap(root);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toMatch(/MASTER_KEK/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("DATA-05 self-test: bootstrap.sh generates valid .env on placeholders", () => {
  it("exits 0 and writes a complete, deny-list-clean .env", () => {
    const root = setupRepoRoot(null);
    try {
      const r = runBootstrap(root);
      expect(r.code).toBe(0);
      const env = parseEnv(readFileSync(join(root, ".env"), "utf8"));
      const denyValues = readFileSync(DENY_LIST_SRC, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
      const expected = parseEnv(PLACEHOLDER_ENV_EXAMPLE);
      for (const key of Object.keys(expected)) {
        const value = env[key];
        expect(value, `key ${key} present in .env`).toBeDefined();
        expect(value).not.toBe("");
        expect(value).not.toBe(expected[key]);
        expect(denyValues).not.toContain(value);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("DATA-05 self-test: bootstrap.sh is idempotent", () => {
  it("preserves operator-set values across two invocations", () => {
    const root = setupRepoRoot(null);
    try {
      const first = runBootstrap(root);
      expect(first.code).toBe(0);
      const firstEnv = parseEnv(readFileSync(join(root, ".env"), "utf8"));

      const second = runBootstrap(root);
      expect(second.code).toBe(0);
      const secondEnv = parseEnv(readFileSync(join(root, ".env"), "utf8"));

      for (const key of Object.keys(firstEnv)) {
        expect(secondEnv[key], `key ${key} preserved on second run`).toBe(firstEnv[key]);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("DATA-05 self-test: bootstrap.sh has a bash >= 4 guard", () => {
  it("contains the BASH_VERSINFO[0] < 4 check at the top of the script", () => {
    const source = readFileSync(SCRIPT, "utf8");
    expect(source).toMatch(/BASH_VERSINFO\[0\]\}?\s*<\s*4/);
    expect(source).toMatch(/brew install bash/);
    expect(source).toMatch(/set -euo pipefail/);
  });
});
