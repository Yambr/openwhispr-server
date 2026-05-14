// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 13 / Plan 01 / Task 02 — unit tests for global-vitest-teardown.ts.
//
// Scope (per plan behavior contract):
//   (a) default export invokes execFileSync with exact argv
//       ["container","prune","-f","--filter","label=org.testcontainers=true"]
//       and binary "docker";
//   (b) catches and swallows execFileSync throws (never re-throws);
//   (c) installSignalHook() is idempotent — two calls register exactly one
//       SIGINT listener and one SIGTERM listener (net new = 1 each);
//   (d) SIGINT handler calls process.exit(130) and SIGTERM handler calls
//       process.exit(143). Both call pruneTestcontainers() first.
//
// `execFileSync` is a process boundary (legitimate mock per
// `feedback_no_workarounds_enterprise.md` and CLAUDE.md guardrails).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mock of node:child_process. The `execFileSync` symbol is the
// single boundary we replace; everything else is real.
const execFileSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

import globalTeardown, { __resetForTests, installSignalHook } from "../global-vitest-teardown";

describe("global-vitest-teardown", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  // Track listeners we add via installSignalHook so we can deterministically
  // remove them in afterEach (we never want a test-suite-level SIGINT to
  // exit the vitest process at 130).
  let sigintBefore: number;
  let sigtermBefore: number;

  beforeEach(() => {
    execFileSyncMock.mockReset();
    __resetForTests();
    sigintBefore = process.listenerCount("SIGINT");
    sigtermBefore = process.listenerCount("SIGTERM");
    // `process.exit` would terminate the vitest runner; spy + stub.
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      // Throw a sentinel so the handler unwinds and the caller can assert
      // on `code` without actually exiting.
      const err = new Error(`__exit_${code}__`);
      (err as Error & { code?: number }).code = code;
      throw err;
    }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    // Strip any listeners that installSignalHook attached in this test so
    // the next test starts clean and so vitest's own SIGINT handling isn't
    // hijacked by our exit-stubbing handler after the suite ends.
    const sigintAfter = process.listeners("SIGINT");
    for (let i = sigintBefore; i < sigintAfter.length; i += 1) {
      process.off("SIGINT", sigintAfter[i] as (...args: unknown[]) => void);
    }
    const sigtermAfter = process.listeners("SIGTERM");
    for (let i = sigtermBefore; i < sigtermAfter.length; i += 1) {
      process.off("SIGTERM", sigtermAfter[i] as (...args: unknown[]) => void);
    }
  });

  it("(a) globalTeardown invokes execFileSync with the docker prune argv", async () => {
    await globalTeardown();
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    const [bin, argv, opts] = execFileSyncMock.mock.calls[0];
    expect(bin).toBe("docker");
    expect(argv).toEqual(["container", "prune", "-f", "--filter", "label=org.testcontainers=true"]);
    expect(opts).toMatchObject({ stdio: "inherit" });
  });

  it("(b) globalTeardown swallows execFileSync throws (never re-throws)", async () => {
    execFileSyncMock.mockImplementation(() => {
      const err = new Error("docker: not found") as Error & { code?: string };
      err.code = "ENOENT";
      throw err;
    });
    // Must not throw.
    await expect(globalTeardown()).resolves.toBeUndefined();
  });

  it("(c) installSignalHook is idempotent — two calls add exactly one listener per signal", () => {
    installSignalHook();
    installSignalHook();
    expect(process.listenerCount("SIGINT") - sigintBefore).toBe(1);
    expect(process.listenerCount("SIGTERM") - sigtermBefore).toBe(1);
  });

  it("(d) SIGINT handler calls pruneTestcontainers then process.exit(130)", () => {
    installSignalHook();
    const handlers = process.listeners("SIGINT");
    const ours = handlers[handlers.length - 1] as (...args: unknown[]) => void;
    expect(() => ours("SIGINT")).toThrow(/__exit_130__/);
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(130);
  });

  it("(d) SIGTERM handler calls pruneTestcontainers then process.exit(143)", () => {
    installSignalHook();
    const handlers = process.listeners("SIGTERM");
    const ours = handlers[handlers.length - 1] as (...args: unknown[]) => void;
    expect(() => ours("SIGTERM")).toThrow(/__exit_143__/);
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(143);
  });
});
