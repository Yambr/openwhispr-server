// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 05 / Task 1 — client-id-upsert helper unit tests.
//
// Pure JS with a recording fake tx — asserts the SQL fragments emit
// the right shape (`ON CONFLICT ... DO NOTHING`, `RETURNING *`), the
// null-clientId path skips the conflict clause, and the conflict path
// falls back to SELECT. Companion integration tests in the notes/
// route suite exercise these against a real Postgres testcontainer.
import { describe, expect, it } from "vitest";
import { createOrReturnExisting } from "../../../../src/lib/client-id-upsert.js";

interface Recorded {
  sql: string;
  params: unknown[];
}

function stringify(query: unknown): { sql: string; params: unknown[] } {
  const q = query as { queryChunks?: unknown[] };
  const chunks = q.queryChunks ?? [];
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const c of chunks) {
    if (typeof c === "string") {
      parts.push(c);
    } else if (c && typeof c === "object") {
      if ("queryChunks" in c) {
        const inner = stringify(c);
        parts.push(inner.sql);
        params.push(...inner.params);
      } else if ("value" in c) {
        const v = (c as { value: unknown }).value;
        if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
          // sql.raw produces a value that is a string[] of fragments;
          // these are NOT parameters, they're inline SQL.
          parts.push((v as string[]).join(""));
        } else {
          parts.push("?");
          params.push(v);
        }
      } else {
        parts.push(String(c));
      }
    }
  }
  return { sql: parts.join(""), params };
}

interface FakeTxOpts {
  /** rows to return from the first execute() call (INSERT). */
  insertRows?: unknown[];
  /** rows to return from the second execute() call (SELECT fallback). */
  selectRows?: unknown[];
}

function makeFakeTx(opts: FakeTxOpts = {}): {
  tx: { execute(q: unknown): Promise<unknown> };
  recorded: Recorded[];
} {
  const recorded: Recorded[] = [];
  let call = 0;
  const tx = {
    async execute(query: unknown): Promise<unknown> {
      const flat = stringify(query);
      recorded.push(flat);
      call += 1;
      if (call === 1) return { rows: opts.insertRows ?? [] };
      return { rows: opts.selectRows ?? [] };
    },
  };
  return { tx, recorded };
}

const TENANT = "00000000-0000-0000-0000-000000000000";
const USER = "11111111-1111-1111-1111-111111111111";
const NOTE_ID = "22222222-2222-2222-2222-222222222222";

describe("createOrReturnExisting — Pattern 1 (D-24 partial UNIQUE)", () => {
  it("emits ON CONFLICT ... DO NOTHING RETURNING * on the clientId path", async () => {
    const { tx, recorded } = makeFakeTx({
      insertRows: [{ id: NOTE_ID, client_note_id: "abc", title: "t" }],
    });
    const { row, created } = await createOrReturnExisting<{
      id: string;
      client_note_id: string;
      title: string;
    }>(tx, {
      table: "notes",
      clientIdColumn: "client_note_id",
      tenantId: TENANT,
      userId: USER,
      clientIdValue: "abc",
      insertValues: {
        tenant_id: TENANT,
        user_id: USER,
        client_note_id: "abc",
        title: "t",
        content: "hello",
      },
    });
    expect(created).toBe(true);
    expect(row.id).toBe(NOTE_ID);
    const insertSql = recorded[0]?.sql ?? "";
    expect(insertSql).toMatch(/INSERT INTO "notes"/);
    expect(insertSql).toMatch(/ON CONFLICT.*"client_note_id"/);
    expect(insertSql).toMatch(/DO NOTHING/);
    expect(insertSql).toMatch(/RETURNING \*/);
  });

  it("returns existing row with created=false on conflict (SELECT fallback)", async () => {
    const { tx, recorded } = makeFakeTx({
      insertRows: [],
      selectRows: [{ id: NOTE_ID, client_note_id: "abc", title: "existing" }],
    });
    const { row, created } = await createOrReturnExisting<{
      id: string;
      client_note_id: string;
      title: string;
    }>(tx, {
      table: "notes",
      clientIdColumn: "client_note_id",
      tenantId: TENANT,
      userId: USER,
      clientIdValue: "abc",
      insertValues: {
        tenant_id: TENANT,
        user_id: USER,
        client_note_id: "abc",
        title: "new-title-ignored",
        content: "new",
      },
    });
    expect(created).toBe(false);
    expect(row.title).toBe("existing");
    expect(recorded.length).toBe(2);
    const selectSql = recorded[1]?.sql ?? "";
    expect(selectSql).toMatch(/SELECT \* FROM "notes"/);
    expect(selectSql).toMatch(/"tenant_id" = /);
    expect(selectSql).toMatch(/"user_id" = /);
    expect(selectSql).toMatch(/"client_note_id" = /);
  });

  it("Pitfall #2 — null clientId path ALWAYS inserts (no ON CONFLICT clause)", async () => {
    const { tx, recorded } = makeFakeTx({
      insertRows: [{ id: NOTE_ID, client_note_id: null }],
    });
    const { row, created } = await createOrReturnExisting<{
      id: string;
      client_note_id: string | null;
    }>(tx, {
      table: "notes",
      clientIdColumn: "client_note_id",
      tenantId: TENANT,
      userId: USER,
      clientIdValue: null,
      insertValues: {
        tenant_id: TENANT,
        user_id: USER,
        title: "untitled",
        content: "",
      },
    });
    expect(created).toBe(true);
    expect(row.id).toBe(NOTE_ID);
    const insertSql = recorded[0]?.sql ?? "";
    expect(insertSql).toMatch(/INSERT INTO "notes"/);
    expect(insertSql).not.toMatch(/ON CONFLICT/);
    expect(insertSql).toMatch(/RETURNING \*/);
  });

  it("undefined clientId is treated the same as null (no ON CONFLICT)", async () => {
    const { tx, recorded } = makeFakeTx({
      insertRows: [{ id: NOTE_ID }],
    });
    await createOrReturnExisting(tx, {
      table: "notes",
      clientIdColumn: "client_note_id",
      tenantId: TENANT,
      userId: USER,
      clientIdValue: undefined,
      insertValues: { tenant_id: TENANT, user_id: USER, title: "x", content: "" },
    });
    expect(recorded[0]?.sql ?? "").not.toMatch(/ON CONFLICT/);
  });

  it("rejects unsafe table identifier", async () => {
    const { tx } = makeFakeTx();
    await expect(
      createOrReturnExisting(tx, {
        table: "notes; DROP TABLE users; --",
        clientIdColumn: "client_note_id",
        tenantId: TENANT,
        userId: USER,
        clientIdValue: "abc",
        insertValues: { tenant_id: TENANT },
      }),
    ).rejects.toThrow(/unsafe identifier/);
  });

  it("rejects unsafe column identifier", async () => {
    const { tx } = makeFakeTx();
    await expect(
      createOrReturnExisting(tx, {
        table: "notes",
        clientIdColumn: "x; DROP",
        tenantId: TENANT,
        userId: USER,
        clientIdValue: "abc",
        insertValues: { tenant_id: TENANT },
      }),
    ).rejects.toThrow(/unsafe identifier/);
  });

  it("throws when ON CONFLICT lost AND SELECT fallback finds nothing (race)", async () => {
    const { tx } = makeFakeTx({ insertRows: [], selectRows: [] });
    await expect(
      createOrReturnExisting(tx, {
        table: "notes",
        clientIdColumn: "client_note_id",
        tenantId: TENANT,
        userId: USER,
        clientIdValue: "ghost",
        insertValues: { tenant_id: TENANT, user_id: USER, title: "t", content: "" },
      }),
    ).rejects.toThrow(/no existing row found/);
  });

  it("throws when null-clientId INSERT yields no RETURNING row (driver fault)", async () => {
    const { tx } = makeFakeTx({ insertRows: [] });
    await expect(
      createOrReturnExisting(tx, {
        table: "notes",
        clientIdColumn: "client_note_id",
        tenantId: TENANT,
        userId: USER,
        clientIdValue: null,
        insertValues: { tenant_id: TENANT, user_id: USER, title: "t", content: "" },
      }),
    ).rejects.toThrow(/INSERT RETURNING produced no row/);
  });
});
