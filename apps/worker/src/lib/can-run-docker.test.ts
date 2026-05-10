// Phase 03 / Plan 08 back-fill (Stage B) — canRunDocker macOS support.
//
// The original canRunDocker() probe only checked /var/run/docker.sock,
// which on macOS Docker Desktop does NOT exist (Docker Desktop binds to
// ~/.docker/run/docker.sock). The result: every local macOS dev run
// silently skipped the 7-row testcontainer suite for ingest-litellm-spend
// and dropped worker coverage from 94% to 52%.
//
// This test pins the new behavior: the probe MUST also accept the macOS
// Docker Desktop socket path under $HOME/.docker/run/docker.sock.

import { describe, expect, it, vi } from "vitest";
import { canRunDocker } from "./can-run-docker.js";

describe("canRunDocker", () => {
  it("returns true when DOCKER_HOST env is set (CI parity)", () => {
    const env = { DOCKER_HOST: "unix:///some/path" };
    const fakeFs = { existsSync: () => false };
    expect(canRunDocker({ env, fs: fakeFs })).toBe(true);
  });

  it("returns true when /var/run/docker.sock exists (Linux default)", () => {
    const env: Record<string, string | undefined> = {};
    const fakeFs = {
      existsSync: (p: string) => p === "/var/run/docker.sock",
    };
    expect(canRunDocker({ env, fs: fakeFs })).toBe(true);
  });

  it("returns true when ONLY the macOS Docker Desktop socket exists", () => {
    const env = { HOME: "/Users/alice" };
    const macSocket = "/Users/alice/.docker/run/docker.sock";
    const fakeFs = { existsSync: (p: string) => p === macSocket };
    expect(canRunDocker({ env, fs: fakeFs })).toBe(true);
  });

  it("returns false when no docker socket exists and no env hint", () => {
    const env: Record<string, string | undefined> = { HOME: "/Users/alice" };
    const fakeFs = { existsSync: () => false };
    expect(canRunDocker({ env, fs: fakeFs })).toBe(false);
  });

  it("returns false when fs.existsSync throws (defensive)", () => {
    const env: Record<string, string | undefined> = { HOME: "/Users/alice" };
    const fakeFs = {
      existsSync: () => {
        throw new Error("EACCES");
      },
    };
    expect(canRunDocker({ env, fs: fakeFs })).toBe(false);
  });

  it("default-arg path runs without injected deps (uses real fs + process.env)", () => {
    // We can't assert the boolean — depends on the host — but we can
    // assert the function runs without throwing.
    expect(() => canRunDocker()).not.toThrow();
    expect(typeof canRunDocker()).toBe("boolean");
  });

  it.runIf(process.platform === "darwin")(
    "on this macOS dev box detects ~/.docker/run/docker.sock when present",
    () => {
      // Real check: if DOCKER_HOST is unset and the macOS path is the only
      // hint, the function MUST detect it. We don't depend on it being
      // present (CI may not be macOS) — gate via runIf.
      const fs = require("node:fs") as typeof import("node:fs");
      const home = process.env["HOME"] ?? "";
      const path = `${home}/.docker/run/docker.sock`;
      if (!fs.existsSync(path)) return; // skip silently
      // Simulate "no DOCKER_HOST, no /var/run/docker.sock" by injecting.
      const fakeFs = { existsSync: (p: string) => p === path };
      const env = { HOME: home };
      expect(canRunDocker({ env, fs: fakeFs })).toBe(true);
    },
  );
});
