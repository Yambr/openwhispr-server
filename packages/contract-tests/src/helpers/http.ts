// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 06 — envelope-asserting fetch wrapper.
// Phase 40 / Sub-fix 40.c (HIGH-FIX-BYOK-03) — strict enforcement.
//
// Every non-2xx response body MUST parse as ErrorEnvelope (D-13 / WIRE-17).
// `fetchAndParse` enforces that contract on every read: if the server
// returns 4xx/5xx with a body that does not match `{error:string}`, the
// helper throws `MalformedUpstreamEnvelopeError` (Phase 40 — previously
// a `typeof body === "object"` guard silently passed raw strings, empty
// bodies, and HTML bodies, exactly the regressions the helper exists
// to catch).
//
// 2xx responses are handed back as-is; route-specific tests parse the
// body via the matching response schema.
import { MalformedUpstreamEnvelopeError } from "../errors.js";
import { ErrorEnvelope } from "../schemas.js";

export interface FetchResult {
  status: number;
  body: unknown;
  headers: Headers;
  ok: boolean;
}

export async function fetchAndParse(url: string, init?: RequestInit): Promise<FetchResult> {
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: unknown;
  let parsedOk = false;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
      parsedOk = true;
    } catch {
      parsedOk = false;
    }
  }
  if (!res.ok) {
    // Phase 40 — strict envelope enforcement. Previously a `typeof
    // body === "object"` guard short-circuited the check; now any
    // non-2xx that is NOT a parseable JSON OBJECT raises.
    if (!parsedOk || typeof parsed !== "object" || parsed === null) {
      throw new MalformedUpstreamEnvelopeError({
        status: res.status,
        contentType: res.headers.get("content-type"),
        bodyText: text,
        reason: !parsedOk
          ? text.length === 0
            ? "empty body"
            : "non-JSON body"
          : "JSON body is not an object",
      });
    }
    // Throws (zod) if the envelope shape is violated — D-13 +
    // PITFALLS #1 enforcement. Tests that depend on this rejecting
    // catch the ZodError directly.
    ErrorEnvelope.parse(parsed);
  }
  // 2xx body shape: unchanged from Phase 2 — JSON object/array, or
  // the raw text when JSON.parse failed, or `undefined` for empty.
  const body: unknown = parsedOk ? parsed : text.length > 0 ? text : undefined;
  return {
    status: res.status,
    body,
    headers: res.headers,
    ok: res.ok,
  };
}
