// Phase 07.1 / Plan 05 — auth-server unit tests (RED before GREEN).
//
// `getServerSession()` calls Better Auth's session endpoint over HTTP from
// the web RSC, forwarding the incoming Cookie header (Pitfall 2). We mock
// `next/headers` and `fetch` at the network boundary only (CLAUDE.md).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          session: { id: "s1", userId: "u1" },
          user: { id: "u1", email: "x@y.com", emailVerified: true },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const { getServerSession } = await import("../auth-server");
    const session = await getServerSession();

    expect(session).not.toBeNull();
    expect(session?.user.id).toBe("u1");
    expect(session?.session.id).toBe("s1");

    // Cookie forwarding (Pitfall 2): cookie header from next/headers() MUST
    // be propagated on the upstream fetch.
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe("http://api:3000/api/auth/get-session");
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>).cookie).toBe(
      "openwhispr.session_token=abc",
    );
  });

  it("returns null when no cookie header is present (unauthenticated RSC visit)", async () => {
    headersMock.mockResolvedValue(new Headers());
    const fetchMock = vi.fn(async () =>
      new Response("null", { status: 200, headers: { "content-type": "application/json" } }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const { getServerSession } = await import("../auth-server");
    const session = await getServerSession();

    expect(session).toBeNull();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).cookie).toBe("");
  });

  it("returns null when Better Auth responds with an empty JSON body (no session)", async () => {
    headersMock.mockResolvedValue(new Headers({ cookie: "openwhispr.session_token=stale" }));
    globalThis.fetch = vi.fn(async () =>
      new Response("", { status: 200, headers: { "content-type": "application/json" } }),
    ) as typeof fetch;

    const { getServerSession } = await import("../auth-server");
    const session = await getServerSession();
    expect(session).toBeNull();
  });

  it("returns null when Better Auth responds with a non-2xx status", async () => {
    headersMock.mockResolvedValue(new Headers({ cookie: "openwhispr.session_token=bad" }));
    globalThis.fetch = vi.fn(async () => new Response("Unauthorized", { status: 401 })) as typeof fetch;

    const { getServerSession } = await import("../auth-server");
    const session = await getServerSession();
    expect(session).toBeNull();
  });

  it("returns null when the upstream fetch itself rejects (api unreachable)", async () => {
    headersMock.mockResolvedValue(new Headers({ cookie: "openwhispr.session_token=abc" }));
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    const { getServerSession } = await import("../auth-server");
    const session = await getServerSession();
    expect(session).toBeNull();
  });

  it("falls back to http://api:3000 when INTERNAL_API_URL is unset", async () => {
    process.env.INTERNAL_API_URL = "";
    headersMock.mockResolvedValue(new Headers({ cookie: "x=1" }));
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ session: { id: "s" }, user: { id: "u" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const { getServerSession } = await import("../auth-server");
    await getServerSession();
    expect(fetchMock.mock.calls[0]![0]).toBe("http://api:3000/api/auth/get-session");
  });
});
