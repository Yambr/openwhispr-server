// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 33 / Plan 33-04 — api+worker boot-time refusal test.
//
// Asserts the encryption-boot gate is wired into BOTH entrypoints AND
// that the gate exits with BSD EX_CONFIG (78) under each failure mode:
//   1. MASTER_KEK unset
//   2. MASTER_KEK decodes to fewer than 32 bytes (truncated key)
//   3. OPENWHISPR_KEY_PROVIDER=vault (v1 stub provider)
//   4. OPENWHISPR_KEY_PROVIDER=kms   (v1 stub provider)
//
// Wiring is asserted via source-text grep on apps/api/src/index.ts +
// apps/worker/src/index.ts — confirms the `validateEncryptionBoot()`
// call lands AFTER the BYOK guard so the loud-fail order is preserved.
// Behaviour is asserted by spawning `tsx -e` that imports the gate from
// `@openwhispr/data` and runs it under each bad-env permutation. This
// pattern matches the existing DATA-06 check-default-secrets test
// (apps/api/scripts/check-default-secrets.test.ts) — subprocess +
// inspect exit code + stderr — but stays narrowly scoped to the gate so
// the test does not require booting Fastify / Drizzle / Valkey.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const API_ENTRY = resolve(REPO_ROOT, "apps", "api", "src", "index.ts");
const WORKER_ENTRY = resolve(REPO_ROOT, "apps", "worker", "src", "index.ts");

interface RunResult {
  code: number;
  stderr: string;
}

// 32 bytes of base64url-encoded zeros — valid length for the happy path.
const VALID_KEK = Buffer.alloc(32).toString("base64url");
// 31 bytes → invalid length.
const SHORT_KEK = Buffer.alloc(31).toString("base64url");

function runGate(env: Record<string, string | undefined>): RunResult {
  // Spawn a fresh node process via tsx that imports the gate and runs
  // it. Standalone — no Fastify boot, no DB connections, no BYOK
  // overlay dance. The gate is the unit under test.
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== "MASTER_KEK" && k !== "OPENWHISPR_KEY_PROVIDER") {
      cleanEnv[k] = v;
    }
  }
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) cleanEnv[k] = v;
  }
  const script = `
import { validateEncryptionBoot } from "@openwhispr/data";
validateEncryptionBoot();
process.exit(0);
`;
  try {
    execFileSync("pnpm", ["exec", "tsx", "-e", script], {
      encoding: "utf8",
      env: cleanEnv,
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status: number | null; stderr?: Buffer | string };
    return { code: e.status ?? 1, stderr: e.stderr?.toString() ?? "" };
  }
}

describe("Phase 33 / Plan 33-04 — encryption-boot gate (apps/api + apps/worker)", () => {
  describe("wiring (static source check)", () => {
    it("apps/api/src/index.ts calls validateEncryptionBoot() after the BYOK guard", () => {
      const src = readFileSync(API_ENTRY, "utf8");
      expect(src).toMatch(/validateEncryptionBoot\s*\(\s*\)/);
      const byokIdx = src.indexOf("assertBYOKConfig");
      const gateIdx = src.indexOf("validateEncryptionBoot()");
      expect(byokIdx).toBeGreaterThan(-1);
      expect(gateIdx).toBeGreaterThan(byokIdx);
    });

    it("apps/worker/src/index.ts calls validateEncryptionBoot() after the BYOK guard", () => {
      const src = readFileSync(WORKER_ENTRY, "utf8");
      expect(src).toMatch(/validateEncryptionBoot\s*\(\s*\)/);
      const byokIdx = src.indexOf("assertBYOKConfig");
      const gateIdx = src.indexOf("validateEncryptionBoot()");
      expect(byokIdx).toBeGreaterThan(-1);
      expect(gateIdx).toBeGreaterThan(byokIdx);
    });
  });

  describe("runtime refusal (subprocess + exit-code assertion)", () => {
    it("exits 78 with MasterKekMissingError when MASTER_KEK is unset", () => {
      const r = runGate({ MASTER_KEK: undefined, OPENWHISPR_KEY_PROVIDER: undefined });
      expect(r.code).toBe(78);
      expect(r.stderr).toMatch(/MasterKekMissingError/);
    }, 60_000);

    it("exits 78 with MasterKekInvalidLengthError when MASTER_KEK is 31 bytes", () => {
      const r = runGate({ MASTER_KEK: SHORT_KEK, OPENWHISPR_KEY_PROVIDER: undefined });
      expect(r.code).toBe(78);
      expect(r.stderr).toMatch(/MasterKekInvalidLengthError/);
    }, 60_000);

    it("exits 78 with KeyProviderStubError when OPENWHISPR_KEY_PROVIDER=vault", () => {
      const r = runGate({ MASTER_KEK: VALID_KEK, OPENWHISPR_KEY_PROVIDER: "vault" });
      expect(r.code).toBe(78);
      expect(r.stderr).toMatch(/KeyProviderStubError/);
      expect(r.stderr).toMatch(/[Vv]ault/);
    }, 60_000);

    it("exits 78 with KeyProviderStubError when OPENWHISPR_KEY_PROVIDER=kms", () => {
      const r = runGate({ MASTER_KEK: VALID_KEK, OPENWHISPR_KEY_PROVIDER: "kms" });
      expect(r.code).toBe(78);
      expect(r.stderr).toMatch(/KeyProviderStubError/);
      expect(r.stderr).toMatch(/KMS|kms/i);
    }, 60_000);

    it("exits 0 with valid MASTER_KEK and no provider override", () => {
      const r = runGate({ MASTER_KEK: VALID_KEK, OPENWHISPR_KEY_PROVIDER: undefined });
      expect(r.code).toBe(0);
      expect(r.stderr).toBe("");
    }, 60_000);
  });
});
