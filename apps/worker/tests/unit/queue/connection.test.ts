// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick-task 260524-u00 / Task A4 — unit tests for buildRedisConnection().
//
// Tests the URL-parsing surface without actually opening a network
// connection (ioredis is mocked at the module boundary — allowed per
// constitutional rule, process boundary).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture every IORedis constructor call so we can assert what URL +
// options the helper passed in. The constructor returns a stub that
// mimics the IORedis surface enough for our tests (no .quit() / .on()
// calls happen in the helper itself; lifecycle stays in the caller).
const ioredisCtorMock = vi.fn();

vi.mock("ioredis", () => {
  // The production code imports the NAMED `Redis` export (the default export's
  // type isn't constructable under the repo's tsc settings). Provide it (and the
  // default, for back-compat) pointing at the same capture class.
  class FakeIORedis {
    constructor(...args: unknown[]) {
      ioredisCtorMock(...args);
    }
  }
  return { default: FakeIORedis, Redis: FakeIORedis };
});

import { buildRedisConnection } from "../../../src/queue/connection.js";

beforeEach(() => {
  ioredisCtorMock.mockClear();
});

describe("buildRedisConnection (Quick-task 260524-u00 / Task A4)", () => {
  it("happy path: VALKEY_URL=redis://valkey:6379 → IORedis(url, opts)", () => {
    buildRedisConnection({ env: { VALKEY_URL: "redis://valkey:6379" } });

    expect(ioredisCtorMock).toHaveBeenCalledTimes(1);
    expect(ioredisCtorMock).toHaveBeenCalledWith("redis://valkey:6379", {
      maxRetriesPerRequest: null,
    });
  });

  it("password-in-URL: redis://:secret@host:6379/0 passed verbatim (ioredis parses URL natively)", () => {
    buildRedisConnection({
      env: { VALKEY_URL: "redis://:p4ssw0rd@valkey.svc:6379/0" },
    });

    expect(ioredisCtorMock).toHaveBeenCalledWith("redis://:p4ssw0rd@valkey.svc:6379/0", {
      maxRetriesPerRequest: null,
    });
  });

  it("rediss:// TLS scheme: passed verbatim (ioredis enables TLS via URL scheme)", () => {
    buildRedisConnection({
      env: { VALKEY_URL: "rediss://valkey.svc.cluster.local:6380" },
    });

    expect(ioredisCtorMock).toHaveBeenCalledWith("rediss://valkey.svc.cluster.local:6380", {
      maxRetriesPerRequest: null,
    });
  });

  it("loud-fail: empty env → throws with set-VALKEY_URL hint", () => {
    expect(() => buildRedisConnection({ env: {} })).toThrow(/VALKEY_URL is required/);
    expect(ioredisCtorMock).not.toHaveBeenCalled();
  });

  it("migration hint: VALKEY_HOST set but VALKEY_URL unset → throws with chart-1.0.6 migration message", () => {
    expect(() =>
      buildRedisConnection({
        env: {
          VALKEY_HOST: "valkey",
          VALKEY_PORT: "6379",
          VALKEY_PASSWORD: "old-style",
        },
      }),
    ).toThrow(/split VALKEY_HOST\/PORT\/PASSWORD env was removed in chart-1\.0\.6/);
    expect(ioredisCtorMock).not.toHaveBeenCalled();
  });

  it("returns the IORedis instance for BullMQ Worker { connection } consumption", () => {
    const conn = buildRedisConnection({ env: { VALKEY_URL: "redis://valkey:6379" } });
    expect(conn).toBeDefined();
    // The returned value is the FakeIORedis stub from the mock — proves the
    // helper hands it back to the caller (which BullMQ accepts as `connection`).
    expect(conn.constructor.name).toBe("FakeIORedis");
  });

  it("defaults env to process.env when opts.env is absent (production call-site)", () => {
    const orig = process.env["VALKEY_URL"];
    process.env["VALKEY_URL"] = "redis://test-process-env:6379";
    try {
      buildRedisConnection();
      expect(ioredisCtorMock).toHaveBeenCalledWith("redis://test-process-env:6379", {
        maxRetriesPerRequest: null,
      });
    } finally {
      if (orig === undefined) delete process.env["VALKEY_URL"];
      else process.env["VALKEY_URL"] = orig;
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
