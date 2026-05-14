// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-04 — RED+GREEN tests for the useAuthProviders hook.
//
// Surface verified (RESEARCH §9):
//   1. Initial render: loading === true, providers === [].
//   2. After fetch resolves with N providers: loading === false, providers.length === N.
//   3. Fetch rejects (network error) -> loading === false, providers === [] (fail-closed).
//   4. Hook does not refetch on remount within the same component lifecycle
//      (one fetch per useEffect invocation).
//
// Fetch is mocked at the process boundary via vi.spyOn(globalThis, "fetch"),
// matching the pattern already used in this directory's auth-screen tests.
// No internal logic is mocked.
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthProviders } from "../useAuthProviders";

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function makeFetchMock(payload: unknown): {
  fn: ReturnType<typeof vi.fn>;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return {
      ok: true,
      status: 200,
      json: async () => payload,
    } as unknown as Response;
  });
  return { fn, calls };
}

describe("useAuthProviders (Phase 12 / Plan 12-04)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with loading=true and providers=[] before fetch resolves", async () => {
    // Use a never-resolving fetch so we observe the initial state.
    const pending = new Promise<Response>(() => undefined);
    vi.spyOn(globalThis, "fetch").mockReturnValue(pending);

    const { result } = renderHook(() => useAuthProviders());

    expect(result.current.loading).toBe(true);
    expect(result.current.providers).toEqual([]);
  });

  it("sets loading=false and exposes providers after fetch resolves", async () => {
    const { fn, calls } = makeFetchMock({
      providers: [{ id: "google", name: "Google", enabled: true }],
      emailVerification: { required: true, configured: true },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(fn as never);

    const { result } = renderHook(() => useAuthProviders());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.providers).toHaveLength(1);
    expect(result.current.providers[0]).toEqual({ id: "google", name: "Google", enabled: true });

    // Hook MUST hit /api/auth/providers with credentials:'omit' (public endpoint).
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/auth/providers");
    expect(calls[0]?.init?.credentials).toBe("omit");
  });

  it("fails closed (loading=false, providers=[]) when fetch rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useAuthProviders());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.providers).toEqual([]);
    // Failure is logged via console.warn, not thrown (fail-closed contract).
    expect(warnSpy).toHaveBeenCalled();
  });

  it("issues exactly one fetch per component lifecycle (no remount refetch loop)", async () => {
    const { fn } = makeFetchMock({
      providers: [],
      emailVerification: { required: true, configured: false },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(fn as never);

    const { result, rerender } = renderHook(() => useAuthProviders());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    rerender();
    rerender();
    rerender();

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
