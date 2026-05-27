// SPDX-License-Identifier: FSL-1.1-ALv2
// 260528-0cm — Task 1 RED — Helper classifier unit tests.
//
// Drives the not-yet-existing classifier
// (`apps/api/src/lib/agent-upstream-error-classify.ts`). Until Task 2 lands,
// running this file MUST fail with module-not-found. After Task 2 GREEN, all
// 25+ cases pass with ≥90/90/90/90 coverage on the helper file.
//
// CLAUDE.md compliance:
//   - No `as any`, no `as unknown as`, no @ts-expect-error (LOCKER-02).
//   - No `process.env.NODE_ENV` (LOCKER-01).
//   - No hardcoded localhost/UUID/credential-shape literals OUTSIDE tests
//     (LOCKER-03; this is a test file and the secret-shape literals below
//     are intentional fixtures asserting the redactor's behavior — they are
//     allowlisted in `.gitleaks.toml` per 260528-0cm Task 9 step 10).

import { LitellmUpstreamError } from "@openwhispr/litellm-client";
import { describe, expect, it } from "vitest";
import {
  type AgentErrorCode,
  type ClassifiedAgentError,
  classifyUpstreamError,
} from "../../../src/lib/agent-upstream-error-classify.js";

// Test-side mirror of the helper's INTERNAL CANONICAL_ERROR_MESSAGES map.
// The helper does NOT export the map (LOCKER-04 dead-export hygiene — no
// cross-package consumer), so tests duplicate the canonical English
// strings literally; the helper implementation in Task 2 MUST match these.
const EXPECTED_UPSTREAM_AUTH =
  "Upstream model provider rejected the request (authentication failure). Contact your operator.";
const EXPECTED_UPSTREAM_RATE_LIMIT = "Rate limit reached. Please retry in a few seconds.";
const EXPECTED_UPSTREAM_QUOTA_EXCEEDED = "Upstream provider quota exceeded. Contact your operator.";
const EXPECTED_UPSTREAM_INVALID_MODEL =
  "Requested model is not available on this server. Choose a different model or contact your operator.";
const EXPECTED_UPSTREAM_TIMEOUT = "Upstream provider did not respond in time. Please retry.";
const EXPECTED_UPSTREAM_UNKNOWN =
  "Upstream model provider is temporarily unavailable. Please try again.";

// Secret-shape regexes used to assert the wire-side `error` field never
// carries credential-shape substrings. Identical to the regexes
// `redactSecretShapes` matches.
const SECRET_SHAPE_SK = /sk-[A-Za-z0-9_-]{16,}/;
const SECRET_SHAPE_BEARER_JWT = /Bearer\s+ey[A-Za-z0-9_-]+/;

describe("classifyUpstreamError", () => {
  describe("LitellmUpstreamError mapping", () => {
    it("status 401 (kind:'auth') → upstream_auth", () => {
      const err = new LitellmUpstreamError(401, "Invalid API key");
      const result: ClassifiedAgentError = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_auth");
      expect(result.error).toBe(EXPECTED_UPSTREAM_AUTH);
      expect(result.upstreamStatus).toBe(401);
      expect(result.kind).toBe("auth");
    });

    it("status 403 → upstream_auth (kind:'auth')", () => {
      const err = new LitellmUpstreamError(403, "Forbidden");
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_auth");
      expect(result.error).toBe(EXPECTED_UPSTREAM_AUTH);
      expect(result.upstreamStatus).toBe(403);
    });

    it("status 402 → upstream_quota_exceeded", () => {
      const err = new LitellmUpstreamError(402, "Payment required");
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_quota_exceeded");
      expect(result.error).toBe(EXPECTED_UPSTREAM_QUOTA_EXCEEDED);
      expect(result.upstreamStatus).toBe(402);
    });

    it("status 429 without retryAfterMs → upstream_rate_limit (canonical base)", () => {
      const err = new LitellmUpstreamError(429, "rate limit");
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_rate_limit");
      expect(result.error).toBe(EXPECTED_UPSTREAM_RATE_LIMIT);
      expect(result.upstreamStatus).toBe(429);
      expect(result.kind).toBe("rate_limit");
    });

    it("status 429 with retryAfterMs:30000 → upstream_rate_limit + suffix '(retry in ~30s)'", () => {
      const err = new LitellmUpstreamError(429, "rate limit", { retryAfterMs: 30_000 });
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_rate_limit");
      expect(result.error).toBe(`${EXPECTED_UPSTREAM_RATE_LIMIT} (retry in ~30s)`);
    });

    it("status 429 with retryAfterMs:0 → upstream_rate_limit base (no suffix)", () => {
      const err = new LitellmUpstreamError(429, "rate limit", { retryAfterMs: 0 });
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_rate_limit");
      expect(result.error).toBe(EXPECTED_UPSTREAM_RATE_LIMIT);
    });

    it("status 404 → upstream_invalid_model", () => {
      const err = new LitellmUpstreamError(404, "model not found");
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_invalid_model");
      expect(result.error).toBe(EXPECTED_UPSTREAM_INVALID_MODEL);
      expect(result.upstreamStatus).toBe(404);
    });

    it("status 400 + body 'Invalid model name passed in model=foo' → upstream_invalid_model", () => {
      const err = new LitellmUpstreamError(400, "Invalid model name passed in model=foo");
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_invalid_model");
    });

    it('status 400 + body containing \'"code":"model_not_found"\' → upstream_invalid_model', () => {
      const err = new LitellmUpstreamError(
        400,
        '{"error":{"message":"The model x does not exist","type":"invalid_request_error","code":"model_not_found"}}',
      );
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_invalid_model");
    });

    it("status 400 + body matching /not.found/i → upstream_invalid_model", () => {
      const err = new LitellmUpstreamError(400, "the model openai/foo was not found");
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_invalid_model");
    });

    it("status 400 + body 'tool argument failed validation' (no model regex match) → upstream_unknown", () => {
      const err = new LitellmUpstreamError(400, "tool argument failed validation");
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_unknown");
      expect(result.error).toBe(EXPECTED_UPSTREAM_UNKNOWN);
    });

    it("status 500 (kind:'server') → upstream_unknown", () => {
      const err = new LitellmUpstreamError(500, "internal");
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_unknown");
      expect(result.upstreamStatus).toBe(500);
      expect(result.kind).toBe("server");
    });

    it("status 502 → upstream_unknown", () => {
      const result = classifyUpstreamError(new LitellmUpstreamError(502, "bad gw"));
      expect(result.code).toBe<AgentErrorCode>("upstream_unknown");
    });

    it("status 503 → upstream_unknown", () => {
      const result = classifyUpstreamError(new LitellmUpstreamError(503, "unavailable"));
      expect(result.code).toBe<AgentErrorCode>("upstream_unknown");
    });

    it("status 504 → upstream_unknown", () => {
      const result = classifyUpstreamError(new LitellmUpstreamError(504, "gateway timeout"));
      expect(result.code).toBe<AgentErrorCode>("upstream_unknown");
    });

    it("LitellmUpstreamError populates upstreamBody (≤500 chars, redacted)", () => {
      const err = new LitellmUpstreamError(500, "boom");
      const result = classifyUpstreamError(err);
      expect(result.upstreamBody).not.toBeNull();
      expect(typeof result.upstreamBody).toBe("string");
      expect((result.upstreamBody ?? "").length).toBeLessThanOrEqual(500);
    });
  });

  describe("Network/abort error mapping", () => {
    it("AbortError → upstream_timeout", () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_timeout");
      expect(result.error).toBe(EXPECTED_UPSTREAM_TIMEOUT);
      expect(result.upstreamStatus).toBeNull();
      expect(result.kind).toBeNull();
    });

    it("ECONNREFUSED → upstream_timeout", () => {
      const err = Object.assign(new Error("connect"), { code: "ECONNREFUSED" });
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_timeout");
    });

    it("ECONNRESET → upstream_timeout", () => {
      const err = Object.assign(new Error("reset"), { code: "ECONNRESET" });
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_timeout");
    });

    it("ETIMEDOUT → upstream_timeout", () => {
      const err = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_timeout");
    });

    it("ENOTFOUND → upstream_timeout", () => {
      const err = Object.assign(new Error("dns"), { code: "ENOTFOUND" });
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_timeout");
    });

    it("EAI_AGAIN → upstream_timeout", () => {
      const err = Object.assign(new Error("dns soft"), { code: "EAI_AGAIN" });
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_timeout");
    });

    it("UND_ERR_HEADERS_TIMEOUT → upstream_timeout", () => {
      const err = Object.assign(new Error("undici"), { code: "UND_ERR_HEADERS_TIMEOUT" });
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_timeout");
    });

    it("UND_ERR_BODY_TIMEOUT → upstream_timeout", () => {
      const err = Object.assign(new Error("undici"), { code: "UND_ERR_BODY_TIMEOUT" });
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_timeout");
    });

    it("UND_ERR_CONNECT_TIMEOUT → upstream_timeout", () => {
      const err = Object.assign(new Error("undici"), { code: "UND_ERR_CONNECT_TIMEOUT" });
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_timeout");
    });

    it("UND_ERR_ABORTED → upstream_timeout", () => {
      const err = Object.assign(new Error("undici"), { code: "UND_ERR_ABORTED" });
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_timeout");
    });
  });

  describe("Catch-all defensive paths", () => {
    it("plain Error → upstream_unknown with redacted upstreamBody", () => {
      const err = new Error("anything");
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_unknown");
      expect(result.error).toBe(EXPECTED_UPSTREAM_UNKNOWN);
      expect(result.upstreamBody).toBe("anything");
    });

    it("TypeError('fetch failed') → upstream_unknown", () => {
      const err = new TypeError("fetch failed");
      const result = classifyUpstreamError(err);
      expect(result.code).toBe<AgentErrorCode>("upstream_unknown");
    });

    it("null → upstream_unknown, upstreamBody:null, upstreamStatus:null", () => {
      const result = classifyUpstreamError(null);
      expect(result.code).toBe<AgentErrorCode>("upstream_unknown");
      expect(result.upstreamBody).toBeNull();
      expect(result.upstreamStatus).toBeNull();
      expect(result.kind).toBeNull();
    });

    it("undefined → upstream_unknown, upstreamBody:null, upstreamStatus:null", () => {
      const result = classifyUpstreamError(undefined);
      expect(result.code).toBe<AgentErrorCode>("upstream_unknown");
      expect(result.upstreamBody).toBeNull();
      expect(result.upstreamStatus).toBeNull();
      expect(result.kind).toBeNull();
    });

    it("string throw → upstream_unknown", () => {
      const result = classifyUpstreamError("string error");
      expect(result.code).toBe<AgentErrorCode>("upstream_unknown");
      expect(result.upstreamBody).toBeNull();
    });

    it("plain object throw → upstream_unknown", () => {
      const result = classifyUpstreamError({ message: "foo" });
      expect(result.code).toBe<AgentErrorCode>("upstream_unknown");
      // Per CONTEXT.md D3: catch-all branch extracts .message if present;
      // a bare object with .message:string is captured into upstreamBody.
      expect(result.upstreamBody).toBe("foo");
    });
  });

  describe("Security and truncation", () => {
    it("LitellmUpstreamError carrying sk-… → result.error has NO sk-shape; upstreamBody is redacted", () => {
      const err = new LitellmUpstreamError(
        401,
        "Invalid api key sk-or-v1-abcdef1234567890abcdef1234567890",
      );
      const result = classifyUpstreamError(err);
      // The wire-side `error` is the canonical English literal — it
      // never includes any upstream body fragment, so the secret-shape
      // assertion is satisfied by construction. The defense-in-depth
      // assertion is `upstreamBody` carrying the redactor's `[redacted]`
      // marker (lowercase per `packages/litellm-client/src/redact.ts`).
      expect(result.error).not.toMatch(SECRET_SHAPE_SK);
      expect(result.upstreamBody ?? "").toContain("[redacted]");
    });

    it("LitellmUpstreamError carrying Bearer ey… → result.error has NO Bearer-ey shape", () => {
      const err = new LitellmUpstreamError(
        401,
        "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.deadbeef",
      );
      const result = classifyUpstreamError(err);
      expect(result.error).not.toMatch(SECRET_SHAPE_BEARER_JWT);
      expect(result.upstreamBody ?? "").toContain("[redacted]");
    });

    it("LitellmUpstreamError with 2000-char body → upstreamBody length ≤ 500", () => {
      const err = new LitellmUpstreamError(500, "X".repeat(2000));
      const result = classifyUpstreamError(err);
      expect((result.upstreamBody ?? "").length).toBeLessThanOrEqual(500);
    });
  });
});
