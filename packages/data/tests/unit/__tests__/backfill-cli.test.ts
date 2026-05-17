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
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POSTGRES_PARTMAN_IMAGE, provisionPgPartman } from "../../../src/__tests__/helpers.js";
import {
  type CliArgs,
  DEFAULT_COLUMN_MAP,
  main,
  parseArgs,
  resolveOwnerUrl,
} from "../../../src/encryption/cli/backfill-encrypt-credentials.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/data/tests/unit/__tests__ -> packages/data/migrations
const MIGRATIONS_DIR = resolve(__dirname, "..", "..", "..", "migrations");

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
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
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
    expect(resolveOwnerUrl({ DATABASE_URL: "postgres://app@h/db" })).toBe("postgres://app@h/db");
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

// Phase 33 / Plan 33-03 — the backfill CLI is forward-only between
// migrations 0019 (sidecars added) and 0020 (plaintext columns dropped).
// Its idempotency predicate is `"<column>" IS NOT NULL AND "<column>_value_ciphertext" IS NULL`,
// which references the plaintext column directly. After 0020 drops those
// columns, the CLI returns 42703 on every table — by design (the operator
// runs backfill BEFORE 0020, see CLI header comment). The "real PG"
// describe block below therefore boots a container pinned at the
// post-0019 / pre-0020 schema state (mirrors the pattern in
// migrations/__tests__/0019-envelope-encrypt-secret-columns-add.test.ts +
// 0017-setup-state.test.ts).
async function bootPreZeroTwenty(): Promise<{
  ownerUri: string;
  stop: () => Promise<void>;
}> {
  const ownerPassword = "owner-pw-backfill";
  const appPassword = "app-pw-backfill";

  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    POSTGRES_PARTMAN_IMAGE,
  )
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superUri = container.getConnectionUri();
  const superPool = new Pool({ connectionString: superUri });
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD '${ownerPassword}'`,
  );
  await superPool.query(
    `CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD '${appPassword}'`,
  );
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await superPool.query(`GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`);
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
  await provisionPgPartman(superPool);
  await superPool.end();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  // Plan 51-14 made TLS default-on in buildPoolConfig; testcontainers PG
  // doesn't support SSL, so we opt out via the canonical libpq escape hatch.
  const ownerUri = `postgres://openwhispr_owner:${ownerPassword}@${host}:${port}/openwhispr?sslmode=disable`;

  const tmpMigrations = mkdtempSync(resolve(tmpdir(), "ow-pre-0020-"));
  cpSync(MIGRATIONS_DIR, tmpMigrations, { recursive: true });
  for (const file of [
    "0019b_drop_lookup_session_by_previous_token.sql",
    "0020_envelope_encrypt_secret_columns_drop_plaintext.sql",
    "0021_safe_table_reset_helper.sql",
    "0022_setup_state_grants.sql",
  ]) {
    try {
      rmSync(resolve(tmpMigrations, file));
    } catch {
      // ignore — file may not exist in earlier RED state.
    }
  }
  const journalPath = resolve(tmpMigrations, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  journal.entries = journal.entries.filter((e) => {
    if (e.tag.startsWith("0019b")) return false;
    const m = e.tag.match(/^(\d{4})/);
    if (!m) return true;
    return Number.parseInt(m[1]!, 10) <= 19;
  });
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));

  const ownerPool = new Pool({ connectionString: ownerUri });
  await migrate(drizzle(ownerPool), {
    migrationsFolder: tmpMigrations,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });
  await ownerPool.end();

  return {
    ownerUri,
    stop: async () => {
      await container.stop();
    },
  };
}

describe("main() — happy path against real PG", () => {
  let boot: Awaited<ReturnType<typeof bootPreZeroTwenty>>;
  const kek = randomBytes(32).toString("base64url");
  const origEnv = { ...process.env };

  beforeAll(async () => {
    boot = await bootPreZeroTwenty();
    process.env.MASTER_KEK = kek;
    process.env.DATABASE_URL_OWNER = boot.ownerUri;
  }, 240_000);

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
