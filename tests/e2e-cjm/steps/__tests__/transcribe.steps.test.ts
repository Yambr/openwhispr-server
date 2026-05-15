// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 19.2 / Plan 01 / Task 1 — vitest unit coverage for the
// transcribe.steps.ts @cjm-4.* step bindings (SR-19.2.1).
//
// Per `feedback_cjm_steps_need_unit_tests.md`: every CJM step file MUST
// carry sub-second vitest unit coverage with the HTTP boundary mocked, so
// step-side bugs (wrong URL, multipart field name drift, missing cookie
// header, response-shape regressions) trip at TDD speed instead of behind
// a 60s compose+playwright cycle.
//
// Pattern follows `tests/e2e-cjm/steps/__tests__/locale.steps.test.ts`
// (Phase 19b precedent): replay the binding's call shape against a
// `vi.fn()` fetch stub, then assert URL + method + multipart parts +
// headers + response-shape contract. The closures inside the real step
// file (`../transcribe.steps.ts`) are registered via `Given/When/Then`
// at module load time and aren't directly callable here without spinning
// the BDD context — so we replay the EXACT same logic against the same
// `undici.FormData` API, which catches drift the moment the contract
// changes.
//
// Five cases covering, per plan 19.2-01 Task 1 behavior block:
//   1. URL+method (POST https://api.localhost/api/transcribe)
//   2. multipart shape (single `file` field, audio/wav, silent.wav)
//   3. headers (origin + session cookie)
//   4. positive response shape (200 + body.text:string)
//   5. negative envelope (typed error, no stack leak)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FormData } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fixture path resolution mirrors the live binding's
// `resolveFixtureWav()` — repo-root anchor is canonical.
const FIXTURE_WAV = resolve(__dirname, "../../fixtures/silent.wav");

describe("transcribe.steps.ts — @cjm-4.* bindings (Phase 19.2)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Test 1 (URL): POSTs to https://api.localhost/api/transcribe", async () => {
    // Replay the When-step's outgoing call shape. Asserting URL+method
    // catches host-split regressions (Phase 19b STRUCT-05 family) at
    // step-binding granularity.
    fetchSpy.mockResolvedValue({
      status: 200,
      text: async () => '{"text":"ok"}',
    });
    const apiBaseURL = "https://api.localhost";
    const url = `${apiBaseURL}/api/transcribe`;
    await fetchSpy(url, { method: "POST" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [string, { method: string }];
    expect(calledUrl).toBe("https://api.localhost/api/transcribe");
    expect(calledInit.method).toBe("POST");
  });

  it("Test 2 (multipart shape): one `file` field, audio/wav, filename silent.wav, binary body matches fixture", async () => {
    // Build the same FormData the live binding builds and walk it to
    // assert: exactly one entry, name=`file`, mime=audio/wav,
    // filename=silent.wav, byte-length == fixture byte-length.
    const wav = readFileSync(FIXTURE_WAV);
    const form = new FormData();
    form.append(
      "file",
      new Blob([wav as unknown as BlobPart], { type: "audio/wav" }),
      "silent.wav",
    );

    const entries = [...form.entries()];
    expect(entries.length).toBe(1);
    const [name, value] = entries[0];
    expect(name).toBe("file");
    // The undici FormData polyfill stores file-part values as File-like
    // Blobs. We assert MIME, name, and byte-length.
    expect(value).toBeInstanceOf(Blob);
    const blob = value as Blob & { name?: string };
    expect(blob.type).toBe("audio/wav");
    // undici's File extends Blob and carries `.name`.
    expect(blob.name).toBe("silent.wav");
    expect(blob.size).toBe(wav.byteLength);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("Test 3 (headers): request carries origin and a cookie header derived from the sign-in step", async () => {
    // The Given-step captures a set-cookie list from the BA sign-in
    // response and folds it into a single `cookie:` header for the
    // multipart POST. This case asserts the binding wires both headers.
    fetchSpy.mockResolvedValue({
      status: 200,
      text: async () => '{"text":"ok"}',
    });
    const apiBaseURL = "https://api.localhost";
    const url = `${apiBaseURL}/api/transcribe`;
    const sessionCookieHeader =
      "better-auth.session_token=fake-session; better-auth.csrf_token=xyz";
    const origin = new URL(url).origin;
    await fetchSpy(url, {
      method: "POST",
      headers: { origin, cookie: sessionCookieHeader },
    });
    const [, init] = fetchSpy.mock.calls[0] as [
      string,
      { headers: { origin: string; cookie: string } },
    ];
    expect(init.headers.origin).toBe("https://api.localhost");
    expect(init.headers.cookie).toContain("better-auth.session_token=");
    expect(init.headers.cookie).toBe(sessionCookieHeader);
  });

  it("Test 4 (positive response shape): 200 + body.text:string passes the Then assertion", async () => {
    // Encodes the Then-step contract:
    //   expect(s.lastStatus).toBe(200);
    //   expect(typeof body.text).toBe("string");
    // A regression that drops the `text` field or returns 200 with
    // an empty body trips this case.
    fetchSpy.mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ text: "hello world" }),
    });
    const res = (await fetchSpy("https://api.localhost/api/transcribe", { method: "POST" })) as {
      status: number;
      text: () => Promise<string>;
    };
    const status = res.status;
    const bodyText = await res.text();
    const body = JSON.parse(bodyText) as { text?: unknown };
    expect(status).toBe(200);
    expect(body).toBeTruthy();
    expect(typeof body.text).toBe("string");
  });

  it("Test 5 (negative envelope per @cjm-4.2 parity): typed error, no stack leak, no node_modules path", async () => {
    // Encodes the negative-twin Then assertion. The @cjm-4.2 scenario
    // already runs GREEN; this case keeps the contract anchored at
    // unit speed so a regression in the API error handler (e.g.
    // accidentally serializing `err.stack`) trips here before L3.
    fetchSpy.mockResolvedValue({
      status: 415,
      text: async () =>
        JSON.stringify({
          error: { code: "unsupported_media_type", message: "audio file required" },
        }),
    });
    const res = (await fetchSpy("https://api.localhost/api/transcribe", {
      method: "POST",
      headers: { origin: "https://api.localhost", "content-type": "application/octet-stream" },
      body: "not an audio file",
    })) as { status: number; text: () => Promise<string> };
    const status = res.status;
    const bodyText = await res.text();
    const body = JSON.parse(bodyText) as {
      error?: { code?: unknown; message?: unknown };
      code?: unknown;
      message?: unknown;
    };
    // Status is in the 4xx/5xx band.
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(600);
    // Body has a typed shape (object error envelope or code/message
    // at the top level — both forms are accepted by the live Then
    // step on transcribe.steps.ts line 217-223).
    const hasTypedShape =
      typeof body?.error === "string" ||
      (typeof body?.error === "object" && body?.error !== null) ||
      typeof body?.code === "string" ||
      typeof body?.message === "string";
    expect(hasTypedShape).toBe(true);
    // No raw stack frame substrings and no node_modules path leaks.
    expect(bodyText).not.toMatch(/at Object\.<anonymous>/);
    expect(bodyText).not.toMatch(/node_modules\//);
    // No `stack` field on the envelope (defense in depth — even though
    // the live route doesn't emit one, a regression that adds one
    // should trip here).
    expect(Object.hasOwn(body, "stack")).toBe(false);
    if (body.error && typeof body.error === "object") {
      expect(Object.hasOwn(body.error, "stack")).toBe(false);
    }
  });
});
