// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 67 / Plan 67-01 — migration 0029: leading user_id FK indexes (HI-02).
//
// HI-02: transcriptions/conversations/messages/notes/folders each declare
// `user_id uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE`, but the
// only indexes touching `user_id` are composite indexes LED BY `tenant_id`.
// `DELETE FROM users` therefore seq-scans all five tables to enforce the
// cascade. Migration 0029 adds a dedicated leading-`user_id` index per table.
// `api_keys` is EXCLUDED — migration 0028 rescoped `api_keys_active_name_idx`
// to lead with `user_id`.
//
// Per CLAUDE.md "no mocks": real Postgres testcontainer, real DDL.

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BootResult, bootMigratedPostgres } from "../../src/__tests__/helpers.js";

const FK_CASCADE_TABLES = [
  "transcriptions",
  "conversations",
  "messages",
  "notes",
  "folders",
] as const;

let booted: BootResult | undefined;

beforeAll(async () => {
  booted = await bootMigratedPostgres({ withPgPartman: false });
}, 180_000);

afterAll(async () => {
  if (booted) await booted.stop();
}, 60_000);

describe("0029_fk_user_id_indexes: forward migration (HI-02)", () => {
  it.each(
    FK_CASCADE_TABLES,
  )("HI-02: %s has an index whose first indexed column is user_id", async (table) => {
    const pool = new Pool({ connectionString: booted!.ownerUri });
    try {
      const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1`,
        [table],
      );
      // The new index is named `<tbl>_user_id_idx` and leads with `(user_id`.
      const leading = rows.filter((r) => /\(user_id\b/.test(r.indexdef));
      expect(
        leading.length,
        `expected a leading-user_id index on ${table}; saw: ${rows
          .map((r) => r.indexdef)
          .join(" | ")}`,
      ).toBeGreaterThanOrEqual(1);
      expect(leading.some((r) => r.indexname === `${table}_user_id_idx`)).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it("HI-02: DELETE FROM users still cascades to a child row (transcriptions)", async () => {
    const pool = new Pool({ connectionString: booted!.ownerUri });
    try {
      const tenant = await pool.query<{ id: string }>(
        `INSERT INTO tenants (name) VALUES ('t67-hi02') RETURNING id`,
      );
      const tenantId = tenant.rows[0]!.id;
      const user = await pool.query<{ id: string }>(
        `INSERT INTO users (tenant_id, email) VALUES ($1::uuid, $2) RETURNING id`,
        [tenantId, "hi02@67.test"],
      );
      const userId = user.rows[0]!.id;
      await pool.query(
        `INSERT INTO transcriptions (tenant_id, user_id, client_transcription_id, text)
         VALUES ($1::uuid, $2::uuid, $3, $4)`,
        [tenantId, userId, "c-hi02", "hello"],
      );
      // The cascade must still succeed and the child row must be gone.
      await pool.query(`DELETE FROM users WHERE id = $1::uuid`, [userId]);
      const { rows } = await pool.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM transcriptions WHERE user_id = $1::uuid`,
        [userId],
      );
      expect(rows[0]!.c).toBe("0");
    } finally {
      await pool.end();
    }
  });
});
