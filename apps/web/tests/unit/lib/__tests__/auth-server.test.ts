// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 05 — auth-server unit tests (RED before GREEN).
//
// `getServerSession()` calls Better Auth's session endpoint over HTTP from
// the web RSC, forwarding the incoming Cookie header (Pitfall 2). We mock
// `next/headers` and `fetch` at the network boundary only (CLAUDE.md).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Vitest mock call accessor that narrows the tuple shape so
// noUncheckedIndexedAccess is satisfied.
function firstCall(mock: unknown): [string, RequestInit] {
  const calls = (mock as { mock: { calls: unknown[][] } }).mock.calls;
  const call = calls[0];
  if (!call) throw new Error("expected fetch mock to be called at least once");
  return [call[0] as string, (call[1] ?? {}) as RequestInit];
}

const headersMock = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

describe("auth-server.getServerSession (Phase 07.1 / Plan 05)", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.INTERNAL_API_URL;

  beforeEach(() => {
    process.env.INTERNAL_API_URL = "http://api:3000";
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.INTERNAL_API_URL = originalEnv;
    vi.restoreAllMocks();
    headersMock.mockReset();
  });

  it("returns the session object when Better Auth responds 200 with a populated body", async () => {
    headersMock.mockResolvedValue(new Headers({ cookie: "openwhispr.session_token=abc" }));
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            session: { id: "s1", userId: "u1" },
            user: { id: "u1", email: "x@y.com", emailVerified: true },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const { getServerSession } = await import("../../../../src/lib/auth-server");
    const session = await getServerSession();

    expect(session).not.toBeNull();
    expect(session?.user.id).toBe("u1");
    expect(session?.session.id).toBe("s1");

    // Cookie forwarding (Pitfall 2): cookie header from next/headers() MUST
    // be propagated on the upstream fetch.
    const [url, init] = firstCall(fetchMock);
    expect(url).toBe("http://api:3000/api/auth/get-session");
    expect((init.headers as Record<string, string>).cookie).toBe("openwhispr.session_token=abc");
  });

  it("returns null when no cookie header is present (unauthenticated RSC visit)", async () => {
    headersMock.mockResolvedValue(new Headers());
    const fetchMock = vi.fn(
      async () =>
        new Response("null", { status: 200, headers: { "content-type": "application/json" } }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const { getServerSession } = await import("../../../../src/lib/auth-server");
    const session = await getServerSession();

    expect(session).toBeNull();
    const [, init] = firstCall(fetchMock);
    expect((init.headers as Record<string, string>).cookie).toBe("");
  });

  it("returns null when Better Auth responds with an empty JSON body (no session)", async () => {
    headersMock.mockResolvedValue(new Headers({ cookie: "openwhispr.session_token=stale" }));
    globalThis.fetch = vi.fn(
      async () =>
        new Response("", { status: 200, headers: { "content-type": "application/json" } }),
    ) as typeof fetch;

    const { getServerSession } = await import("../../../../src/lib/auth-server");
    const session = await getServerSession();
    expect(session).toBeNull();
  });

  it("returns null when Better Auth responds with a non-2xx status", async () => {
    headersMock.mockResolvedValue(new Headers({ cookie: "openwhispr.session_token=bad" }));
    globalThis.fetch = vi.fn(
      async () => new Response("Unauthorized", { status: 401 }),
    ) as typeof fetch;

    const { getServerSession } = await import("../../../../src/lib/auth-server");
    const session = await getServerSession();
    expect(session).toBeNull();
  });

  it("returns null when the upstream fetch itself rejects (api unreachable)", async () => {
    headersMock.mockResolvedValue(new Headers({ cookie: "openwhispr.session_token=abc" }));
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    const { getServerSession } = await import("../../../../src/lib/auth-server");
    const session = await getServerSession();
    expect(session).toBeNull();
  });

  it("returns null when the body is JSON-parseable but missing session/user fields", async () => {
    headersMock.mockResolvedValue(new Headers({ cookie: "openwhispr.session_token=abc" }));
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ session: { id: "s1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as typeof fetch;

    const { getServerSession } = await import("../../../../src/lib/auth-server");
    const session = await getServerSession();
    expect(session).toBeNull();
  });

  it("returns null when the body parses to `null`", async () => {
    headersMock.mockResolvedValue(new Headers({ cookie: "openwhispr.session_token=abc" }));
    globalThis.fetch = vi.fn(
      async () =>
        new Response("null", { status: 200, headers: { "content-type": "application/json" } }),
    ) as typeof fetch;

    const { getServerSession } = await import("../../../../src/lib/auth-server");
    expect(await getServerSession()).toBeNull();
  });

  it("falls back to http://api:3000 when INTERNAL_API_URL is unset", async () => {
    process.env.INTERNAL_API_URL = "";
    headersMock.mockResolvedValue(new Headers({ cookie: "x=1" }));
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ session: { id: "s" }, user: { id: "u" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const { getServerSession } = await import("../../../../src/lib/auth-server");
    await getServerSession();
    expect(firstCall(fetchMock)[0]).toBe("http://api:3000/api/auth/get-session");
  });
});
