// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 10 / Plan 02 — /api/locale route handler unit tests.
//
// Exercises the POST handler directly (App Router style — the route module
// exports `POST`). We assert:
//   - 204 + Set-Cookie on valid input
//   - 400 + error envelope on invalid locale
//   - 400 + error envelope on malformed body
import { describe, expect, it } from "vitest";
import { POST } from "../../../../../../src/app/api/locale/route";

function postJson(body: unknown): Request {
  return new Request("https://api.localhost/api/locale", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/locale (Phase 10 / Plan 02)", () => {
  it("returns 204 and sets NEXT_LOCALE=ru cookie on valid input", async () => {
    const res = await POST(postJson({ locale: "ru" }));
    expect(res.status).toBe(204);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/NEXT_LOCALE=ru/);
    expect(setCookie.toLowerCase()).toMatch(/samesite=lax/);
    expect(setCookie).toMatch(/Max-Age=31536000/);
  });

  it("accepts en as a valid locale", async () => {
    const res = await POST(postJson({ locale: "en" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/NEXT_LOCALE=en/);
  });

  it("rejects unsupported locale with 400 INVALID_LOCALE", async () => {
    const res = await POST(postJson({ locale: "fr" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("INVALID_LOCALE");
  });

  it("rejects malformed JSON body with 400 INVALID_LOCALE", async () => {
    const res = await POST(postJson("{not json"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("INVALID_LOCALE");
  });

  it("rejects missing locale field with 400 INVALID_LOCALE", async () => {
    const res = await POST(postJson({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("INVALID_LOCALE");
  });
});
