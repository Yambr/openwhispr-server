// Phase 07.1 / Plan 05 — auth-actions unit tests (RED before GREEN).
//
// Server Action `signOutAction()` must:
//   1. Forward the incoming Cookie header to apps/api Better Auth so the
//      session row is invalidated server-side (not just locally).
//   2. Redirect the user to /sign-in via next/navigation `redirect()`.
//
// `redirect()` from next/navigation throws a NEXT_REDIRECT control-flow
// error by design — we assert that throw signature.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function firstCall(mock: unknown): [string, RequestInit] {
  const calls = (mock as { mock: { calls: unknown[][] } }).mock.calls;
  const call = calls[0];
  if (!call) throw new Error("expected fetch mock to be called at least once");
  return [call[0] as string, (call[1] ?? {}) as RequestInit];
}

const headersMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  const err = new Error(`NEXT_REDIRECT:${path}`);
  (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;${path}`;
  throw err;
});

vi.mock("next/headers", () => ({ headers: () => headersMock() }));
vi.mock("next/navigation", () => ({ redirect: (p: string) => redirectMock(p) }));

describe("auth-actions.signOutAction (Phase 07.1 / Plan 05)", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.INTERNAL_API_URL;

  beforeEach(() => {
    process.env.INTERNAL_API_URL = "http://api:3000";
    vi.resetModules();
    redirectMock.mockClear();
    headersMock.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.INTERNAL_API_URL = originalEnv;
  });

  it("POSTs to /api/auth/sign-out with the forwarded cookie header then redirects to /sign-in", async () => {
    headersMock.mockResolvedValue(new Headers({ cookie: "openwhispr.session_token=abc" }));
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const { signOutAction } = await import("../auth-actions");
    await expect(signOutAction()).rejects.toThrow(/NEXT_REDIRECT/);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = firstCall(fetchMock);
    expect(url).toBe("http://api:3000/api/auth/sign-out");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).cookie).toBe("openwhispr.session_token=abc");

    expect(redirectMock).toHaveBeenCalledWith("/sign-in");
  });

  it("uses the http://api:3000 default when INTERNAL_API_URL is unset", async () => {
    process.env.INTERNAL_API_URL = "";
    headersMock.mockResolvedValue(new Headers());
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const { signOutAction } = await import("../auth-actions");
    await expect(signOutAction()).rejects.toThrow(/NEXT_REDIRECT/);
    const [url, init] = firstCall(fetchMock);
    expect(url).toBe("http://api:3000/api/auth/sign-out");
    // Cookie header forwarded as empty string when no incoming cookies.
    expect((init.headers as Record<string, string>).cookie).toBe("");
  });

  it("still redirects to /sign-in when the upstream sign-out fetch fails", async () => {
    headersMock.mockResolvedValue(new Headers({ cookie: "openwhispr.session_token=abc" }));
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    const { signOutAction } = await import("../auth-actions");
    await expect(signOutAction()).rejects.toThrow(/NEXT_REDIRECT/);
    // Local redirect happens regardless of upstream status — desktop
    // protocol clients also expect this behavior (best-effort revoke +
    // mandatory local clear).
    expect(redirectMock).toHaveBeenCalledWith("/sign-in");
  });
});
