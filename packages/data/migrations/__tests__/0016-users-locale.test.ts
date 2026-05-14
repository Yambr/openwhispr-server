// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 10 / Plan 10-01c — migration 0016: users.locale column.
//
// Adds `users.locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en','ru'))`.
// Per CLAUDE.md "no mocks": real Postgres testcontainer, real DDL.

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BootResult, bootMigratedPostgres } from "../../src/__tests__/helpers.js";

let booted: BootResult | undefined;

beforeAll(async () => {
  booted = await bootMigratedPostgres({ withPgPartman: true });
}, 180_000);

afterAll(async () => {
  if (booted) await booted.stop();
}, 60_000);

describe("0016_users_locale: forward migration", () => {
  it("users.locale column exists with text type, NOT NULL, default 'en'", async () => {
    const pool = new Pool({ connectionString: booted!.ownerUri });
    try {
      const { rows } = await pool.query<{
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        `SELECT data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'locale'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.data_type).toBe("text");
      expect(rows[0]!.is_nullable).toBe("NO");
      // Postgres normalizes string defaults to "'en'::text".
      expect(rows[0]!.column_default).toMatch(/^'en'::text$/);
    } finally {
      await pool.end();
    }
  });

  it("CHECK constraint on users.locale rejects values other than 'en' / 'ru'", async () => {
    const pool = new Pool({ connectionString: booted!.ownerUri });
    try {
      // Seed tenant + user via owner role (BYPASSRLS) so RLS doesn't gate insertion.
      const tenant = await pool.query<{ id: string }>(
        `INSERT INTO tenants (name) VALUES ('t10c') RETURNING id`,
      );
      const tenantId = tenant.rows[0]!.id;
      // 'en' must succeed.
      await expect(
        pool.query(`INSERT INTO users (tenant_id, email, locale) VALUES ($1::uuid, $2, 'en')`, [
          tenantId,
          "a@10c.test",
        ]),
      ).resolves.toBeDefined();
      // 'ru' must succeed.
      await expect(
        pool.query(`INSERT INTO users (tenant_id, email, locale) VALUES ($1::uuid, $2, 'ru')`, [
          tenantId,
          "b@10c.test",
        ]),
      ).resolves.toBeDefined();
      // 'fr' must fail with CHECK violation (SQLSTATE 23514).
      await expect(
        pool.query(`INSERT INTO users (tenant_id, email, locale) VALUES ($1::uuid, $2, 'fr')`, [
          tenantId,
          "c@10c.test",
        ]),
      ).rejects.toThrow(/check/i);
    } finally {
      await pool.end();
    }
  });

  it("existing user rows (inserted without locale) default to 'en'", async () => {
    const pool = new Pool({ connectionString: booted!.ownerUri });
    try {
      const tenant = await pool.query<{ id: string }>(
        `INSERT INTO tenants (name) VALUES ('t10c-default') RETURNING id`,
      );
      const tenantId = tenant.rows[0]!.id;
      const inserted = await pool.query<{ locale: string }>(
        `INSERT INTO users (tenant_id, email) VALUES ($1::uuid, $2) RETURNING locale`,
        [tenantId, "default@10c.test"],
      );
      expect(inserted.rows[0]!.locale).toBe("en");
    } finally {
      await pool.end();
    }
  });
});
