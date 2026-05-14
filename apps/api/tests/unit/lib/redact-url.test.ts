// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 13 review HI-02 — Tests for the bootstrap-log URL redactor.
//
// Issue HI-02: each bootstrap catch arm in apps/api/src/index.ts (BullMQ
// email-delivery queue, LiteLLM client, Valkey/Redis client) currently
// logs `(err as Error).message`. Both `new Redis(url)` and Node's URL
// parser can throw errors whose message embeds the offending URL verbatim
// (e.g. `ioredis` "Invalid URL: redis://user:secret@host:6379"), which
// means the container stdout (shipped to Loki in the Phase-6 LGTM stack)
// carries the Valkey password / LiteLLM master key in plaintext.
//
// `redactUrl` parses the offending URL and masks the password component to
// "***" before logging. On parse failure it returns "<unparseable-url>"
// (and the catch arm logs `err.name` only — never `err.message`).
//
// Coverage targets:
//   - credential-bearing URLs round-trip with password redacted
//   - URLs without credentials pass through structurally (no spurious
//     redaction)
//   - garbage strings return the parse-failure sentinel
//   - empty string returns the parse-failure sentinel (defensive: the
//     catch-arm pattern is `redactUrl(process.env.X ?? "")`)

import { describe, expect, it } from "vitest";
import { redactUrl } from "../../../src/lib/redact-url.js";

describe("redactUrl (HI-02)", () => {
  it("masks the password in a credential-bearing redis:// URL", () => {
    // Node's URL serializer does NOT append a trailing slash for non-special
    // schemes like `redis://` (only http/https/ws/wss/ftp/file get the
    // automatic trailing slash). The redactor returns the WHATWG URL
    // canonical form for the scheme, which is what we want — operators see
    // exactly what ioredis received, just with the password masked.
    expect(redactUrl("redis://user:secret@host:6379")).toBe("redis://user:***@host:6379");
  });

  it("masks the password in a credential-bearing https:// URL", () => {
    expect(redactUrl("https://admin:supersecret@litellm:4000/v1")).toBe(
      "https://admin:***@litellm:4000/v1",
    );
  });

  it("masks the password even when the username is empty", () => {
    // `redis://:password@host:6379` is a valid no-user-credential form
    // (ioredis accepts it). Password redaction MUST still apply.
    expect(redactUrl("redis://:onlypassword@host:6379")).toBe("redis://:***@host:6379");
  });

  it("returns no-credential URL structurally unchanged (no spurious '***')", () => {
    const out = redactUrl("redis://host:6379");
    expect(out).toContain("redis://host:6379");
    expect(out).not.toContain("***");
  });

  it("returns the parse-failure sentinel for non-URL garbage strings", () => {
    expect(redactUrl("not-a-url")).toBe("<unparseable-url>");
  });

  it("returns the parse-failure sentinel for the empty string", () => {
    // Defensive: bootstrap call sites use the `process.env.X ?? ""` shape,
    // so the helper must never throw on an empty input.
    expect(redactUrl("")).toBe("<unparseable-url>");
  });

  it("returns the parse-failure sentinel for whitespace-only input", () => {
    // URL constructor throws on " " — the helper must catch.
    expect(redactUrl("   ")).toBe("<unparseable-url>");
  });

  it("HI-02 regression guard: the literal password substring NEVER appears in the redacted output", () => {
    // If a future refactor breaks the masking, this fails loud.
    const out = redactUrl("redis://user:supersecret-password@valkey:6379");
    expect(out).not.toContain("supersecret-password");
  });
});
