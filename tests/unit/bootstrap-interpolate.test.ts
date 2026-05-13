// SPDX-License-Identifier: Apache-2.0
/**
 * Phase 02.4 / G1 — bootstrap.sh interpolate() + three-way value semantics.
 *
 * Source-of-record commits: 451e9b3 (interpolate), 7ccb8bb (three-way semantics)
 *
 * Reverts: this test goes RED if either of the following inverse patches is applied
 *   to tools/bootstrap.sh:
 *   1. interpolate() returns its template unchanged → composite ${SECRET_A} stays literal
 *      in DATABASE_URL → assertion `expect(env.DATABASE_URL).toContain(secretA)` fails.
 *   2. The three-way branching collapses back to "regenerate when current empty or
 *      matches example" for every key (pre-7ccb8bb behaviour) → URL-shaped defaults
 *      get base64-replaced → assertion `expect(env.OPENWHISPR_API_URL).toBe('https://api.localhost')`
 *      fails (would be a 43-char base64 token instead).
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "tools", "bootstrap.sh");
const FIXTURE = join(process.cwd(), "tests", "fixtures", "bootstrap-env-template.txt");
const REAL_DENY_LIST = join(process.cwd(), "tools", "bootstrap", "default-secrets.txt");

interface ParsedEnv {
  [k: string]: string;
}

function parseEnv(content: string): ParsedEnv {
  const out: ParsedEnv = {};
  for (const line of content.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

function setupRoot(): { root: string; envPath: string } {
  const root = mkdtempSync(join(tmpdir(), "bootstrap-test-"));
  mkdirSync(join(root, "tools", "bootstrap"), { recursive: true });
  copyFileSync(FIXTURE, join(root, ".env.example"));
  copyFileSync(REAL_DENY_LIST, join(root, "tools", "bootstrap", "default-secrets.txt"));
  return { root, envPath: join(root, ".env") };
}

function runBootstrap(root: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("bash", [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, BOOTSTRAP_REPO_ROOT: root },
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

describe("Phase 02.4 G1 — bootstrap.sh three-way value semantics", () => {
  it("regenerates PLACEHOLDER_BOOTSTRAP_WILL_REPLACE to a non-placeholder secret", () => {
    const { root, envPath } = setupRoot();
    try {
      const r = runBootstrap(root);
      expect(r.code).toBe(0);
      const env = parseEnv(readFileSync(envPath, "utf8"));
      expect(env.SECRET_A).toBeDefined();
      expect(env.SECRET_A).not.toBe("PLACEHOLDER_BOOTSTRAP_WILL_REPLACE");
      expect(env.SECRET_A).not.toBe("");
      expect(env.SECRET_A.length).toBeGreaterThanOrEqual(32);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves URL-shaped real defaults verbatim (regression: 7ccb8bb)", () => {
    const { root, envPath } = setupRoot();
    try {
      runBootstrap(root);
      const env = parseEnv(readFileSync(envPath, "utf8"));
      expect(env.OPENWHISPR_API_URL).toBe("https://api.localhost");
      expect(env.POSTGRES_USER).toBe("openwhispr_owner");
      expect(env.SMTP_PORT).toBe("1025");
      expect(env.ADMIN_EMAIL).toBe("no-reply@openwhispr.local");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves explicitly-empty SMTP_HOST= as empty", () => {
    const { root, envPath } = setupRoot();
    try {
      runBootstrap(root);
      const env = parseEnv(readFileSync(envPath, "utf8"));
      expect(env.SMTP_HOST).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal "${SECRET_A}" is the
  //   bash-shell placeholder syntax under test — must remain a plain string, not a JS template.
  it("interpolates ${SECRET_A} inside DATABASE_URL composite", () => {
    const { root, envPath } = setupRoot();
    try {
      runBootstrap(root);
      const env = parseEnv(readFileSync(envPath, "utf8"));
      expect(env.SECRET_A).toBeDefined();
      expect(env.DATABASE_URL).toBe(`postgres://app:${env.SECRET_A}@db:5432/openwhispr`);
      // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal bash
      //   placeholder "${SECRET_A}" is absent from the rendered output (i.e. interpolation ran).
      expect(env.DATABASE_URL).not.toContain("${SECRET_A}");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("interpolates every occurrence in multi-reference composites", () => {
    const { root, envPath } = setupRoot();
    try {
      runBootstrap(root);
      const env = parseEnv(readFileSync(envPath, "utf8"));
      expect(env.COMPOSITE_TWO_REFS).toBe(`${env.SECRET_A}-${env.SECRET_B}`);
      expect(env.COMPOSITE_TWO_REFS).not.toContain("${");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is idempotent — second run preserves PLACEHOLDER-derived secrets byte-for-byte", () => {
    const { root, envPath } = setupRoot();
    try {
      runBootstrap(root);
      const first = readFileSync(envPath, "utf8");
      runBootstrap(root);
      const second = readFileSync(envPath, "utf8");
      expect(second).toBe(first);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rebuilds composite from RESULT even if .env has stale operator override (rotation safety)", () => {
    const { root, envPath } = setupRoot();
    try {
      runBootstrap(root);
      const firstEnv = parseEnv(readFileSync(envPath, "utf8"));
      // Simulate stale composite — operator manually edited DATABASE_URL with old password.
      const tampered = readFileSync(envPath, "utf8").replace(
        /^DATABASE_URL=.*$/m,
        "DATABASE_URL=postgres://app:STALE_OLD_PASSWORD@db:5432/openwhispr",
      );
      writeFileSync(envPath, tampered);
      runBootstrap(root);
      const secondEnv = parseEnv(readFileSync(envPath, "utf8"));
      // Composite must be rebuilt from current RESULT[SECRET_A], not preserved as stale.
      expect(secondEnv.DATABASE_URL).toBe(`postgres://app:${firstEnv.SECRET_A}@db:5432/openwhispr`);
      expect(secondEnv.DATABASE_URL).not.toContain("STALE_OLD_PASSWORD");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves operator-set override of a real-default key", () => {
    const { root, envPath } = setupRoot();
    try {
      // Pre-seed .env with an operator override.
      writeFileSync(envPath, "POSTGRES_USER=custom_owner\n");
      runBootstrap(root);
      const env = parseEnv(readFileSync(envPath, "utf8"));
      expect(env.POSTGRES_USER).toBe("custom_owner");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
