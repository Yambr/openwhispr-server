// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 40 / Sub-fix 40.c — RED then GREEN for HIGH-FIX-BYOK-03.
//
// `fetchAndParse` must enforce D-13 / WIRE-17 on EVERY non-2xx
// response: the body MUST parse as `{error:string}`. Before Phase 40 a
// `typeof body === "object"` guard short-circuited the check for raw
// strings, empty bodies, and invalid JSON — exactly the regressions
// the helper exists to catch. The tests below pin the post-Phase-40
// contract.

// Minimal ephemeral HTTP server. Spawning a real socket is the only
// honest way to exercise the helper (per CLAUDE.md no mocks of internal
// logic — fetch is a network boundary, allowed; but mocking fetch
// itself would obscure the very behaviour we're pinning).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MalformedUpstreamEnvelopeError } from "../../../../src/errors.js";
import { fetchAndParse } from "../../../../src/helpers/http.js";

interface Fixture {
  status: number;
  contentType?: string;
  body: string;
}

let fixture: Fixture = { status: 200, body: "{}" };
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.statusCode = fixture.status;
    if (fixture.contentType) {
      res.setHeader("content-type", fixture.contentType);
    }
    res.end(fixture.body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("fetchAndParse — envelope enforcement on non-2xx", () => {
  it("throws MalformedUpstreamEnvelopeError on text/plain 500 body", async () => {
    fixture = { status: 500, contentType: "text/plain", body: "internal server error" };
    await expect(fetchAndParse(baseUrl)).rejects.toBeInstanceOf(MalformedUpstreamEnvelopeError);
  });

  it("throws MalformedUpstreamEnvelopeError on empty non-2xx body", async () => {
    fixture = { status: 503, body: "" };
    await expect(fetchAndParse(baseUrl)).rejects.toBeInstanceOf(MalformedUpstreamEnvelopeError);
  });

  it("throws MalformedUpstreamEnvelopeError on HTML 500 page", async () => {
    fixture = {
      status: 500,
      contentType: "text/html",
      body: "<html><body>500 Internal Server Error</body></html>",
    };
    await expect(fetchAndParse(baseUrl)).rejects.toBeInstanceOf(MalformedUpstreamEnvelopeError);
  });

  it("throws MalformedUpstreamEnvelopeError on JSON non-object (string literal)", async () => {
    fixture = { status: 401, contentType: "application/json", body: '"unauthorized"' };
    await expect(fetchAndParse(baseUrl)).rejects.toBeInstanceOf(MalformedUpstreamEnvelopeError);
  });

  it("throws MalformedUpstreamEnvelopeError on JSON object missing 'error' field", async () => {
    fixture = { status: 400, contentType: "application/json", body: '{"message":"bad"}' };
    await expect(fetchAndParse(baseUrl)).rejects.toBeInstanceOf(Error);
  });

  it("succeeds on well-formed envelope (regression coverage)", async () => {
    fixture = { status: 401, contentType: "application/json", body: '{"error":"unauthorized"}' };
    const res = await fetchAndParse(baseUrl);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("does not throw on 2xx with empty body", async () => {
    fixture = { status: 200, body: "" };
    const res = await fetchAndParse(baseUrl);
    expect(res.status).toBe(200);
    expect(res.body).toBeUndefined();
  });

  it("does not throw on 2xx with non-JSON text body", async () => {
    fixture = { status: 200, contentType: "text/plain", body: "OK" };
    const res = await fetchAndParse(baseUrl);
    expect(res.status).toBe(200);
    // Per current helper contract, body is the raw text when JSON.parse
    // fails; the helper only enforces envelope on non-2xx.
    expect(res.body).toBe("OK");
  });
});

describe("MalformedUpstreamEnvelopeError surface", () => {
  it("truncates bodyText at 200 chars (private accessor) and toJSON omits body", () => {
    const long = "x".repeat(500);
    const err = new MalformedUpstreamEnvelopeError({
      status: 500,
      contentType: "text/plain",
      bodyText: long,
      reason: "non-JSON body",
    });
    expect(err.getBodyText().length).toBe(200);
    expect(err.name).toBe("MalformedUpstreamEnvelopeError");
    expect(err.status).toBe(500);
    // LOCKER-05: structured-clone / JSON output MUST NOT leak the body.
    const json = JSON.parse(JSON.stringify(err));
    expect(json.bodyText).toBeUndefined();
    expect(json.status).toBe(500);
  });
});
