// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Phase 01.1 / Plan 01 RED self-test for scripts/verify-images.sh.
//
// This test pins down the contract of the not-yet-existent
// scripts/verify-images.sh. The script will be implemented in Plan 02
// (GREEN). At this point the file MUST NOT exist so that all three test
// cases fail loudly (ENOENT / "No such file or directory") — that is the
// RED step of TDD as required by project CLAUDE.md.
//
// Behaviour locked down here:
//   1. SC-02a: missing image -> exit non-zero, offending image on stderr,
//              healthy image surfaces "OK <image>" on stdout.
//   2. SC-02b: future-dated MinIO RELEASE.YYYY-MM-DD-style tag is detected
//              cheaply with no network call (FUTURE-DATED on stderr; both
//              the future tag date and today's date are echoed).
//   3. T-01.1-01 (Tampering threat): image strings containing shell
//              metacharacters are rejected BEFORE invoking docker; an
//              INVALID-IMAGE sentinel surfaces on stderr.
//
// CRITICAL (mirror refuse-default-secrets.test.ts pattern): every test
// runs against a freshly minted mkdtempSync directory and passes that
// path through the COMPOSE_FILE env var. Tests must never write to the
// real repo's docker-compose.yml.

const SCRIPT = join(process.cwd(), "scripts", "verify-images.sh");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runVerify(composePath: string): RunResult {
  try {
    const stdout = execFileSync("bash", [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, COMPOSE_FILE: composePath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as {
      status: number | null;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      message?: string;
    };
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? "",
      stderr: (e.stderr?.toString() ?? "") + (e.message ?? ""),
    };
  }
}

describe("SC-02a self-test: verify-images.sh detects missing images", () => {
  it("exits non-zero with offending image in stderr when image is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "verify-images-"));
    const composePath = join(root, "docker-compose.yml");
    // Cache-buster suffix on the missing image guarantees Docker Hub
    // never resolves it; hello-world:latest is real and asserts the OK
    // stdout path.
    const missing = `nonexistent/image-xyz:does-not-exist-${Date.now()}`;
    const compose = [
      "services:",
      "  bad:",
      `    image: ${missing}`,
      "  good:",
      "    image: hello-world:latest",
      "",
    ].join("\n");
    writeFileSync(composePath, compose);
    try {
      const r = runVerify(composePath);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toMatch(/nonexistent\/image-xyz:does-not-exist/);
      expect(r.stdout).toMatch(/OK hello-world:latest/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("SC-02b self-test: verify-images.sh detects future-dated RELEASE tags locally", () => {
  it("exits non-zero on a future-dated MinIO RELEASE tag without a network call", () => {
    const root = mkdtempSync(join(tmpdir(), "verify-images-"));
    const composePath = join(root, "docker-compose.yml");
    const compose = [
      "services:",
      "  minio:",
      "    image: minio/minio:RELEASE.2099-01-01T00-00-00Z",
      "",
    ].join("\n");
    writeFileSync(composePath, compose);
    try {
      const r = runVerify(composePath);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toMatch(/FUTURE-DATED/);
      expect(r.stderr).toMatch(/RELEASE\.2099-01-01T00-00-00Z/);
      // The GREEN script (Plan 02) emits the FUTURE-DATED message in the
      // form "(tag date YYYY-MM-DD > today YYYY-MM-DD)" — so both the
      // future tag-date AND today's date must be echoed.
      expect(r.stderr).toMatch(/2099-01-01/);
      const today = new Date().toISOString().slice(0, 10);
      expect(r.stderr).toMatch(new RegExp(today));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 10_000);
});

describe("T-01.1-01 self-test: verify-images.sh rejects shell-metacharacter image strings", () => {
  it("rejects image strings containing shell metachars before invoking docker", () => {
    const root = mkdtempSync(join(tmpdir(), "verify-images-"));
    const composePath = join(root, "docker-compose.yml");
    // Shell-metachar example covering semicolon — Plan 02's GREEN script
    // implements the regex ^[a-zA-Z0-9._/:@-]+$ guard. The exact wording
    // of the sentinel is INVALID-IMAGE per the script API in
    // 01.1-01-PLAN.md <interfaces>.
    const badImage = "bad;rm-rf-/:tag";
    const compose = ["services:", "  evil:", `    image: "${badImage}"`, ""].join("\n");
    writeFileSync(composePath, compose);
    try {
      const r = runVerify(composePath);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toMatch(/INVALID-IMAGE/);
      expect(r.stderr).toContain("bad;rm-rf-/");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 5_000);
});
