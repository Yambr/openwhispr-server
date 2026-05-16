// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 02.12 — Better-Auth-native plain-text token storage.
// Phase 02 Plan 01's `hashToken` (SHA-256) helper was removed; the
// AUTH-04 5-minute overlap CONTRACT survives via plain-text storage on
// `sessions.previous_token`. Tests below assert recordPreviousToken +
// tryPreviousToken operate on plain-text bearer values directly.
import { describe, expect, it, vi } from "vitest";
import { recordPreviousToken, tryPreviousToken } from "../../../src/lib/token-rotation.js";

// ---------------------------------------------------------------------------
// Plan 05 / Task 3 — DB-touching helpers (recordPreviousToken, tryPreviousToken).
// ---------------------------------------------------------------------------

interface RecordedQuery {
  sql: string;
  params: readonly unknown[];
}

function chunksToText(query: unknown): RecordedQuery {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const c of chunks) {
    if (typeof c === "string") {
      parts.push("?");
      params.push(c);
    } else if (typeof c === "number" || typeof c === "boolean" || c instanceof Buffer) {
      parts.push("?");
      params.push(c);
    } else if (c && typeof c === "object" && "value" in c) {
      const v = (c as { value: unknown }).value;
      if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
        parts.push((v as string[]).join(""));
      } else {
        parts.push("?");
        params.push(v);
      }
    } else {
      parts.push(String(c));
    }
  }
  return { sql: parts.join(""), params };
}

const TENANT = "00000000-0000-0000-0000-000000000000";
const SESSION_UUID = "11111111-2222-3333-4444-555555555555";

type FakeTx = { execute(query: unknown): Promise<unknown> };

describe("recordPreviousToken (Phase 02.12 plain-text)", () => {
  it("UPDATEs sessions with previous_token + 5-minute expiry under withTenant", async () => {
    const recorded: RecordedQuery[] = [];
    const tx: FakeTx = {
      async execute(q: unknown): Promise<unknown> {
        recorded.push(chunksToText(q));
        return { rows: [] };
      },
    };
    const db = {
      async transaction<T>(cb: (tx: FakeTx) => Promise<T>): Promise<T> {
        return cb(tx);
      },
    };
    const oldToken = "plain-bearer-T1";
    await recordPreviousToken(db, TENANT, SESSION_UUID, oldToken);

    // First call: set_config for tenant binding.
    const setConfig = recorded.find((r) => /set_config/i.test(r.sql));
    expect(setConfig).toBeDefined();
    expect(setConfig?.params).toContain(TENANT);

    // Second call: UPDATE sessions ... previous_token (text) + 5 min.
    const update = recorded.find((r) => /UPDATE\s+sessions/i.test(r.sql));
    expect(update).toBeDefined();
    // Phase 02.12 — column is now `previous_token` (text), not `previous_token_hash`.
    expect(update?.sql).toMatch(/previous_token\b/);
    expect(update?.sql).not.toMatch(/previous_token_hash/);
    expect(update?.sql).toMatch(/5\s+minutes/);
    expect(update?.params).toContain(oldToken);
    expect(update?.params).toContain(SESSION_UUID);
  });

  it("rejects an invalid tenant UUID via withTenant guard", async () => {
    const tx: FakeTx = {
      async execute(): Promise<unknown> {
        return { rows: [] };
      },
    };
    const db = {
      async transaction<T>(cb: (tx: FakeTx) => Promise<T>): Promise<T> {
        return cb(tx);
      },
    };
    await expect(
      recordPreviousToken(db, "not-a-uuid", SESSION_UUID, "plain-bearer-x"),
    ).rejects.toThrow(/invalid tenant UUID/i);
  });
});

describe("tryPreviousToken (Phase 02.12 plain-text)", () => {
  it("returns null for an unknown bearer", async () => {
    const db = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    const out = await tryPreviousToken(db, "unknown-bearer");
    expect(out).toBeNull();
    // Only the SECURITY DEFINER lookup runs when the bearer is unknown
    // (no email follow-up needed).
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("returns {userId, tenantId, email} when the SECURITY DEFINER function returns a row (WR-05)", async () => {
    let call = 0;
    const db = {
      execute: vi.fn().mockImplementation(async () => {
        call += 1;
        if (call === 1) {
          return {
            rows: [{ user_id: "user-uuid-1", tenant_id: "tenant-uuid-1" }],
          };
        }
        return { rows: [{ email: "user1@example.test" }] };
      }),
    };
    const out = await tryPreviousToken(db, "old-bearer");
    expect(out).toEqual({
      userId: "user-uuid-1",
      tenantId: "tenant-uuid-1",
      email: "user1@example.test",
    });
  });

  it("WR-05: returns email=null (NOT empty string) when the user row was deleted mid-rotation", async () => {
    let call = 0;
    const db = {
      execute: vi.fn().mockImplementation(async () => {
        call += 1;
        if (call === 1) {
          return {
            rows: [{ user_id: "user-uuid-1", tenant_id: "tenant-uuid-1" }],
          };
        }
        return { rows: [] };
      }),
    };
    const out = await tryPreviousToken(db, "old-bearer");
    expect(out).not.toBeNull();
    // Fail-loud sentinel: null is OBVIOUS to consumers; pre-fix code in
    // index.ts hard-coded "" which silently propagated through audit
    // logs and ledger metadata.
    expect(out?.email).toBeNull();
    expect(out?.userId).toBe("user-uuid-1");
    expect(out?.tenantId).toBe("tenant-uuid-1");
  });

  it("WR-05: returns email=null when the email follow-up query throws (defensive)", async () => {
    let call = 0;
    const db = {
      execute: vi.fn().mockImplementation(async () => {
        call += 1;
        if (call === 1) {
          return {
            rows: [{ user_id: "user-uuid-1", tenant_id: "tenant-uuid-1" }],
          };
        }
        throw new Error("RLS denied");
      }),
    };
    const out = await tryPreviousToken(db, "old-bearer");
    expect(out).not.toBeNull();
    expect(out?.email).toBeNull();
  });

  it("Phase 33 / Plan 33-04 — issues a SHA-256 fingerprint probe against sessions.previous_token_fp (no SECURITY DEFINER function call)", async () => {
    const captured: { sql: string; params: unknown[] } = { sql: "", params: [] };
    const db = {
      execute: vi.fn().mockImplementation(async (q: unknown) => {
        Object.assign(captured, chunksToText(q));
        return { rows: [] };
      }),
    };
    await tryPreviousToken(db, "rotated-token");
    // Migration 0019b dropped lookup_session_by_previous_token; the query
    // now references the fp index directly.
    expect(captured.sql).not.toMatch(/lookup_session_by_previous_token/);
    expect(captured.sql).toMatch(/previous_token_fp/);
    // The bearer plaintext is hashed in-process before binding — the
    // bound param is the bytea(32) SHA-256 digest, NOT the plaintext.
    const { createHash } = await import("node:crypto");
    const expectedFp = createHash("sha256").update("rotated-token", "utf8").digest();
    const bufferParam = captured.params.find((p): p is Buffer => p instanceof Buffer);
    expect(bufferParam).toBeDefined();
    expect(bufferParam?.equals(expectedFp)).toBe(true);
    // The plaintext bearer must NOT appear as a query param post-33-04.
    expect(captured.params).not.toContain("rotated-token");
  });
});
