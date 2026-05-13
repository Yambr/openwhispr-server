// SPDX-License-Identifier: Apache-2.0
// Phase 02.5 / Plan 01 — RED test for D-01 (explicit Better Auth ↔ drizzle
// schema-key mapping). Goes green when Plan 03 changes apps/api/src/auth.ts
// to import named drizzle tables (users/sessions/accounts/verifications)
// and pass `schema: { user, session, account, verification }` explicitly to
// drizzleAdapter().
//
// Source-of-record: upcoming Plan 03 commit on apps/api/src/auth.ts (replaces
// `import * as schema` + `schema` arg with named imports + explicit map).
//
// Reverts: removing the explicit map (reverting to `import * as schema` +
// `schema`) MUST turn this test red — that is the reverse-patch evidence
// captured in the phase 02.5 SUMMARY (Plan 05).

import { accounts, sessions, users, verifications } from "@openwhispr/data/schema";
import { describe, expect, it, vi } from "vitest";

const captured: {
  schema?: Record<string, unknown>;
  cfg: Record<string, unknown>;
} = { cfg: {} };

vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: (_db: unknown, opts: { schema?: Record<string, unknown> }) => {
    if (opts.schema !== undefined) captured.schema = opts.schema;
    return { id: "stub-adapter" };
  },
}));
vi.mock("better-auth", () => ({
  betterAuth: (cfg: Record<string, unknown>) => {
    captured.cfg = cfg;
    return { options: cfg, _cfg: cfg };
  },
}));
vi.mock("better-auth/plugins/bearer", () => ({ bearer: () => ({ id: "bearer" }) }));
vi.mock("better-auth/plugins/generic-oauth", () => ({
  genericOAuth: () => ({ id: "generic-oauth" }),
}));
vi.mock("../email.js", () => ({
  makeEmailService: () => ({ send: async () => {} }),
}));

// Import buildAuth AFTER mocks are registered (vitest hoists vi.mock).
const { buildAuth } = await import("../auth.js");

describe("buildAuth schema-key mapping (D-01)", () => {
  it("passes schema with Better Auth canonical keys user/session/account/verification", () => {
    process.env.BETTER_AUTH_SECRET = "test-secret-32-chars-long-xxxxxxxxx";
    buildAuth({
      db: {} as never,
      email: { send: async () => {} } as never,
    });
    expect(captured.schema).toBeDefined();
    expect(Object.keys(captured.schema!).sort()).toEqual([
      "account",
      "session",
      "user",
      "verification",
    ]);
  });

  it("maps each canonical key to the matching drizzle table by reference identity", () => {
    // captured by the previous test's buildAuth call (mocks persist across the file)
    expect(captured.schema!.user).toBe(users);
    expect(captured.schema!.session).toBe(sessions);
    expect(captured.schema!.account).toBe(accounts);
    expect(captured.schema!.verification).toBe(verifications);
  });

  it("does not leak the pluralized drizzle export names into the schema arg", () => {
    const keys = new Set(Object.keys(captured.schema!));
    expect(keys.has("users")).toBe(false);
    expect(keys.has("sessions")).toBe(false);
    expect(keys.has("accounts")).toBe(false);
    expect(keys.has("verifications")).toBe(false);
  });
});

// Phase 02.8 / D-01 — Better Auth UUID mode: `advanced.database.generateId: "uuid"`.
// Goes RED if the line is removed from apps/api/src/auth.ts (reverse-patch evidence).
// Resolution chain verified: @better-auth/core get-id-field.mjs:12 reads
// options.advanced?.database?.generateId === "uuid"; @better-auth/drizzle-adapter
// declares supportsUUIDs:true for provider:"pg" → shouldGenerateId=false →
// Postgres `uuid PRIMARY KEY DEFAULT gen_random_uuid()` does the work.
describe("buildAuth UUID mode + plugin allowlist (Phase 02.8 / D-01,D-02)", () => {
  it("sets advanced.database.generateId to 'uuid' (closes 22P02 cascade tail)", () => {
    const advanced = (captured.cfg as { advanced?: { database?: { generateId?: unknown } } })
      ?.advanced;
    expect(advanced).toBeDefined();
    expect(advanced?.database).toBeDefined();
    expect(advanced?.database?.generateId).toBe("uuid");
  });

  it("plugins array contains only UUID-safe entries (no organization/anonymous)", () => {
    // Allowlist check at the buildAuth call level — sanity guard against
    // accidentally registering plugins that import generateId directly from
    // @better-auth/core/utils/id and bypass the database.generateId override.
    const cfg = captured.cfg as { plugins?: Array<{ id?: string }> };
    expect(cfg.plugins).toBeDefined();
    const ids = (cfg.plugins ?? [])
      .map((p) => p?.id)
      .filter((s): s is string => typeof s === "string");
    const denylist = ["organization", "anonymous"];
    for (const id of ids) {
      expect(denylist).not.toContain(id);
    }
  });
});
