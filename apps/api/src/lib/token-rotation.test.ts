// Phase 2 / Plan 01 + 05 — token-rotation tests.
// Plan 01: hashToken (pure SHA-256).
// Plan 05: recordPreviousToken + tryPreviousToken (DB-touching, fake-recorded).
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  hashToken,
  recordPreviousToken,
  tryPreviousToken,
} from "./token-rotation.js";

describe("hashToken", () => {
  it("returns a 32-byte Buffer", () => {
    const out = hashToken("any-token");
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBe(32);
  });

  it("is deterministic — same input produces same output", () => {
    const a = hashToken("abc123");
    const b = hashToken("abc123");
    expect(a.equals(b)).toBe(true);
  });

  it("produces different output for different inputs", () => {
    const a = hashToken("abc123");
    const b = hashToken("abc124");
    expect(a.equals(b)).toBe(false);
  });

  it("matches a fresh sha256 against the same input", () => {
    const reference = createHash("sha256").update("token-of-interest").digest();
    expect(hashToken("token-of-interest").equals(reference)).toBe(true);
  });

  it("handles empty strings without throwing (sha256 has a defined empty-input output)", () => {
    const out = hashToken("");
    expect(out.length).toBe(32);
  });
});

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

describe("recordPreviousToken", () => {
  it("UPDATEs sessions with previous_token_hash + 5-minute expiry under withTenant", async () => {
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
    const oldHash = hashToken("token-T1");
    await recordPreviousToken(db, TENANT, SESSION_UUID, oldHash);

    // First call: set_config for tenant binding.
    const setConfig = recorded.find((r) => /set_config/i.test(r.sql));
    expect(setConfig).toBeDefined();
    expect(setConfig?.params).toContain(TENANT);

    // Second call: UPDATE sessions ... previous_token_hash + 5 min.
    const update = recorded.find((r) => /UPDATE\s+sessions/i.test(r.sql));
    expect(update).toBeDefined();
    expect(update?.sql).toMatch(/previous_token_hash/);
    expect(update?.sql).toMatch(/5\s+minutes/);
    expect(update?.params).toContainEqual(oldHash);
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
      recordPreviousToken(db, "not-a-uuid", SESSION_UUID, hashToken("x")),
    ).rejects.toThrow(/invalid tenant UUID/i);
  });
});

describe("tryPreviousToken", () => {
  it("returns null for an unknown hash", async () => {
    const db = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    const out = await tryPreviousToken(db, "unknown-bearer");
    expect(out).toBeNull();
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("returns {userId, tenantId} when the SECURITY DEFINER function returns a row", async () => {
    const db = {
      execute: vi.fn().mockResolvedValue({
        rows: [{ user_id: "user-uuid-1", tenant_id: "tenant-uuid-1" }],
      }),
    };
    const out = await tryPreviousToken(db, "old-bearer");
    expect(out).toEqual({ userId: "user-uuid-1", tenantId: "tenant-uuid-1" });
  });

  it("calls lookup_session_by_previous_token with the SHA-256 of the bearer", async () => {
    const captured: { sql: string; params: unknown[] } = { sql: "", params: [] };
    const db = {
      execute: vi.fn().mockImplementation(async (q: unknown) => {
        Object.assign(captured, chunksToText(q));
        return { rows: [] };
      }),
    };
    await tryPreviousToken(db, "rotated-token");
    expect(captured.sql).toMatch(/lookup_session_by_previous_token/);
    // The SHA-256 of "rotated-token" must appear as the bound param.
    const expected = createHash("sha256").update("rotated-token").digest();
    const found = captured.params.find(
      (p) => p instanceof Buffer && (p as Buffer).equals(expected),
    );
    expect(found).toBeDefined();
  });
});
