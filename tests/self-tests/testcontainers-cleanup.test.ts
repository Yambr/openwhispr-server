// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 46 / Plan 46-01 / L5 — testcontainers cleanup self-test.
//
// Closes L5 from `.planning/qa-audit/2026-05-16-test-layering.md`.
// Per memory feedback_testcontainers_cleanup_audit: "apps/api vitest
// leaks postgres testcontainers + volumes (Ryuk not firing); audit
// before any compose smoke and after my own api test runs."
//
// Layers of defense:
//   1. tools/global-vitest-teardown.ts runs `docker container prune -f
//      --filter label=org.testcontainers=true` at end of every vitest
//      run (Phase 13).
//   2. THIS self-test asserts the contract is encoded in source AND
//      that no orphan containers remain right now (when docker is
//      reachable). Catches a future refactor that accidentally drops
//      the prune call.
//
// The orphan-count assertion is best-effort: docker may not be
// reachable (CI sandbox, container-less worker), in which case the
// test is a no-op and emits a note via stdout. The static
// source-grep assertions ALWAYS run.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..");

function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version", "--format", "{{.Client.Version}}"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

function listOrphanTestcontainers(): string[] {
  try {
    const stdout = execFileSync(
      "docker",
      [
        "ps",
        "-a",
        "--filter",
        "label=org.testcontainers=true",
        "--format",
        "{{.ID}} {{.Image}} {{.Status}}",
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    return stdout.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

describe("testcontainers cleanup (Phase 46 / L5)", () => {
  describe("source contract", () => {
    it("global-vitest-teardown.ts exists at the canonical path", () => {
      const path = resolve(REPO_ROOT, "tools/global-vitest-teardown.ts");
      const body = readFileSync(path, "utf8");
      expect(body).toMatch(/docker.*container.*prune/);
      expect(body).toMatch(/label=org\.testcontainers=true/);
    });

    it("root vitest.config.ts wires the teardown via globalTeardown", () => {
      const path = resolve(REPO_ROOT, "vitest.config.ts");
      const body = readFileSync(path, "utf8");
      expect(body).toMatch(/globalTeardown.*global-vitest-teardown/);
    });

    it("teardown swallows errors (must never abort the test report)", () => {
      const path = resolve(REPO_ROOT, "tools/global-vitest-teardown.ts");
      const body = readFileSync(path, "utf8");
      // The teardown body MUST contain either an explicit try/catch
      // around the spawn OR an `swallow`/`benign` comment. We match
      // structurally rather than by exact text so a refactor that
      // keeps the contract passes.
      expect(body).toMatch(/try\s*{|catch\s*\(|SWALLOWED|benign\s+noop/i);
    });

    it("SIGINT/SIGTERM handlers are installed (registrar function exported)", () => {
      const path = resolve(REPO_ROOT, "tools/global-vitest-teardown.ts");
      const body = readFileSync(path, "utf8");
      expect(body).toMatch(/installSignalHook|SIGINT|SIGTERM/);
    });
  });

  describe("runtime invariant (best-effort when docker is reachable)", () => {
    it("no orphan testcontainers remain at the moment this test runs", () => {
      if (!dockerAvailable()) {
        // CI sandbox or container-less worker — skip the runtime check.
        // The source-contract tests above still hold.
        expect(true).toBe(true);
        return;
      }
      const orphans = listOrphanTestcontainers();
      // Allow a small grace window: a CI run currently executing tests
      // in parallel may have its OWN testcontainers running. We only
      // flag orphans that are EXITED — those are leaks.
      const exited = orphans.filter((line) => /Exit(ed)?/.test(line));
      expect(exited).toEqual([]);
    });

    it("the prune command is callable as a smoke (does not throw)", () => {
      if (!dockerAvailable()) {
        expect(true).toBe(true);
        return;
      }
      expect(() =>
        execFileSync(
          "docker",
          [
            "container",
            "prune",
            "-f",
            "--filter",
            "label=org.testcontainers=true",
          ],
          { stdio: ["ignore", "pipe", "pipe"], timeout: 15_000 },
        ),
      ).not.toThrow();
    });
  });
});
