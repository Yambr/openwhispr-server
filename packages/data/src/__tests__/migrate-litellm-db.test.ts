// Phase 03 / Plan 01 / Task 2 — HIGH-1 fix: migrate runner must auto-create
// the `litellm` database from EVERY `docker compose up` so existing-volume
// upgrades from Phase 2 do NOT need a destructive `make clean-stack`.
//
// CLAUDE.md "no workarounds" applies here: initdb scripts ONLY run on a
// freshly-initialized postgres data volume. Operators upgrading from Phase 2
// already have a populated volume; we therefore add a non-destructive
// auto-create to the existing Drizzle migrate runner.
//
// This test boots a real Postgres 17 testcontainer, simulates the upgrade
// path (NO initdb litellm script), and exercises the public
// `ensureLitellmDatabase()` helper directly. We use the same role-bootstrap
// pattern as `helpers.ts` so the owner role exists with CREATEROLE +
// CREATE-DATABASE-grant via OWNER.

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLitellmDatabase, pgIdent } from "../migrate.js";

interface Booted {
  container: StartedPostgreSqlContainer;
  adminUri: string;
  ownerName: string;
  stop: () => Promise<void>;
}

async function bootBareCluster(): Promise<Booted> {
  const ownerPassword = "owner-pw-test";

  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("postgres")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superUri = container.getConnectionUri();
  const superPool = new Pool({ connectionString: superUri });

  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE CREATEDB PASSWORD '${ownerPassword}'`,
  );
  await superPool.end();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  // The migrate runner connects with the OWNER role to the `postgres`
  // maintenance database to issue CREATE DATABASE. CREATEDB granted above
  // is the minimum production POSTGRES_ADMIN_URL pattern (no superuser
  // requirement).
  const adminUri = `postgres://openwhispr_owner:${ownerPassword}@${host}:${port}/postgres`;

  return {
    container,
    adminUri,
    ownerName: "openwhispr_owner",
    stop: async () => {
      await container.stop();
    },
  };
}

async function litellmDbCount(adminUri: string): Promise<number> {
  const pool = new Pool({ connectionString: adminUri });
  try {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_database WHERE datname='litellm'`,
    );
    return Number(rows[0]?.count ?? "0");
  } finally {
    await pool.end();
  }
}

describe("ensureLitellmDatabase — HIGH-1 (Phase 03/Plan 01 Task 2)", () => {
  let booted: Booted;
  const logs: string[] = [];
  const log = (s: string) => logs.push(s);

  beforeEach(async () => {
    booted = await bootBareCluster();
    logs.length = 0;
  }, 120_000);

  afterEach(async () => {
    if (booted) await booted.stop();
  }, 60_000);

  it("creates the litellm database when it is missing", async () => {
    expect(await litellmDbCount(booted.adminUri)).toBe(0);

    await ensureLitellmDatabase(booted.adminUri, booted.ownerName, log);

    expect(await litellmDbCount(booted.adminUri)).toBe(1);
    expect(logs.some((m) => /\[migrate\] created litellm database/.test(m))).toBe(true);
  }, 60_000);

  it("is idempotent on the next up — no duplicate-create attempt, exactly 1 row", async () => {
    await ensureLitellmDatabase(booted.adminUri, booted.ownerName, log);
    expect(await litellmDbCount(booted.adminUri)).toBe(1);

    logs.length = 0;
    await ensureLitellmDatabase(booted.adminUri, booted.ownerName, log);

    expect(await litellmDbCount(booted.adminUri)).toBe(1);
    expect(
      logs.some((m) => /\[migrate\] litellm database already exists — skipping create/.test(m)),
    ).toBe(true);
  }, 60_000);

  it("skips create when the database already exists from a prior install", async () => {
    // Pre-create externally, then call ensureLitellmDatabase — must NOT raise.
    {
      const pool = new Pool({ connectionString: booted.adminUri });
      try {
        await pool.query(`CREATE DATABASE litellm OWNER ${pgIdent(booted.ownerName)}`);
      } finally {
        await pool.end();
      }
    }
    expect(await litellmDbCount(booted.adminUri)).toBe(1);

    await ensureLitellmDatabase(booted.adminUri, booted.ownerName, log);

    expect(await litellmDbCount(booted.adminUri)).toBe(1);
    expect(
      logs.some((m) => /\[migrate\] litellm database already exists — skipping create/.test(m)),
    ).toBe(true);
  }, 60_000);
});

describe("pgIdent — guard against SQL injection in CREATE DATABASE OWNER", () => {
  it("accepts canonical role names", () => {
    expect(pgIdent("openwhispr_owner")).toBe("openwhispr_owner");
    expect(pgIdent("Owner_42")).toBe("Owner_42");
    expect(pgIdent("_role")).toBe("_role");
  });

  it("rejects names with hyphens, spaces, quotes, or non-ASCII", () => {
    expect(() => pgIdent("bad-name")).toThrow();
    expect(() => pgIdent("bad name")).toThrow();
    expect(() => pgIdent('drop"users')).toThrow();
    expect(() => pgIdent("droptable;")).toThrow();
    expect(() => pgIdent("")).toThrow();
    expect(() => pgIdent("9starts_with_digit")).toThrow();
  });
});
