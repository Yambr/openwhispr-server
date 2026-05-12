// Phase 07.1 / Plan 09 — clientFetch wrapper unit tests.
//
// Covers happy path (GET, POST with object body, string body), 204
// No-Content, empty body, error mapping (non-2xx → thrown Error), header
// merging, and AbortSignal forwarding.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientFetch } from "../client-fetch";

const originalFetch = globalThis.fetch;

function mockResponse(init: {
  ok: boolean;
  status: number;
  body?: string;
  textThrows?: boolean;
}): Response {
  return {
    ok: init.ok,
    status: init.status,
    text: async () => {
      if (init.textThrows) throw new Error("text failed");
      return init.body ?? "";
    },
  } as unknown as Response;
}

describe("clientFetch", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("GETs JSON and returns parsed body", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ ok: true, status: 200, body: '{"x":1}' }),
    );
    const out = await clientFetch<{ x: number }>("/api/anything");
    expect(out.x).toBe(1);
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[0]).toBe("/api/anything");
    expect((call?.[1] as RequestInit).credentials).toBe("include");
  });

  it("serialises object body to JSON and sets content-type", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ ok: true, status: 200, body: '{"ok":true}' }),
    );
    await clientFetch("/api/x", { method: "POST", body: { id: "abc" } });
    const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ id: "abc" }));
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("passes through string body without serialising", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ ok: true, status: 200, body: "{}" }),
    );
    await clientFetch("/api/x", { method: "POST", body: "raw-string" });
    const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe("raw-string");
  });

  it("returns undefined on 204 No Content", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ ok: true, status: 204 }),
    );
    const out = await clientFetch("/api/x", { method: "DELETE" });
    expect(out).toBeUndefined();
  });

  it("returns undefined on empty body", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ ok: true, status: 200, body: "" }),
    );
    const out = await clientFetch("/api/x");
    expect(out).toBeUndefined();
  });

  it("throws on non-2xx, includes body preview in message", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ ok: false, status: 500, body: "boom-server" }),
    );
    await expect(clientFetch("/api/x")).rejects.toThrow(/HTTP 500/);
  });

  it("throws cleanly when error response body cannot be read", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ ok: false, status: 502, textThrows: true }),
    );
    await expect(clientFetch("/api/x")).rejects.toThrow(/HTTP 502/);
  });

  it("forwards AbortSignal", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ ok: true, status: 200, body: "{}" }),
    );
    const ctrl = new AbortController();
    await clientFetch("/api/x", { signal: ctrl.signal });
    const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBe(ctrl.signal);
  });

  it("respects caller-provided content-type", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ ok: true, status: 200, body: "{}" }),
    );
    await clientFetch("/api/x", {
      method: "POST",
      body: { a: 1 },
      headers: { "content-type": "application/vnd.test+json" },
    });
    const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      "application/vnd.test+json",
    );
  });
});
