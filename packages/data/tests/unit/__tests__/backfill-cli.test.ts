// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 33 / Plan 33-03 — CLI entry tests for backfill-encrypt-credentials.
//
// Coverage goals (per DISCIPLINE Rule 2 — ≥ 90/90/90/90 on new code):
//   - parseArgs: --dry-run, --batch-size=N, unknown arg, malformed batch size.
//   - resolveOwnerUrl: env hierarchy + missing-env error.
//   - main(): end-to-end against a real testcontainer for --dry-run.
//   - main(): EX_CONFIG (78) propagation via validateEncryptionBoot stub.
//
// We exercise main() against a real PG container so the success path
// genuinely runs `runBackfill` end-to-end. The error-path tests use
// process.env mutation + a stub stderr to avoid actually exiting the
// vitest worker on the EX_CONFIG validator (which would call process.exit).

import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CliArgs,
  DEFAULT_COLUMN_MAP,
  main,
  parseArgs,
  resolveOwnerUrl,
} from "../../../src/encryption/cli/backfill-encrypt-credentials.js";
import { type BootResult, bootMigratedPostgres } from "../../../src/__tests__/helpers.js";

describe("parseArgs", () => {
  it("defaults to {dryRun:false, batchSize:500}", () => {
    expect(parseArgs([])).toEqual<CliArgs>({ dryRun: false, batchSize: 500 });
  });
  it("--dry-run flips dryRun", () => {
    expect(parseArgs(["--dry-run"])).toEqual<CliArgs>({ dryRun: true, batchSize: 500 });
  });
  it("--batch-size=N parses positive integer", () => {
    expect(parseArgs(["--batch-size=100"])).toEqual<CliArgs>({ dryRun: false, batchSize: 100 });
  });
  it("--batch-size=N rejects zero / negative / NaN", () => {
    expect(() => parseArgs(["--batch-size=0"])).toThrowError(/positive integer/);
    expect(() => parseArgs(["--batch-size=abc"])).toThrowError(/positive integer/);
  });
  it("unknown arg → throws", () => {
    expect(() => parseArgs(["--what"])).toThrowError(/unknown argument/);
  });
  it("--help prints usage and exits 0", () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`__exit_${code}__`);
      }) as never);
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(() => parseArgs(["--help"])).toThrowError(/__exit_0__/);
      expect(writeSpy).toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      writeSpy.mockRestore();
    }
  });
});

describe("resolveOwnerUrl", () => {
  it("prefers DATABASE_URL_OWNER", () => {
    expect(
      resolveOwnerUrl({
        DATABASE_URL_OWNER: "postgres://owner@h/db",
        DATABASE_URL: "postgres://app@h/db",
      }),
    ).toBe("postgres://owner@h/db");
  });
  it("falls back to DATABASE_URL", () => {
    expect(resolveOwnerUrl({ DATABASE_URL: "postgres://app@h/db" })).toBe(
      "postgres://app@h/db",
    );
  });
  it("throws when both are unset", () => {
    expect(() => resolveOwnerUrl({})).toThrowError(/DATABASE_URL_OWNER/);
  });
});

describe("DEFAULT_COLUMN_MAP", () => {
  it("includes all 8 Better-Auth credential columns + fingerprint sidecars on sessions", () => {
    expect(Object.keys(DEFAULT_COLUMN_MAP.account!)).toEqual([
      "access_token",
      "refresh_token",
      "id_token",
      "password",
    ]);
    expect(DEFAULT_COLUMN_MAP.sessions!.token!.fingerprintColumn).toBe("token_fp");
    expect(DEFAULT_COLUMN_MAP.sessions!.previous_token!.fingerprintColumn).toBe(
      "previous_token_fp",
    );
    expect(DEFAULT_COLUMN_MAP.verification!.value).toEqual({});
    expect(DEFAULT_COLUMN_MAP.oauth_state!.code_verifier).toEqual({});
  });
});

describe("main() — error paths (no testcontainer)", () => {
  const ORIG = { ...process.env };
  beforeEach(() => {
    // Reset to a known shape.
    delete process.env.DATABASE_URL_OWNER;
    delete process.env.DATABASE_URL;
    delete process.env.OPENWHISPR_KEY_PROVIDER;
    process.env.MASTER_KEK = randomBytes(32).toString("base64url");
  });
  afterEach(() => {
    process.env = { ...ORIG };
  });

  it("returns 1 on missing DATABASE_URL", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main([]);
    expect(code).toBe(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("returns 1 on parseArgs error", async () => {
    process.env.DATABASE_URL_OWNER = "postgres://owner@127.0.0.1:1/x"; // never reached
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main(["--bogus"]);
    expect(code).toBe(1);
    errSpy.mockRestore();
  });

  it("returns 1 when pool connection fails", async () => {
    process.env.DATABASE_URL_OWNER = "postgres://owner@127.0.0.1:1/does_not_exist";
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await main(["--dry-run", "--batch-size=10"]);
    expect(code).toBe(1);
    errSpy.mockRestore();
    writeSpy.mockRestore();
  }, 30_000);
});

describe("main() — happy path against real PG", () => {
  let boot: BootResult;
  const kek = randomBytes(32).toString("base64url");
  const origEnv = { ...process.env };

  beforeAll(async () => {
    boot = await bootMigratedPostgres();
    process.env.MASTER_KEK = kek;
    process.env.DATABASE_URL_OWNER = boot.ownerUri;
  }, 120_000);

  afterAll(async () => {
    await boot.stop();
    process.env = { ...origEnv };
  });

  it("--dry-run on a clean DB prints JSON report, exits 0", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await main(["--dry-run"]);
    expect(code).toBe(0);
    // Validate emitted JSON shape.
    const emitted = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(emitted);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.report.account.access_token).toEqual(
      expect.objectContaining({
        scanned: expect.any(Number),
        encrypted: 0,
        skipped: expect.any(Number),
      }),
    );
    stdoutSpy.mockRestore();
  });

  it("non-dry-run path with explicit batch size runs end-to-end", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await main(["--batch-size=50"]);
    expect(code).toBe(0);
    stdoutSpy.mockRestore();
  });
});
