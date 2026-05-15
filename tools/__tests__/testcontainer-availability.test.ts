// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * testcontainer-availability.test.ts — Phase 18.1.2 / Plan 01 / Task 01.
 *
 * Sibling unit covering the Docker availability probe (D-02). The probe must:
 *   (a) return `true` when `docker info` exits 0, leaving env untouched;
 *   (b) return `false` when `execFileSync("docker", ["info"])` throws
 *       (daemon-down / ENOENT socket), set
 *       `process.env.OPENWHISPR_SKIP_TESTCONTAINERS = "1"`, log a structured
 *       warning, and NEVER rethrow (pitfall §1 — a throw from the reaper
 *       setupFile chain breaks downstream setupFiles);
 *   (c) treat the `timeout: 2000` ETIMEDOUT throw identically to (b);
 *   (d) be idempotent on the structured warning — re-invocation under
 *       daemon-down logs once (memoised), env stays "1".
 *
 * `execFileSync` is a process boundary (legitimate mock per
 * `feedback_no_workarounds_enterprise.md` and CLAUDE.md guardrails).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted boundary mock — only `execFileSync` is replaced.
const execFileSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

import { __resetForTests, assertDockerAvailable } from "../testcontainer-availability";

describe("tools/testcontainer-availability.ts", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let priorEnv: string | undefined;

  beforeEach(() => {
    execFileSyncMock.mockReset();
    __resetForTests();
    priorEnv = process.env.OPENWHISPR_SKIP_TESTCONTAINERS;
    delete process.env.OPENWHISPR_SKIP_TESTCONTAINERS;
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (priorEnv === undefined) delete process.env.OPENWHISPR_SKIP_TESTCONTAINERS;
    else process.env.OPENWHISPR_SKIP_TESTCONTAINERS = priorEnv;
  });

  it("(a) daemon-up → returns true; env NOT mutated; no warning", () => {
    execFileSyncMock.mockReturnValue(Buffer.from(""));
    const result = assertDockerAvailable();
    expect(result).toBe(true);
    expect(process.env.OPENWHISPR_SKIP_TESTCONTAINERS).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    const [bin, argv, opts] = execFileSyncMock.mock.calls[0];
    expect(bin).toBe("docker");
    expect(argv).toEqual(["info"]);
    expect(opts).toMatchObject({ timeout: 2000 });
  });

  it("(b) daemon-down (ENOENT socket) → returns false; env=1; structured warn; NEVER throws", () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("connect ENOENT /var/run/docker.sock");
    });
    let result: boolean | undefined;
    expect(() => {
      result = assertDockerAvailable();
    }).not.toThrow();
    expect(result).toBe(false);
    expect(process.env.OPENWHISPR_SKIP_TESTCONTAINERS).toBe("1");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Structured: single-line JSON-shaped payload with event + reason.
    const [payload] = warnSpy.mock.calls[0] as [string];
    expect(payload).toContain("docker.unavailable");
    expect(payload).toContain("ENOENT");
  });

  it("(c) ETIMEDOUT from execFileSync timeout:2000 → returns false; env=1; no rethrow", () => {
    execFileSyncMock.mockImplementation(() => {
      const err = new Error("timeout exceeded") as Error & { code?: string };
      err.code = "ETIMEDOUT";
      throw err;
    });
    let result: boolean | undefined;
    expect(() => {
      result = assertDockerAvailable();
    }).not.toThrow();
    expect(result).toBe(false);
    expect(process.env.OPENWHISPR_SKIP_TESTCONTAINERS).toBe("1");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("(d) idempotent — two consecutive daemon-down calls warn exactly once", () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("connect ENOENT /var/run/docker.sock");
    });
    assertDockerAvailable();
    assertDockerAvailable();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(process.env.OPENWHISPR_SKIP_TESTCONTAINERS).toBe("1");
  });
});
