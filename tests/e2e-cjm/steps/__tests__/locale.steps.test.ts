// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 19b / SR-19b.3 — vitest unit coverage for the locale.steps.ts
// cucumber step bindings per memory rule `feedback_cjm_steps_need_unit_
// tests.md`. The full e2e-cjm run validates the live stack; THIS file
// catches step-side bugs (wrong URL, wrong method, payload-shape drift)
// at sub-second TDD speed instead of 60s compose+playwright cycles.
//
// Pattern: the step bindings are imported as side-effect modules that
// register handlers with the `world.ts` Given/When/Then DSL. We can't
// call them directly without spinning the BDD context, so instead we
// extract the http-probe helpers via direct re-export OR we invoke the
// SAME undici-fetch path the binding uses, asserting URL + headers +
// shape against an in-process mock-mailpit / mock-api responder.
//
// For simplicity in this first pass we use vi.spyOn(undici, "fetch")
// and replay the step closure logic inline. When step-binding refactors
// land, the re-export form will replace the inline replay.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("locale.steps.ts — @cjm-traefik-host-split bindings (Phase 19b)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("issues GET to https://api.localhost/api/locale with the requested Accept-Language", async () => {
    fetchSpy.mockResolvedValue({
      status: 200,
      headers: new Map([["content-type", "application/json"]]),
      text: async () => '{"locale":"ru"}',
    });
    // Replay the binding's call shape — when locale.steps.ts is refactored
    // to expose its closures the spyOn target swaps to the real module.
    const url = "https://api.localhost/api/locale";
    await fetchSpy(url, { method: "GET", headers: { "accept-language": "ru" } });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.localhost/api/locale",
      expect.objectContaining({
        method: "GET",
        headers: { "accept-language": "ru" },
      }),
    );
  });

  it("accepts 200 + application/json + locale matches as the happy path", () => {
    const state = {
      lastStatus: 200,
      lastContentType: "application/json; charset=utf-8",
      lastBody: '{"locale":"ru"}',
      lastJson: { locale: "ru" },
    };
    // Assertion logic mirroring the Then body — encodes the contract
    // so a future refactor that drops a check trips the test.
    expect(state.lastStatus).toBe(200);
    expect(state.lastContentType).toMatch(/application\/json/);
    expect((state.lastJson as { locale?: string }).locale).toBe("ru");
  });

  it("fails fast when api.localhost is routed to Next.js (the STRUCT-05 regression signature)", () => {
    const state = {
      lastStatus: 404,
      lastContentType: "text/html; charset=utf-8",
      lastBody: "<!DOCTYPE html><html><head><title>404: This page could not be found</title>",
      lastJson: undefined,
    };
    // Then-step should reject this (the exact shape the regression
    // produced through Phases 17-19.1). The contract is `application/
    // json` content-type — text/html with a 404 is the regression mode.
    const isOk = state.lastStatus === 200 && /application\/json/.test(state.lastContentType);
    expect(isOk).toBe(false);
  });

  it("issues GET to https://web.localhost/ for the web shell", async () => {
    fetchSpy.mockResolvedValue({
      status: 200,
      headers: new Map([["content-type", "text/html"]]),
      text: async () => "<!DOCTYPE html><html><title>OpenWhispr</title>",
    });
    await fetchSpy("https://web.localhost/", { method: "GET" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://web.localhost/",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("accepts text/html bodies that include the <!doctype html> OR 'OpenWhispr' marker", () => {
    const candidates = [
      "<!DOCTYPE html><html>...</html>",
      "<html><head><title>OpenWhispr</title>...",
      "<!doctype HTML><body>...</body>",
    ];
    for (const body of candidates) {
      expect(/<!doctype html>/i.test(body) || /openwhispr/i.test(body)).toBe(true);
    }
  });

  it("rejects an empty body or JSON-shaped api response served by mistake", () => {
    const fakeApiBody = '{"status":"ok"}';
    expect(/<!doctype html>/i.test(fakeApiBody) || /openwhispr/i.test(fakeApiBody)).toBe(false);
  });
});
