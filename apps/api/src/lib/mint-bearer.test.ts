// Phase 2 / Plan 08 / Task 1 — `buildMintBearer` adapter unit tests.
//
// Closes 02-VERIFICATION.md Gap 1: production MintBearer adapter that
// invokes Better Auth's universal Web Request handler at
// `/api/auth/oauth2/callback/${provider}` and extracts the opaque bearer
// token from either the `set-auth-token` response header (primary path —
// emitted by Better Auth's bearer plugin on any auth-mutating response,
// see node_modules/better-auth/dist/plugins/bearer/index.mjs:71-72) or
// the JSON body's `token` field (fallback for variants that surface the
// session token in the response body).
import { describe, expect, it, vi } from "vitest";
import { buildMintBearer } from "./mint-bearer.js";

interface FakeAuth {
  handler: (req: Request) => Promise<Response>;
}

const ARGS = {
  code: "auth-code-fixture",
  codeVerifier: "verifier-fixture",
  stateId: "11111111-2222-3333-4444-555555555555",
  provider: "oidc",
  tenantId: "00000000-0000-0000-0000-000000000000",
  scheme: "openwhispr",
};

describe("buildMintBearer", () => {
  it("returns the bearer from the `set-auth-token` response header", async () => {
    const handler = vi.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: { "set-auth-token": "OPAQUE_BEARER_FROM_HEADER" },
      });
    });
    const fakeAuth: FakeAuth = { handler };
    const mint = buildMintBearer({
      auth: fakeAuth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    const token = await mint(ARGS);
    expect(token).toBe("OPAQUE_BEARER_FROM_HEADER");
    expect(handler).toHaveBeenCalledTimes(1);
    const calls = (handler as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    const req = calls[0]?.[0] as Request;
    expect(req.url).toMatch(/\/api\/auth\/oauth2\/callback\/oidc/);
    expect(req.url).toContain(`code=${ARGS.code}`);
    expect(req.url).toContain(`state=${ARGS.stateId}`);
  });

  it("falls back to JSON body `token` when no set-auth-token header", async () => {
    const handler = vi.fn(async () => {
      return new Response(JSON.stringify({ token: "OPAQUE_FROM_BODY" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const fakeAuth: FakeAuth = { handler };
    const mint = buildMintBearer({
      auth: fakeAuth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    const token = await mint(ARGS);
    expect(token).toBe("OPAQUE_FROM_BODY");
  });

  it("THROWS when response status >= 400", async () => {
    const handler = vi.fn(async () => new Response("nope", { status: 400 }));
    const fakeAuth: FakeAuth = { handler };
    const mint = buildMintBearer({
      auth: fakeAuth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    await expect(mint(ARGS)).rejects.toThrow(/mint bearer failed: 400/);
  });

  it("THROWS when no header AND no body token present", async () => {
    const handler = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const fakeAuth: FakeAuth = { handler };
    const mint = buildMintBearer({
      auth: fakeAuth as unknown as Parameters<typeof buildMintBearer>[0]["auth"],
    });
    await expect(mint(ARGS)).rejects.toThrow(/mint bearer failed/);
  });
});
