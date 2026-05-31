---
quick_id: 260528-0cm
slug: agent-stream-error-contract
title: "Agent stream error contract — wire contract fix (v1.0.13)"
date: 2026-05-28
status: planned
mode: quick-full
revision: 2
findings_closed: [HIGH-agent-stream-empty-bubble]
peer_reporter: 9zn786o0
phase: 260528-0cm-agent-stream-error-contract
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/lib/agent-upstream-error-classify.ts
  - apps/api/src/lib/sse-parser.ts
  - apps/api/src/routes/agent/stream.ts
  - apps/api/tests/unit/lib/agent-upstream-error-classify.test.ts
  - apps/api/tests/unit/routes/agent/stream.test.ts
  - apps/api/tests/unit/routes/agent/__tests__/stream-error-mapping.test.ts
  - apps/api/tests/integration/agent-stream-error-contract.test.ts
  - tests/e2e-cjm/features/agent-stream-error.feature
  - tests/e2e-cjm/steps/agent-stream-error.steps.ts
  - tests/e2e-cjm/steps/__tests__/agent-stream-error.steps.test.ts
  - docs/operations.md
  - charts/openwhispr-server/Chart.yaml
  - charts/openwhispr-server/values.yaml
autonomous: true
requirements:
  - HIGH-agent-stream-empty-bubble
upstream:
  context: .planning/quick/260528-0cm-agent-stream-error-contract/CONTEXT.md
  research: .planning/quick/260528-0cm-agent-stream-error-contract/RESEARCH.md
  audit: .planning/debug/agent-stream-upstream-error-2026-05-28.md
  check: .planning/quick/260528-0cm-agent-stream-error-contract/PLAN-CHECK.md
locked_decisions:
  - id: D1
    summary: "Single terminal type:'error' frame for both preflight AND mid-stream failure; no done chunk follows it."
  - id: D2
    summary: "provider:'litellm' for LitellmUpstreamError; 'unknown' for connect/timeout/network errors."
  - id: D3
    summary: "Canonical English userFacingMessage per code class; raw bodyText goes only to req.log.error binding."
  - id: D4
    summary: "Remove finishReason:'upstream_error' (preflight) AND finishReason:'stream_error' (drain) entirely. No deprecation cycle."
naming_alignment:
  notice: |
    PLAN.md uses shorter export names than the longer forms drafted in
    CONTEXT.md §"Cross-cutting implications for the planner". This is an
    ergonomic rename, not a semantic change — the helper still produces
    the same envelope and codes locked in D1-D4. CONTEXT.md's longer names
    are SUPERSEDED by PLAN.md rev 2 export names; D1-D4 locks remain
    canonical.
  context_md_drafted: ["classifyAgentUpstreamError", "AgentUpstreamErrorCode", "AgentUpstreamProvider", "AgentUpstreamErrorEnvelope"]
  plan_md_final: ["classifyUpstreamError", "AgentErrorCode", "ClassifiedAgentError"]
  rationale: |
    (1) Shorter call sites in stream.ts (single helper, no name disambiguation
    needed — the route already lives under apps/api/src/routes/agent/);
    (2) AgentUpstreamProvider is DROPPED entirely per D2 — provider is
    inline-encoded at the route call site, not exposed as a type; the
    helper does not carry provider. The wire-envelope type with the 4-key
    {type, error, code, provider} shape exists ONLY as the StreamChunk
    variant in sse-parser.ts — no separate AgentUpstreamErrorEnvelope export.
must_haves:
  truths:
    - "POST /api/agent/stream returning a LitellmUpstreamError(401|402|403|404|429|5xx) emits exactly one terminal NDJSON line `{type:'error', error, code, provider:'litellm'}` and NO subsequent `done` chunk."
    - "POST /api/agent/stream that throws AbortError or undici timeout (UND_ERR_*_TIMEOUT) emits exactly one terminal `{type:'error', code:'upstream_timeout', provider:'unknown'}` chunk."
    - "POST /api/agent/stream that throws ECONNREFUSED/ECONNRESET/ETIMEDOUT/ENOTFOUND/EAI_AGAIN emits `{type:'error', code:'upstream_timeout', provider:'unknown'}`."
    - "Mid-stream failure after N>0 content chunks preserves the content chunks on the wire and emits ONE terminal `{type:'error'}` chunk — NEVER a `done.stream_error` chunk; NEVER both an error and a done chunk."
    - "Every preflight + drain failure logs exactly one `req.log.error({event:'agent.stream.upstream_failure', upstream_status, code, provider, model, upstream_body_truncated, request_id, retry_after_ms?, litellm_call_id?}, ...)` line — NOT `req.log.warn`."
    - "No secret-shape substring (`sk-…`, `sk-ant-…`, `AIza…`, `AKIA…`, `Bearer ey…`) appears in any `chunk.error` wire byte; `upstream_body_truncated` is present ONLY in the log binding, never on the wire."
    - "No literal `finishReason:'upstream_error'` or `finishReason:'stream_error'` is emitted by stream.ts on any code path."
    - "An E2E test booting the real docker compose stack (or hermetic mock-LiteLLM compose profile) drives POST /api/agent/stream end-to-end and asserts the NDJSON wire ordering (preflight failure → single type:'error' line; happy path → content lines + done line) per CLAUDE.md DISCIPLINE rule 3 (E2E mandatory)."
  artifacts:
    - path: "apps/api/src/lib/agent-upstream-error-classify.ts"
      provides: "Pure classifier + canonical message map + AgentErrorCode / ClassifiedAgentError types"
      exports: ["classifyUpstreamError", "AgentErrorCode", "ClassifiedAgentError"]
    - path: "apps/api/src/lib/sse-parser.ts"
      provides: "Widened StreamChunk union with error variant"
      contains: "type: \"error\""
    - path: "apps/api/src/routes/agent/stream.ts"
      provides: "Refactored preflight + drain catch emitting type:error chunk + structured req.log.error"
      contains: "classifyUpstreamError"
    - path: "apps/api/tests/unit/lib/agent-upstream-error-classify.test.ts"
      provides: "Helper coverage ≥90/90/90/90 across 25+ cases"
      min_lines: 200
    - path: "apps/api/tests/unit/routes/agent/__tests__/stream-error-mapping.test.ts"
      provides: "Route-level mapping + structured-log + secret-redaction assertions"
      min_lines: 300
    - path: "apps/api/tests/integration/agent-stream-error-contract.test.ts"
      provides: "buildApp + MockAgent contract test across 6 wire failure modes"
      min_lines: 200
    - path: "tests/e2e-cjm/features/agent-stream-error.feature"
      provides: "E2E NDJSON wire-shape assertion via real docker compose stack (E2E=1, make e2e-cjm)"
      contains: "@cjm-12.3"
    - path: "tests/e2e-cjm/steps/agent-stream-error.steps.ts"
      provides: "Step bindings for agent-stream-error.feature"
      contains: "postAgentStreamError"
    - path: "tests/e2e-cjm/steps/__tests__/agent-stream-error.steps.test.ts"
      provides: "Vitest unit coverage for step bindings per feedback_cjm_steps_need_unit_tests"
      min_lines: 80
    - path: "docs/operations.md"
      provides: "Wire contract documentation + error code taxonomy + log event schema"
      contains: "agent.stream.upstream_failure"
    - path: "charts/openwhispr-server/Chart.yaml"
      provides: "Chart bump to 1.0.16 + appVersion 1.0.13"
      contains: "version: 1.0.16"
    - path: "charts/openwhispr-server/values.yaml"
      provides: "image.tag bumped to 1.0.13"
      contains: "tag: \"1.0.13\""
  key_links:
    - from: "apps/api/src/routes/agent/stream.ts (preflight catch L272-L284)"
      to: "apps/api/src/lib/agent-upstream-error-classify.ts"
      via: "import { classifyUpstreamError }"
      pattern: "classifyUpstreamError\\("
    - from: "apps/api/src/routes/agent/stream.ts (drain catch L319-L337)"
      to: "apps/api/src/lib/agent-upstream-error-classify.ts"
      via: "import { classifyUpstreamError }"
      pattern: "classifyUpstreamError\\("
    - from: "apps/api/src/lib/sse-parser.ts (StreamChunk union)"
      to: "apps/api/src/lib/agent-upstream-error-classify.ts (AgentErrorCode type)"
      via: "type-only import"
      pattern: "import.*type.*AgentErrorCode.*from.*agent-upstream-error-classify"
    - from: "apps/api/src/lib/agent-upstream-error-classify.ts"
      to: "@openwhispr/litellm-client (redactSecretShapes + LitellmUpstreamError)"
      via: "import"
      pattern: "import.*\\{[^}]*LitellmUpstreamError[^}]*redactSecretShapes[^}]*\\}|import.*\\{[^}]*redactSecretShapes[^}]*LitellmUpstreamError[^}]*\\}"
    - from: "tests/e2e-cjm/features/agent-stream-error.feature"
      to: "tests/e2e-cjm/steps/agent-stream-error.steps.ts"
      via: "Cucumber binding via support/fixtures"
      pattern: "When|Then"
---

<objective>
After this plan lands, `POST /api/agent/stream` returning ANY upstream failure (401 auth, 402 quota, 404 model_not_found, 400 invalid model name, 429 rate limit, 5xx, AbortError, undici timeout, ECONNREFUSED, generic Error) emits exactly ONE terminal `{type:"error", error: <canonical English>, code: <AgentErrorCode>, provider: "litellm"|"unknown"}` NDJSON chunk + ONE structured `req.log.error({event:"agent.stream.upstream_failure", ...}, ...)` log line; the desktop / web client renders a user-facing error in the chat bubble instead of an empty bubble.

Purpose: Close HIGH bug from peer 9zn786o0 (`/api/agent/stream` collapses every 4xx/5xx + every connect-failure into a bare opaque `done.upstream_error` chunk that the client renderer cannot bind to an error UI). Two layers of fix: (1) wire-contract correctness (peer's `type:"error"` discriminant), (2) operator observability (structured log event with model/status/code/redacted-body context).

Output: New helper module + widened wire union + refactored route catch blocks + 3 unit/integration test files (25+ helper cases, route mapping/log/secret-redaction, 6-case integration contract) + 1 e2e CJM feature file + step bindings + step-binding unit coverage (per `feedback_cjm_steps_need_unit_tests`) + ops doc section + Chart 1.0.16 / image tag v1.0.13 atomic release.

Rev 2 changes (per PLAN-CHECK iteration 1 BLOCKERS):
- B1: Adds Task 6.5 (CJM e2e feature + steps + step-binding unit test) to satisfy CLAUDE.md DISCIPLINE rule 3 "E2E mandatory".
- B2: Documents web-client e2e deferral — `apps/web` v1 has NO agent chat UI (verified: app surface is auth + admin only; `(public)` directory contains `forgot-password|reset-password|setup|sign-in|sign-up|verify-email`, no agent route). Deferred-items entry added.
- B3: Naming alignment notice in frontmatter explicitly records the CONTEXT.md → PLAN.md export rename + rationale; no rename of code paths.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/quick/260528-0cm-agent-stream-error-contract/CONTEXT.md
@.planning/quick/260528-0cm-agent-stream-error-contract/RESEARCH.md
@.planning/quick/260528-0cm-agent-stream-error-contract/PLAN-CHECK.md
@.planning/debug/agent-stream-upstream-error-2026-05-28.md
@apps/api/src/routes/agent/stream.ts
@apps/api/src/lib/sse-parser.ts
@packages/litellm-client/src/errors.ts
@packages/litellm-client/src/index.ts
@tests/e2e-cjm/features/agent-stream.feature
@tests/e2e-cjm/steps/agent-stream.steps.ts

<interfaces>
<!-- Key contracts the executor needs. Extracted from codebase. -->
<!-- Executor uses these directly — no codebase exploration needed. -->

From `@openwhispr/litellm-client` (re-exports at `packages/litellm-client/src/index.ts:704, 724, 736`):

  // Class — package-public; status/kind/retryAfterMs are readable fields.
  // .bodyText is `private declare` and NON-ENUMERABLE → DO NOT access from outside the class.
  // Read `err.message` instead (already `LiteLLM upstream returned <status>: <redacted+truncated 200-char body>`).
  export class LitellmUpstreamError extends Error {
    public readonly status: number;             // 400 | 401 | 402 | 403 | 404 | 429 | 5xx
    public readonly kind: "rate_limit" | "auth" | "server" | "client";
    public readonly retryAfterMs?: number;       // present only for 429 (parsed from Retry-After header, capped at 60000)
  }

  // Pure function — replaces credential-shape substrings in any string with REDACTED markers.
  export function redactSecretShapes(s: string): string;

From `apps/api/src/lib/sse-parser.ts:28-35` (CURRENT — to be widened):

  export type StreamChunk =
    | { type: "content"; text: string }
    | ToolCallChunk
    | { type: "done"; finishReason: string; usage: { promptTokens: number; completionTokens: number } };

From `apps/api/src/routes/agent/stream.ts:84-86` (model resolution chain — UNCHANGED, just hoisted):

  function resolveModel(bodyModel: string | undefined): string {
    return bodyModel ?? process.env.DEFAULT_AGENT_MODEL ?? DEFAULT_AGENT_MODEL;
  }

From `apps/api/src/routes/agent/stream.ts:89-110` (`endWithFinish` — UNCHANGED; remains the successful-drain `finally`-arm terminator; the new error path does NOT call it):

  function endWithFinish(raw: import("node:http").ServerResponse, finishReason: string): void {
    if (raw.writableEnded) return;
    const chunk: StreamChunk = {
      type: "done",
      finishReason,
      usage: { promptTokens: 0, completionTokens: 0 },
    };
    try { raw.write(`${JSON.stringify(chunk)}\n`); } catch {}
    try { raw.end(); } catch {}
  }

From `tests/e2e-cjm/steps/agent-stream.steps.ts:11-77` (Task 6.5 mirrors this fixture exactly):

  import { Agent, fetch as undiciFetch } from "undici";
  import { expect, Then, When } from "../support/fixtures";
  import { recordLastResponse } from "./shared/response-shared.steps";

  // postAgentStream(apiBaseURL, cookie, prompt) returns { status, contentType, rawBody }
  // parseNdjson(body) returns Array<{type, ...}> (throws on missing `type`)
  // localhostDispatcher(url) returns undici Agent with rejectUnauthorized:false for *.localhost

  // The step uses ctx.cookie from `Given a signed-in user` (steps/shared/auth-shared.steps.ts).
  // Mock-LiteLLM SSE upstream is provided by the bundled `compose-overrides.yml` profile —
  // Task 6.5 reuses the SAME profile; no new compose service required.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Helper RED — write 25+ classifier test cases against not-yet-existing helper</name>
  <files>apps/api/tests/unit/lib/agent-upstream-error-classify.test.ts</files>
  <behavior>
    All cases assert against `classifyUpstreamError(err)` returning `ClassifiedAgentError = { code, error, upstreamStatus, upstreamBody, kind }`.

    LitellmUpstreamError-based cases:
      - status=401 (kind:"auth") → code:"upstream_auth", error === expected canonical literal (per Task 2 string fixtures), upstreamStatus:401, kind:"auth"
      - status=403 (kind:"auth") → code:"upstream_auth"
      - status=402 (any kind) → code:"upstream_quota_exceeded"
      - status=429 (kind:"rate_limit", no retryAfterMs) → code:"upstream_rate_limit", error === expected canonical literal
      - status=429 with retryAfterMs:30000 → error string ends with " (retry in ~30s)" or equivalent canonical suffix (planner discretion within D3 — pin exact suffix string in Task 2 fixture)
      - status=429 with retryAfterMs:0 → suffix omitted (graceful)
      - status=404 (any body) → code:"upstream_invalid_model"
      - status=400 + bodyText matches /invalid model name/i → code:"upstream_invalid_model"
      - status=400 + bodyText matches /"code":\s*"model_not_found"/i → code:"upstream_invalid_model"
      - status=400 + bodyText matches /not.found/i → code:"upstream_invalid_model" (audit's literal regex)
      - status=400 with body "tool argument failed validation" (no model regex match) → code:"upstream_unknown"
      - status=500 (kind:"server") → code:"upstream_unknown"
      - status=502 / 503 / 504 → code:"upstream_unknown"

    Network/abort-based cases (plain Error subclasses):
      - new Error("aborted") with .name="AbortError" → code:"upstream_timeout"
      - Object.assign(new Error("connect"), {code:"ECONNREFUSED"}) → code:"upstream_timeout"
      - Object.assign(new Error("reset"), {code:"ECONNRESET"}) → code:"upstream_timeout"
      - Object.assign(new Error("timeout"), {code:"ETIMEDOUT"}) → code:"upstream_timeout"
      - Object.assign(new Error("dns"), {code:"ENOTFOUND"}) → code:"upstream_timeout"
      - Object.assign(new Error("dns soft"), {code:"EAI_AGAIN"}) → code:"upstream_timeout"
      - Object.assign(new Error("undici"), {code:"UND_ERR_HEADERS_TIMEOUT"}) → code:"upstream_timeout"
      - Object.assign(new Error("undici"), {code:"UND_ERR_BODY_TIMEOUT"}) → code:"upstream_timeout"
      - Object.assign(new Error("undici"), {code:"UND_ERR_CONNECT_TIMEOUT"}) → code:"upstream_timeout"
      - Object.assign(new Error("undici"), {code:"UND_ERR_ABORTED"}) → code:"upstream_timeout"

    Catch-all cases:
      - new Error("anything") plain → code:"upstream_unknown", upstreamBody: redactSecretShapes("anything").slice(0,500)
      - new TypeError("fetch failed") → code:"upstream_unknown"
      - null → code:"upstream_unknown", upstreamBody:null, upstreamStatus:null
      - undefined → code:"upstream_unknown", upstreamBody:null, upstreamStatus:null
      - "string error" (non-Error throw) → code:"upstream_unknown"
      - {message:"foo"} (plain object) → code:"upstream_unknown"

    Security / truncation cases:
      - LitellmUpstreamError(401, "Invalid api key sk-or-v1-abcdef1234567890abcdef1234567890") → result.error does NOT contain the literal sk-or-v1 substring (matched via /sk-[A-Za-z0-9_-]{16,}/); result.upstreamBody contains REDACTED markers
      - LitellmUpstreamError(401, "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc") → result.error does NOT contain /Bearer\s+ey[A-Za-z0-9_-]+/; result.upstreamBody redacted
      - LitellmUpstreamError(500, "X".repeat(2000)) → result.upstreamBody.length <= 500 (slice cap honored)

    Use `LitellmUpstreamError` constructor pattern that matches the package surface — `new LitellmUpstreamError(status, bodyText, { kind, retryAfterMs })`. If retryAfterMs/kind options are inferred from status by the constructor, pass status only and let it classify.
  </behavior>
  <action>
    Create test file using vitest + the canonical pattern from `apps/api/tests/unit/routes/agent/stream.test.ts` (NDJSON line parsing not needed — this is a pure helper test).

    Imports:
      ```
      import { describe, it, expect } from "vitest";
      import { LitellmUpstreamError } from "@openwhispr/litellm-client";
      import {
        classifyUpstreamError,
        type AgentErrorCode,
        type ClassifiedAgentError,
      } from "../../../src/lib/agent-upstream-error-classify.js";
      ```

    Hardcode the expected canonical strings as test-local `const EXPECTED_*` literals (the helper does NOT export `CANONICAL_ERROR_MESSAGES`; tests are the contract — they assert against the literal English strings the helper produces). Define at top of the test file:

      ```
      // Test-side mirror of the helper's internal canonical message map.
      // The strings MUST match the implementation in Task 2 exactly.
      const EXPECTED_UPSTREAM_AUTH = "Upstream model provider rejected the request (authentication failure). Contact your operator.";
      const EXPECTED_UPSTREAM_RATE_LIMIT = "Rate limit reached. Please retry in a few seconds.";
      const EXPECTED_UPSTREAM_QUOTA_EXCEEDED = "Upstream provider quota exceeded. Contact your operator.";
      const EXPECTED_UPSTREAM_INVALID_MODEL = "Requested model is not available on this server. Choose a different model or contact your operator.";
      const EXPECTED_UPSTREAM_TIMEOUT = "Upstream provider did not respond in time. Please retry.";
      const EXPECTED_UPSTREAM_UNKNOWN = "Upstream model provider is temporarily unavailable. Please try again.";
      ```

    Organize as four `describe` blocks: "LitellmUpstreamError mapping", "Network/abort error mapping", "Catch-all defensive paths", "Security and truncation". Each individual case is an `it(...)`. Coverage target: ≥90% lines/branches/functions/statements on the helper file (verified by running `pnpm --filter @openwhispr/api test --coverage agent-upstream-error-classify`).

    Run `pnpm --filter @openwhispr/api test agent-upstream-error-classify.test.ts` → MUST fail with `Cannot find module '.../src/lib/agent-upstream-error-classify.js'` or equivalent missing-module error. This proves RED state.

    Commit: `test(260528-0cm): RED — agent stream upstream error classifier (25+ cases)`
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && pnpm --filter @openwhispr/api test agent-upstream-error-classify.test.ts 2>&1 | tail -20</automated>
  </verify>
  <done>Test file exists with all 25+ test cases enumerated above; running the test command fails with module-not-found (not assertion failures) — confirming RED phase before any implementation.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Helper GREEN — implement classifier + canonical messages (D2, D3, D4 locks; PLAN rev 2 naming)</name>
  <files>apps/api/src/lib/agent-upstream-error-classify.ts</files>
  <behavior>
    Pure helper. No side effects. No NODE_ENV branches (LOCKER-01 clean). No hardcoded credentials / UUIDs / localhost (LOCKER-03 clean — canonical messages are English literals describing failure modes, NOT credential shapes). No type suppressions (LOCKER-02 clean — only plain `as { name?, code?, message? }` casts). Per D3: every body-source extraction goes through `redactSecretShapes(...).slice(0, 500)` (LOCKER-05 belt-and-braces).

    Naming alignment per rev 2 (B3 fix): the helper exports `classifyUpstreamError`, `AgentErrorCode`, `ClassifiedAgentError` — the SHORTER forms vs. CONTEXT.md's `classifyAgentUpstreamError` / `AgentUpstreamErrorCode` / `AgentUpstreamErrorEnvelope`. Frontmatter `naming_alignment` block records the rename. CONTEXT.md's `AgentUpstreamProvider` type is DROPPED entirely — provider is inline-encoded at the route call site (D2), never exposed as a helper export.

    Test 1 (from Task 1) passes after this task completes.
  </behavior>
  <action>
    Create the helper module with the following exports (no other exports — LOCKER-04 dead-export hygiene; `CANONICAL_ERROR_MESSAGES` is an internal const, NOT exported):

    1. `AgentErrorCode` type union (6 members per CONTEXT.md D3 + RESEARCH.md R11):
       `"upstream_auth" | "upstream_rate_limit" | "upstream_quota_exceeded" | "upstream_invalid_model" | "upstream_timeout" | "upstream_unknown"`

    2. `ClassifiedAgentError` interface:
       ```
       {
         code: AgentErrorCode;
         error: string;               // canonical English, ≤500 chars, secret-redacted
         upstreamStatus: number | null;
         upstreamBody: string | null; // <=500 chars, secret-redacted; null for non-LitellmUpstreamError + null/undefined err
         kind: string | null;         // LitellmUpstreamError.kind passthrough ("auth"|"rate_limit"|"server"|"client") or null
       }
       ```

    3. Internal const `CANONICAL_ERROR_MESSAGES` (NOT exported — LOCKER-04 hygiene; tests assert against literal strings duplicated in test fixtures):

       ```
       const CANONICAL_ERROR_MESSAGES = Object.freeze({
         upstream_auth: "Upstream model provider rejected the request (authentication failure). Contact your operator.",
         upstream_rate_limit: "Rate limit reached. Please retry in a few seconds.",
         upstream_quota_exceeded: "Upstream provider quota exceeded. Contact your operator.",
         upstream_invalid_model: "Requested model is not available on this server. Choose a different model or contact your operator.",
         upstream_timeout: "Upstream provider did not respond in time. Please retry.",
         upstream_unknown: "Upstream model provider is temporarily unavailable. Please try again.",
       } as const) satisfies Record<AgentErrorCode, string>;
       ```

       The `satisfies` clause provides exhaustive-coverage compile-time gate; adding a code without a message is a type error.

    4. `classifyUpstreamError(err: unknown): ClassifiedAgentError`:

       Step A — `LitellmUpstreamError` branch (per D2 lock: `provider:"litellm"` is encoded at the route call site, NOT inside this helper; the helper's `ClassifiedAgentError` does NOT carry provider — provider is set inline in the route catch when building the wire chunk):
         - Extract `bodyText = redactSecretShapes(err.message ?? "").slice(0, 500)` (belt-and-braces per gotcha R11.gotcha-1 — err.message is already 200-char truncated by the constructor; re-redact + re-slice to 500 cap)
         - Common fields: `upstreamStatus = err.status`, `upstreamBody = bodyText`, `kind = err.kind`
         - Branch on status (in this exact priority order — first match wins):
           * `err.kind === "auth"` OR `status === 401` OR `status === 403` → code `upstream_auth`
           * `status === 402` → code `upstream_quota_exceeded`
           * `status === 429` → code `upstream_rate_limit`; if `err.retryAfterMs` present AND > 0, set `error = CANONICAL_ERROR_MESSAGES.upstream_rate_limit + " (retry in ~" + String(Math.ceil(err.retryAfterMs / 1000)) + "s)"` — gracefully degrades to base message when retryAfterMs is undefined or 0
           * `status === 404` → code `upstream_invalid_model`
           * `status === 400` AND bodyText matches `/invalid model name|model_not_found|not.found/i` (audit §5.2's literal regex — keep as-is per RESEARCH.md R3 sharpening note: status-first narrowing limits false-positive blast radius to 400s) → code `upstream_invalid_model`
           * `status >= 500` → code `upstream_unknown`
           * Otherwise → code `upstream_unknown` (covers 400 without model regex, 408, 451, etc.)
         - `error` field = `CANONICAL_ERROR_MESSAGES[code]` (or the retry-suffix variant for the rate_limit-with-retryAfterMs branch above)

       Step B — Network/abort/dispatch branch (D2 lock: route will encode `provider:"unknown"` for these — helper does not carry provider):
         - Cast: `const e = err as { name?: string; code?: unknown; message?: string }` (LOCKER-02 clean — plain `as` cast pattern matches existing repo norm in `packages/litellm-client/src/retry.ts:45`)
         - If `e?.name === "AbortError"` → code `upstream_timeout`
         - Else if `typeof e?.code === "string"`:
           * `e.code` in {`"UND_ERR_ABORTED"`, `"UND_ERR_CONNECT_TIMEOUT"`, `"UND_ERR_HEADERS_TIMEOUT"`, `"UND_ERR_BODY_TIMEOUT"`, `"ECONNREFUSED"`, `"ECONNRESET"`, `"ETIMEDOUT"`, `"ENOTFOUND"`, `"EAI_AGAIN"`, `"UND_ERR_SOCKET"`} → code `upstream_timeout`
           * (Per CONTEXT.md D3 + user prompt scope: ECONNREFUSED/ECONNRESET/ETIMEDOUT/ENOTFOUND/EAI_AGAIN ALSO map to `upstream_timeout` per the user's explicit task description — NOT `upstream_unknown` as RESEARCH.md R4 suggested. The user prompt is the locked authority.)
         - All branches in Step B: `upstreamStatus: null`, `upstreamBody: redactSecretShapes(e?.message ?? "").slice(0, 500) || null`, `kind: null`, `error: CANONICAL_ERROR_MESSAGES.upstream_timeout`

       Step C — Catch-all (anything else, including `null` / `undefined` / non-Error throws / TypeError):
         - code `upstream_unknown`
         - `upstreamStatus: null`, `kind: null`
         - `upstreamBody`: if `err` is non-null object with string `.message`, `redactSecretShapes(err.message).slice(0, 500) || null`; else `null`
         - `error: CANONICAL_ERROR_MESSAGES.upstream_unknown`

    Imports:
      ```
      import { LitellmUpstreamError, redactSecretShapes } from "@openwhispr/litellm-client";
      ```

    NO other imports. NO `process.env.NODE_ENV`. NO `as any` / `as unknown as`. NO `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error` (LOCKER-02).

    Run Task 1's test command → must now pass (GREEN). Run coverage report → must show ≥90/90/90/90 on this file.

    Commit: `feat(260528-0cm): GREEN — agent upstream error classifier + canonical messages`
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && pnpm --filter @openwhispr/api test --coverage agent-upstream-error-classify.test.ts 2>&1 | tail -30</automated>
  </verify>
  <done>
    Test 1's command exits 0 (all cases pass). Coverage report shows ≥90% on lines AND branches AND functions AND statements for `apps/api/src/lib/agent-upstream-error-classify.ts`. `grep -v '^//' apps/api/src/lib/agent-upstream-error-classify.ts | grep -c 'process.env.NODE_ENV'` returns 0 (LOCKER-01 clean). `grep -v '^//' apps/api/src/lib/agent-upstream-error-classify.ts | grep -cE 'as any|as unknown as|@ts-ignore|@ts-nocheck|@ts-expect-error'` returns 0 (LOCKER-02 clean). The exported names are EXACTLY `classifyUpstreamError`, `AgentErrorCode`, `ClassifiedAgentError` — verify with `grep -nE '^export (function|type|interface) (classifyUpstreamError|AgentErrorCode|ClassifiedAgentError)' apps/api/src/lib/agent-upstream-error-classify.ts | wc -l` returns 3.
  </done>
</task>

<task type="auto">
  <name>Task 3: Widen StreamChunk union — add type:"error" variant</name>
  <files>apps/api/src/lib/sse-parser.ts</files>
  <behavior>
    The `StreamChunk` discriminated union gains a fourth member: `{ type: "error"; error: string; code: AgentErrorCode; provider: "litellm" | "unknown" }`. Existing three variants unchanged. The `translateChunk` generator does NOT yield the new variant — only the route catch blocks emit it (Task 5). Per D4 lock, the `done.finishReason` string field stays `string` (we just stop emitting `"upstream_error"` / `"stream_error"` from the route — both values become unreachable at runtime). Type-only ratchet; zero runtime delta in this file.
  </behavior>
  <action>
    Edit `apps/api/src/lib/sse-parser.ts:28-35`. Add type-only import of `AgentErrorCode` from the new helper (the route handler's existing import path; sse-parser → agent-upstream-error-classify is a same-layer lib edge, no circular risk per RESEARCH.md R5):

    ```
    import type { AgentErrorCode } from "./agent-upstream-error-classify.js";
    ```

    Widen the union to:

    ```
    export type StreamChunk =
      | { type: "content"; text: string }
      | ToolCallChunk
      | {
          type: "done";
          finishReason: string;
          usage: { promptTokens: number; completionTokens: number };
        }
      | {
          type: "error";
          error: string;
          code: AgentErrorCode;
          provider: "litellm" | "unknown";
        };
    ```

    Update the file-header comment block (the existing block at lines 20-27 starting `// R32 — wire vocabulary.`) to add one sentence: `// 260528-0cm — gained type:"error" variant emitted ONLY by the agent.stream route catch blocks (preflight + drain). The translateChunk generator below never yields it.`

    Do NOT add `"error"` as a finish_reason in `translateChunk` — it remains a catch-block-only terminal frame.

    Verify: `pnpm --filter @openwhispr/api typecheck` succeeds AND every consumer that does a switch on `chunk.type` still compiles (RESEARCH.md R5 confirms only `stream.test.ts` lines 425/871/940/1187-1196/1240 destructure; they discriminate on `type` and the new variant is additive — safe).

    Commit: `refactor(260528-0cm): widen StreamChunk union with type:"error" variant`
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && pnpm --filter @openwhispr/api typecheck 2>&1 | tail -10</automated>
  </verify>
  <done>`typecheck` exits 0. `grep -c 'type: "error"' apps/api/src/lib/sse-parser.ts` returns >= 1. The new `import type { AgentErrorCode }` line is present.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Route-level RED — rewrite stream.test.ts Tests 9, 10, 17, 18 + add stream-error-mapping.test.ts</name>
  <files>apps/api/tests/unit/routes/agent/stream.test.ts, apps/api/tests/unit/routes/agent/__tests__/stream-error-mapping.test.ts</files>
  <behavior>
    All route-level wire assertions move from `finishReason:"upstream_error"` / `finishReason:"stream_error"` to `type:"error"` + `code` + `provider` + structured `req.log.error`. After this task: the test commands MUST fail because `stream.ts` still emits the old shape.

    Pre-existing Test 9, Test 10, Test 17, Test 18 in `stream.test.ts` (per RESEARCH.md R8 + audit §7.2) are REWRITTEN IN-PLACE (same `it(...)` slots, new assertions). Test names should be updated to reflect new behavior (e.g., `"emits terminal type:error chunk on preflight LitellmUpstreamError(401)"` instead of `"emits done.upstream_error on auth failure"`).

    New `stream-error-mapping.test.ts` covers 5 areas not addressed by `stream.test.ts` rewrites:
      - Per-status-class wire mapping (mirror of helper cases at the route boundary)
      - Structured log assertion (audit §7.3 `agent.stream.upstream_failure` event with full binding)
      - Mid-stream drain parity (audit §7.4 — content chunks preserved + error chunk terminal)
      - Secret-shape negative assertions (audit §7.1 — sk-… / Bearer ey… never reach the wire)
      - Log-level flip (req.log.error called exactly once; req.log.warn NOT called for these paths)
  </behavior>
  <action>
    PART A — Create directory: `mkdir -p apps/api/tests/unit/routes/agent/__tests__`.

    PART B — Rewrite tests in `apps/api/tests/unit/routes/agent/stream.test.ts` (locate the 4 affected tests via grep for `upstream_error` and `stream_error` substrings; expected slots are Tests 9, 10, 17, 18 per RESEARCH.md R8 / gotcha-7):

      - Test 9 (preflight 401 / auth fail): assert response body is EXACTLY one newline-terminated NDJSON line; `JSON.parse(line).type === "error"`; `chunk.code === "upstream_auth"`; `chunk.provider === "litellm"`; `chunk.error === "Upstream model provider rejected the request (authentication failure). Contact your operator."` (test-side literal mirror of the helper's internal CANONICAL_ERROR_MESSAGES.upstream_auth); assert NO substring `"finishReason":"upstream_error"` ANYWHERE in response body (`expect(r.body).not.toContain('"finishReason":"upstream_error"')`); assert NO substring `"type":"done"` ANYWHERE in response body for this test (preflight failure → no done chunk).

      - Test 10 (mid-stream drain error): stub `chatCompletionsStream` to return a body that yields 2 content chunks then throws mid-drain (use `Readable.from` with an async-iterable that throws on the 3rd pull, OR use MockAgent that closes the socket abruptly after 2 SSE frames). Assert response body parses into N+1 NDJSON lines: 2 content chunks (preserved) + 1 terminal `{type:"error", code:"upstream_unknown", provider:"unknown"}` (the drain catch sees a raw Error, not a LitellmUpstreamError). Assert NO `"finishReason":"stream_error"` substring. Assert NO `"type":"done"` substring in this test's response.

      - Test 17 (preflight LitellmUpstreamError(500) / 5xx): assert `code:"upstream_unknown"`, `provider:"litellm"`, single terminal `type:"error"` line, no `done` chunk.

      - Test 18 (preflight invalid model — LitellmUpstreamError(400, "Invalid model name passed in model=openai/gpt-oss-120b")): assert `code:"upstream_invalid_model"`, `provider:"litellm"`, single terminal `type:"error"` line. Additional assertion: `chunk.error` does NOT contain the literal `openai/gpt-oss-120b` (canonical message is provider-/model-name-agnostic).

      In ALL four rewritten tests, ALSO add `req.log` spy assertions: `req.log.error` called exactly once with binding `{ event: "agent.stream.upstream_failure", upstream_status, code, provider, model, upstream_body_truncated, request_id, ...optional retry_after_ms, litellm_call_id }`; `req.log.warn` NOT called with any `agent.stream` message. (Pattern: instantiate the app with a logger that captures emitted records via a child-logger interceptor, or use `vi.spyOn(req, "log")` inside an `onRequest` hook.)

    PART C — Create `apps/api/tests/unit/routes/agent/__tests__/stream-error-mapping.test.ts` with these describe blocks:

      1. `"wire envelope per AgentErrorCode"` — stub `chatCompletionsStream` (Strategy B per RESEARCH.md R8.2) to reject with each of: `LitellmUpstreamError(401, ...)`, `(402, ...)`, `(403, ...)`, `(429, "rate limit", { retryAfterMs: 30000 })`, `(404, "model not found")`, `(400, "Invalid model name passed in model=foo")`, `(400, '{"error":{"code":"model_not_found"}}')`, `(400, "tool argument failed")`, `(500, "boom")`, `(502, ...)`, `Object.assign(new Error("connect"), {code:"ECONNREFUSED"})`, `Object.assign(new Error("abort"), {name:"AbortError"})`, `new TypeError("fetch failed")`. For each: assert exactly ONE wire line, `type:"error"`, expected `code`, expected `provider` ("litellm" for LitellmUpstreamError cases, "unknown" otherwise), `chunk.error` matches the expected canonical literal (modulo retry suffix on 429-with-retryAfterMs — assert `chunk.error.endsWith("(retry in ~30s)")`).

      2. `"structured log binding shape"` — for each of the 13 cases above, capture the emitted `req.log.error` record; assert `record.event === "agent.stream.upstream_failure"`, `record.code` matches, `record.provider` matches, `record.upstream_status` matches the expected (`401|402|...` or `null`), `record.model` equals the resolved model string (whatever `resolveModel(body.model ?? undefined)` returned for the test request — pin via `req.body.model = "openwhispr-default"` and assert `record.model === "openwhispr-default"`), `record.request_id` is a non-empty string equal to `req.id`, `record.upstream_body_truncated == null || record.upstream_body_truncated.length <= 500`. For the 429-with-retryAfterMs case: assert `record.retry_after_ms === 30000`.

      3. `"log level flip"` — assert `req.log.error` called exactly once; `req.log.warn` NOT called with any string starting with `"agent.stream upstream"` or `"agent.stream drain"`.

      4. `"secret-shape redaction at the wire boundary"` — drive `LitellmUpstreamError(401, "Invalid api key sk-or-v1-abcdef1234567890abcdef1234567890 Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.deadbeef")`; assert (a) `chunk.error` does NOT match `/sk-[A-Za-z0-9_-]{16,}/`, (b) `chunk.error` does NOT match `/Bearer\s+ey[A-Za-z0-9_-]+/`, (c) `chunk` JSON has NO `upstream_body_truncated` key (`expect(Object.keys(chunk)).not.toContain("upstream_body_truncated")`), (d) the structured log binding's `upstream_body_truncated` DOES contain the `[REDACTED]` markers from `redactSecretShapes`.

      5. `"mid-stream drain parity"` — stub a body that emits 2 valid SSE `content` frames then throws `LitellmUpstreamError(500, "stream cut")`. Assert: 3 NDJSON lines total; lines 1+2 are `{type:"content", text:"..."}`; line 3 is `{type:"error", code:"upstream_unknown", provider:"litellm"}`; assert NO `{type:"done", ...}` line anywhere; assert response body ends with exactly one `\n`.

    Test app builder: reuse `buildTestApp` pattern from existing `stream.test.ts` (RESEARCH.md R8.1). Mock dependencies via Strategy B (stubbed `chatCompletionsStream`); MockAgent (Strategy A) NOT needed at this tier — that's covered by Task 6's integration test.

    Run test commands; both MUST fail with assertion mismatches (e.g., expected `type:"error"` received `type:"done"`, expected `code` field present but undefined, expected `req.log.error` called once but called 0 times — `req.log.warn` was called instead). This proves RED state.

    Commit: `test(260528-0cm): RED — route wire contract + structured log + secret redaction`
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && pnpm --filter @openwhispr/api test 'stream.test.ts|stream-error-mapping.test.ts' 2>&1 | tail -30</automated>
  </verify>
  <done>
    Both test files exist. Running them produces failures (NOT passes, NOT module-not-found) — specifically assertion failures of the form "expected type:error received type:done" / "expected code field present but undefined" / "expected req.log.error called once but called 0 times". This confirms the route is still emitting the old shape, ready for Task 5's GREEN edit.
  </done>
</task>

<task type="auto">
  <name>Task 5: Route GREEN — refactor stream.ts preflight + drain catches to emit type:"error" chunk</name>
  <files>apps/api/src/routes/agent/stream.ts</files>
  <behavior>
    The preflight catch (L272-L284) and drain catch (L319-L337) BOTH:
      1. Call `classifyUpstreamError(err)` to get the typed envelope.
      2. Compute `provider = err instanceof LitellmUpstreamError ? "litellm" : "unknown"` inline (D2 lock — provider is route-level concern, not helper concern).
      3. Write exactly ONE terminal NDJSON line `{type:"error", error, code, provider}` to `raw` if `!raw.writableEnded`.
      4. Emit exactly ONE `req.log.error({event:"agent.stream.upstream_failure", upstream_status, code, provider, model: resolvedModel, upstream_body_truncated, request_id, retry_after_ms?, litellm_call_id?}, "agent stream upstream call failed")` line.
      5. NEVER call `endWithFinish(...)` from these paths.
      6. NEVER emit `done.upstream_error` or `done.stream_error` (D4 lock — string literals removed).

    `endWithFinish` (L89-L110) is UNCHANGED — it remains the terminator for the successful-drain `finally`-arm (`raw.end()` at L341), used only when the drain loop ran cleanly to completion and the SSE stream's own `done` chunk has already been written.

    After this task: Tasks 1, 4 test commands all pass; Task 4 RED becomes GREEN.

    The hoisted `resolvedModel` const is declared ABOVE the try block (between L252 and L253 in current line numbering) so it's available in both catches and in the log binding (RESEARCH.md gotcha-9). Audit §5.1 ratifies this.
  </behavior>
  <action>
    PART A — Add import (top of file, alongside other lib imports near L59):

      ```
      import { classifyUpstreamError } from "../../lib/agent-upstream-error-classify.js";
      ```

      (`CANONICAL_ERROR_MESSAGES` is NOT exported from the helper — the route reads `classified.error` directly, which already IS the canonical string. LOCKER-04 dead-import clean.)

    PART B — Hoist `resolvedModel`. Find the line `model: resolveModel(body.model ?? undefined),` inside `deps.litellm.chatCompletionsStream({...})` (currently L266). Before the `let upstream: ...;` declaration at L252, insert:

      ```
      // Hoist resolved model so the preflight catch (no response yet) and drain catch (response started) can both bind it into the structured `agent.stream.upstream_failure` log event.
      const resolvedModel = resolveModel(body.model ?? undefined);
      ```

      Then replace the inline call inside `chatCompletionsStream({ ... })` at L266 with `model: resolvedModel,`.

    PART C — Define a small inline helper at the top of the handler scope (between PART B's `resolvedModel` line and the existing `try {`) to factor the shared emit-error-chunk-and-log code path between the two catches. Pure local closure — no new file, no top-level export:

      ```
      const emitTerminalErrorChunk = (
        err: unknown,
        opts: { litellmCallId?: string | undefined },
      ): void => {
        const classified = classifyUpstreamError(err);
        const provider: "litellm" | "unknown" =
          err instanceof LitellmUpstreamError ? "litellm" : "unknown";
        const retryAfterMs =
          err instanceof LitellmUpstreamError ? err.retryAfterMs : undefined;

        req.log.error(
          {
            event: "agent.stream.upstream_failure",
            upstream_status: classified.upstreamStatus,
            upstream_body_truncated: classified.upstreamBody,
            code: classified.code,
            provider,
            kind: classified.kind,
            model: resolvedModel,
            litellm_call_id: opts.litellmCallId,
            retry_after_ms: retryAfterMs,
            request_id: req.id,
          },
          "agent stream upstream call failed",
        );

        if (!raw.writableEnded) {
          const chunk: StreamChunk = {
            type: "error",
            error: classified.error,
            code: classified.code,
            provider,
          };
          try {
            raw.write(`${JSON.stringify(chunk)}\n`);
            /* v8 ignore next 3 -- defensive: socket closed mid-write */
          } catch {
            // socket already closed — nothing more to do.
          }
        }
      };
      ```

    PART D — Replace the preflight catch block at L272-L284 with:

      ```
      } catch (err) {
        // 260528-0cm — Map upstream failure to the {type:"error",...} wire envelope.
        // The client renderer treats `type:"error"` as terminal; we do NOT emit a
        // subsequent `done` chunk. CONTEXT.md D1 / D2 / D3 / D4 locked.
        emitTerminalErrorChunk(err, { litellmCallId: undefined });
        if (!raw.writableEnded) {
          try {
            raw.end();
            /* v8 ignore next 3 -- defensive: socket closed mid-end */
          } catch {
            // socket already closed.
          }
        }
        return reply;
      }
      ```

      Deletes: `if (err instanceof LitellmUpstreamError) { req.log.warn(...) } else { req.log.warn(...) }`; deletes `endWithFinish(raw, "upstream_error");`. The `req.log.warn` flips to `req.log.error` via the closure.

    PART E — Replace the drain catch at L319-L337 with:

      ```
      } catch (err) {
        // 260528-0cm — Drain-side failure shares the wire shape with preflight:
        // ONE terminal `{type:"error",...}` chunk replaces the previous
        // `done.stream_error` chunk. CONTEXT.md D1 lock — the error chunk IS
        // terminal; no `done` follows. The `finally` block below handles
        // raw.end() — do NOT duplicate it here (RESEARCH.md gotcha-5).
        emitTerminalErrorChunk(err, { litellmCallId });
      }
      ```

      Deletes: `req.log.warn(...)`; deletes the synthetic `const finish: StreamChunk = { type:"done", finishReason:"stream_error", ... }; raw.write(...)` block.

      The `finally { if (!raw.writableEnded) { raw.end() } }` block at L338-L347 is UNCHANGED — it still terminates the response after both clean drains AND error drains.

    PART F — Update file header comment (lines 19-43 of the existing block). The "Lifecycle (RESEARCH §2.2 lines 207–296)" comment numbered list item 7 currently reads `"7. try/catch around the drain: on mid-stream error, emit a finish(stream_error) chunk if writable. finally: end the response."` — update to `"7. try/catch around the drain: on mid-stream error, emit ONE {type:\"error\", code, provider} chunk via emitTerminalErrorChunk (CONTEXT.md D1 / 260528-0cm). The error chunk IS terminal; no done follows. finally: end the response."`. The "CRITICAL — after reply.hijack()..." paragraph below it stays as-is.

    Verify: Run Task 4's test commands → both pass (GREEN). Run `pnpm --filter @openwhispr/api typecheck` → exits 0. Run repo-wide grep `git grep -nE '"upstream_error"|"stream_error"' apps/api/src/ packages/*/src/` → returns ZERO matches in non-test production source.

    Commit: `feat(260528-0cm): GREEN — agent stream emits type:"error" terminal chunk on upstream failure`
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && pnpm --filter @openwhispr/api test 'stream.test.ts|stream-error-mapping.test.ts|agent-upstream-error-classify.test.ts' 2>&1 | tail -20 && pnpm --filter @openwhispr/api typecheck 2>&1 | tail -5 && (git grep -nE '"upstream_error"|"stream_error"' apps/api/src/ packages/*/src/ 2>&1 && echo "FAIL: residual literals found" || echo "OK: no matches in source")</automated>
  </verify>
  <done>
    All three test files (helper unit, stream.test.ts rewrites, stream-error-mapping.test.ts) pass. Typecheck exits 0. `git grep` for `"upstream_error"|"stream_error"` literals in `apps/api/src/` + `packages/*/src/` returns ZERO matches (test files + load-test forensic comment + dist artifacts are scoped out of the grep). Read `apps/api/src/routes/agent/stream.ts` directly to confirm: (a) `endWithFinish(raw, "upstream_error")` call deleted; (b) the synthetic `finish: StreamChunk = {type:"done", finishReason:"stream_error", ...}` block deleted; (c) `emitTerminalErrorChunk` closure present; (d) `const resolvedModel = resolveModel(...)` hoisted above the try; (e) the `chatCompletionsStream({ model: ... })` call uses `model: resolvedModel,`; (f) the file header comment item 7 references `emitTerminalErrorChunk` / `260528-0cm`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 6: Contract integration test — buildApp + MockAgent across 6 wire failure modes</name>
  <files>apps/api/tests/integration/agent-stream-error-contract.test.ts</files>
  <behavior>
    Integration-tier test booting the real Fastify graph via `buildApp()` (or the equivalent `buildTestApp` pattern that wires all global hooks per project Hard Rule on characterization tests). Real auth path (test bearer issuance via the standard pattern in `apps/api/tests/integration/r20-bearer-session-resolution.test.ts`). Real Postgres + Valkey via testcontainers (the buildApp graph requires them; do NOT mock data plane — project rules forbid in-process logic mocks; only network-boundary mocks are allowed → MockAgent at the LiteLLM HTTP boundary).

    Six contract assertions per audit §7.2 + RESEARCH.md R8.2 Strategy A:

      1. **401 upstream → upstream_auth chunk**: MockAgent intercepts `POST {LITELLM_BASE}/v1/chat/completions` → returns 401 with body `{"error":{"message":"Invalid api key"}}`. POST `/api/agent/stream` with valid bearer + body `{messages:[{role:"user", content:"hi"}], model:"openwhispr-default"}`. Read response as NDJSON; assert exactly 1 line; assert `{type:"error", code:"upstream_auth", provider:"litellm"}`; assert response Content-Type is `application/x-ndjson`; assert HTTP status 200 (post-hijack); assert socket closed.

      2. **429 with Retry-After → upstream_rate_limit chunk**: MockAgent reply 429 + header `Retry-After: 30`. Assert single terminal `{type:"error", code:"upstream_rate_limit", provider:"litellm"}`; assert `chunk.error` includes the retry-suffix `(retry in ~30s)` (matches Task 2 implementation).

      3. **5xx → upstream_unknown chunk**: MockAgent reply 503 "service unavailable". Assert `{type:"error", code:"upstream_unknown", provider:"litellm"}`.

      4. **Network error mid-stream → terminal type:"error" + content preserved**: MockAgent first returns 200 with a streaming body that emits 2 valid SSE frames (`data: {"choices":[{"delta":{"content":"hel"}}]}\n\n` then `data: {"choices":[{"delta":{"content":"lo"}}]}\n\n`) then closes the socket abruptly (use `MockClient.intercept().reply(200, body)` where `body` is an async-iterable that throws / closes after 2 yields). Assert response body parses to 3 NDJSON lines: 2 lines have `type==="content"` and `text` is non-empty, final line `{type:"error", code:"upstream_unknown", provider:"unknown"}`. NOTE rev 2 (PLAN-CHECK WARNING-3 tightening): mid-stream socket close from undici surfaces as a plain Error (`UND_ERR_*` or generic), NOT a LitellmUpstreamError — the LitellmUpstreamError constructor fires only at preflight response-header parse time. Therefore provider MUST be `"unknown"`; do NOT accept `"litellm"`. Assert NO `{type:"done"}` chunk anywhere.

      5. **400 model_not_found body → upstream_invalid_model chunk**: MockAgent reply 400 + body `{"error":{"message":"The model openai/gpt-oss-120b does not exist","type":"invalid_request_error","code":"model_not_found"}}`. Assert `{type:"error", code:"upstream_invalid_model", provider:"litellm"}`; assert `chunk.error === "Requested model is not available on this server. Choose a different model or contact your operator."` (no model name leaked).

      6. **ECONNREFUSED to LITELLM_BASE → upstream_timeout chunk**: Point `LITELLM_BASE_URL` env at a closed TCP port (e.g., `http://127.0.0.1:1` — port 1 is reserved/closed); do NOT install a MockAgent for this case. The undici dispatcher will throw `ECONNREFUSED`. Assert `{type:"error", code:"upstream_timeout", provider:"unknown"}`.

    All 6 cases additionally assert: NO secret-shape regex matches in the response bytes (`/sk-[A-Za-z0-9_-]{16,}/`, `/Bearer\s+ey[A-Za-z0-9_-]+/`, `/AKIA[A-Z0-9]{16}/`, `/AIza[A-Za-z0-9_-]{35}/`).

    Coverage target: route catch paths (preflight + drain) 100% covered after this test runs (combined with Task 4's unit tests).
  </behavior>
  <action>
    Create `apps/api/tests/integration/agent-stream-error-contract.test.ts` using the `buildApp` + testcontainers pattern from `r20-bearer-session-resolution.test.ts` (copy the boilerplate: testcontainers startup, bearer issuance, env-binding). For the LiteLLM upstream mock, use `MockAgent` per RESEARCH.md R8.2 Strategy A pattern:

      ```
      import { MockAgent, setGlobalDispatcher } from "undici";
      // ...
      const agent = new MockAgent({ connections: 10 });
      agent.disableNetConnect();
      Object.defineProperty(agent, Symbol.for("openwhispr.ssrf-wrapped"), {
        value: true, enumerable: false, writable: false, configurable: false,
      });
      setGlobalDispatcher(agent);
      ```

    Pin `process.env.LITELLM_BASE_URL` to a known fixture URL (`http://litellm.test:4000`) so MockAgent intercept paths are deterministic. Reset `setGlobalDispatcher` to the real Agent in `afterAll`.

    For Case 6 (ECONNREFUSED), use a separate `describe` block that does NOT install MockAgent (or selectively `enableNetConnect()` for that specific test) and points `LITELLM_BASE_URL` at `http://127.0.0.1:1`. The test must not require any external service.

    Use NDJSON line parsing via the standard pattern: split body on `\n`, filter empty lines, JSON.parse each.

    For Case 4's streaming-then-closing body: construct an `AsyncIterable<Buffer>` that yields two SSE frames then `throw new Error("socket closed")` on the third pull. MockAgent's `reply(200, body)` accepts an async iterable.

    Project Hard Rule on test-fix integrity: this test MUST NOT touch production code to make it pass — any failure surfaces a route bug, not a test bug.

    Run command: `pnpm --filter @openwhispr/api test agent-stream-error-contract`. After Task 5 lands, this should pass on all 6 cases.

    Commit: `test(260528-0cm): contract integration — agent stream type:"error" wire envelope across 6 failure modes`
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && pnpm --filter @openwhispr/api test agent-stream-error-contract.test.ts 2>&1 | tail -20</automated>
  </verify>
  <done>
    Integration test exits 0 with all 6 cases passing. Combined with Task 4's unit tests, the `stream.ts` preflight + drain catch lines hit 100% coverage (verified via `pnpm --filter @openwhispr/api test --coverage` filtered to `stream.ts`). The test boots real Postgres + Valkey via testcontainers; ONLY the LiteLLM HTTP boundary is mocked (undici MockAgent) — no in-process logic mocks per project rule. Case 4 provider asserted EXACTLY as `"unknown"` (rev 2 tightening per PLAN-CHECK WARNING-3).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 6.5: E2E CJM — agent-stream-error.feature + step bindings + step-binding unit coverage (CLAUDE.md DISCIPLINE 3)</name>
  <files>tests/e2e-cjm/features/agent-stream-error.feature, tests/e2e-cjm/steps/agent-stream-error.steps.ts, tests/e2e-cjm/steps/__tests__/agent-stream-error.steps.test.ts</files>
  <behavior>
    Per CLAUDE.md DISCIPLINE rule 3 ("E2E mandatory — every phase touching a user-visible route, wire surface, or operator-facing artifact ships at least one e2e test booting the real `docker compose` stack (or hermetic mock-LiteLLM); lives in `tests/e2e/`, gated by `E2E=1`, run via `make e2e-test`"): this phase touches both a user-visible route (`POST /api/agent/stream`) AND a wire surface (the NDJSON `type:"error"` envelope). One e2e test is required.

    Implementation choice (rev 2): use the EXISTING `tests/e2e-cjm/` Cucumber/Playwright harness that already houses `agent-stream.feature` + `agent-stream.steps.ts` — same compose profile (`compose-overrides.yml` with bundled mock-LiteLLM SSE upstream), same step-binding conventions, same Makefile target (`make e2e-cjm` — which is part of the project's e2e-test family and runs under `E2E=1`). This satisfies the DISCIPLINE rule's spirit (real compose boot + hermetic mock-LiteLLM) AND the project pattern (CJM features for wire-shape assertions per Phase 25 / Plan 25-01 precedent).

    Test cases (3 scenarios mirroring the integration test's most-impactful failure modes — keeps e2e runtime tight):
      - `@cjm-12.3 preflight 4xx → terminal type:"error" line`: configure mock-litellm to return 404 model_not_found for `model=missing-alias`; POST /api/agent/stream; assert response Content-Type is `application/x-ndjson`; assert response body is EXACTLY one NDJSON line; assert `JSON.parse(line) == {type:"error", code:"upstream_invalid_model", provider:"litellm", error:"Requested model is not available on this server. Choose a different model or contact your operator."}`; assert NO `type:"done"` line anywhere.
      - `@cjm-12.4 happy path regression (no regression on success)`: POST /api/agent/stream with valid prompt + valid model; assert ≥1 `type:"text-delta"` line AND terminal `type:"finish"` line; assert NO `type:"error"` line. (This mirrors `agent-stream.feature` @cjm-12.1 — guards against the union-widening introducing a regression in the happy path.)
      - `@cjm-12.5 preflight 401 → upstream_auth`: configure mock-litellm to return 401; POST; assert single terminal `{type:"error", code:"upstream_auth", provider:"litellm"}` line.

    Per MEMORY note `feedback_cjm_steps_need_unit_tests`: every `tests/e2e-cjm/steps/*.steps.ts` MUST have sibling vitest unit coverage in `__tests__/<file>.steps.test.ts` with the HTTP boundary mocked. The unit test stubs `undiciFetch` and validates the step-binding's request-building / response-parsing logic (URL, method, headers, body, NDJSON line parser).
  </behavior>
  <action>
    PART A — Create `tests/e2e-cjm/features/agent-stream-error.feature`:

      ```
      # SPDX-License-Identifier: FSL-1.1-ALv2
      # 260528-0cm — @cjm-12.3..5 agent-stream type:"error" wire-shape (HIGH-agent-stream-empty-bubble closure).
      #
      # D-12: NO Cucumber `retry:` config anywhere — retry-on-flake is BANNED.

      Feature: Agent stream — type:"error" wire envelope on upstream failure

        @cjm-12.3
        Scenario: Preflight 4xx model_not_found emits single terminal type:"error" line
          Given a signed-in user
          And the mock-litellm is configured to return 404 model_not_found for model "missing-alias"
          When the user POSTs to /api/agent/stream with model "missing-alias" and prompt "say hi"
          Then the response Content-Type is "application/x-ndjson"
          And the response body is exactly one NDJSON line
          And the line is a valid JSON object with type "error"
          And the line has code "upstream_invalid_model"
          And the line has provider "litellm"
          And the line has error "Requested model is not available on this server. Choose a different model or contact your operator."
          And no NDJSON line has type "done"

        @cjm-12.4
        Scenario: Happy-path stream succeeds with text-delta + finish (regression guard)
          Given a signed-in user
          When the user POSTs to /api/agent/stream with prompt "say hi"
          Then the response Content-Type is "application/x-ndjson"
          And every response line is a valid JSON object with a "type" field
          And the stream contains at least one event of type "text-delta"
          And the stream ends with an event of type "finish"
          And no NDJSON line has type "error"

        @cjm-12.5
        Scenario: Preflight 401 emits single terminal type:"error" line with code upstream_auth
          Given a signed-in user
          And the mock-litellm is configured to return 401 unauthorized
          When the user POSTs to /api/agent/stream with prompt "say hi"
          Then the response Content-Type is "application/x-ndjson"
          And the response body is exactly one NDJSON line
          And the line is a valid JSON object with type "error"
          And the line has code "upstream_auth"
          And the line has provider "litellm"
      ```

    PART B — Create `tests/e2e-cjm/steps/agent-stream-error.steps.ts`. Reuse `postAgentStream` + `parseNdjson` + `localhostDispatcher` from `agent-stream.steps.ts` (import them) — do NOT duplicate. Add NEW step bindings:

      - `Given(/^the mock-litellm is configured to return 404 model_not_found for model "(.+)"$/, ...)` — write to the mock-litellm fixture API (the bundled mock service in `compose-overrides.yml` exposes a control endpoint per existing Phase 25 pattern; if not, configure via env-var override + container restart hook in the compose helper). Implementation note for executor: the existing `agent-stream.steps.ts` test stack uses a static mock SSE response — for failure injection, extend the mock-litellm container's config to support per-test-scenario response overrides via a tenant-scoped header (e.g., `X-Mock-LiteLLM-Response: 404_model_not_found`). If that mechanism doesn't exist yet, ADD it to the mock-litellm fixture in this task (small fixture change; tracked in commit body).
      - `Given(/^the mock-litellm is configured to return 401 unauthorized$/, ...)` — same mechanism.
      - `When(/^the user POSTs to \/api\/agent\/stream with model "(.+)" and prompt "(.+)"$/, ...)` — overload of the existing prompt-only step; passes model AND prompt in the JSON body.
      - `Then(/^the response body is exactly one NDJSON line$/, ...)` — assert parsed-lines length === 1.
      - `Then(/^the line is a valid JSON object with type "(.+)"$/, ...)` — assert lines[0].type === expected.
      - `Then(/^the line has code "(.+)"$/, ...)` — assert lines[0].code === expected.
      - `Then(/^the line has provider "(.+)"$/, ...)` — assert lines[0].provider === expected.
      - `Then(/^the line has error "(.+)"$/, ...)` — assert lines[0].error === expected (exact-match canonical literal).
      - `Then(/^no NDJSON line has type "(.+)"$/, ...)` — assert parsedTypes.every(t => t !== forbidden).

      All steps follow the existing file's `ScenarioState` per-scenario-tenant pattern. Use `recordLastResponse` for downstream-step correlation per existing convention.

    PART C — Create `tests/e2e-cjm/steps/__tests__/agent-stream-error.steps.test.ts` (vitest unit coverage per `feedback_cjm_steps_need_unit_tests`):

      - Stub `undici.fetch` (or wrap via `MockAgent` if the step uses the dispatcher pattern).
      - Test that `postAgentStreamError(apiBaseURL, cookie, model, prompt)` (or whatever the new step helper is named) builds a POST request to `${apiBaseURL}/api/agent/stream` with method=POST, content-type=application/json, body=JSON.stringify({model, prompt}), and (if cookie) cookie header.
      - Test that the NDJSON parser correctly returns 1 line for a single-line input and N lines for an N-line input.
      - Test that the assertion helpers (`assertLineHasCode`, `assertLineHasProvider`, etc.) reject mismatched values with descriptive error messages.
      - Test that the mock-litellm-configuration step helper makes the expected HTTP call to the mock service's control endpoint.

      Minimum 6 unit test cases (3 for request building, 3 for response parsing/assertion). Use vitest pattern `import { describe, it, expect, vi } from "vitest"`.

    PART D — Verify the test runs via `make e2e-cjm` (which is the project's CJM e2e target — wraps `E2E=1` + compose boot + Cucumber runner). If the executor environment cannot boot docker compose locally, use the hermetic mock-LiteLLM compose profile (already wired into `compose-overrides.yml` per Phase 25 precedent). STOP if the e2e command fails — do NOT proceed to Task 7 until GREEN.

    Commit: `test(260528-0cm): E2E CJM — agent stream type:"error" wire envelope (3 scenarios + step-binding unit coverage)`
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && pnpm --filter @openwhispr/api test agent-stream-error.steps.test.ts 2>&1 | tail -20 && E2E=1 make e2e-cjm 2>&1 | tail -30</automated>
  </verify>
  <done>
    Three new artifacts present at the paths above. Vitest unit coverage on the step bindings exits 0 (≥6 unit cases). `E2E=1 make e2e-cjm` exits 0 with all 3 new CJM scenarios passing — @cjm-12.3 + @cjm-12.4 + @cjm-12.5. Mock-litellm fixture supports per-scenario response overrides (404, 401, default-success). Coverage waivers BANNED per `feedback_cjm_steps_need_unit_tests` — every step binding has a unit test.
  </done>
</task>

<task type="auto">
  <name>Task 7: Operator-facing docs — agent stream error contract section in docs/operations.md</name>
  <files>docs/operations.md</files>
  <behavior>
    New section titled `## Agent stream error contract` appended at the end of the existing `docs/operations.md` (or inserted under the existing top-level "Operations" structure if a logical anchor exists — DO NOT renumber existing sections). Contains:

      1. NDJSON wire shape per chunk type — table with 4 rows (content / tool_call / done / error) listing `type` value, payload fields, and "is this terminal?" column. The `error` row is the new addition; its payload fields are `error: string`, `code: AgentErrorCode`, `provider: "litellm" | "unknown"`; terminal: YES (no `done` follows).

      2. `AgentErrorCode` taxonomy — table with 6 rows (one per code) listing: code value, trigger condition (e.g., "LiteLLM upstream 401/403 or kind:'auth'"), operator-facing meaning (1 sentence), suggested operator action (1 sentence — e.g., for `upstream_auth`: "Rotate the OPENROUTER_API_KEY / GROQ_API_KEY / OPENAI_API_KEY corresponding to the failing alias; redeploy the LiteLLM container").

      3. Log event schema — JSON example of the `agent.stream.upstream_failure` pino log line with every binding field labeled (event, upstream_status, upstream_body_truncated, code, provider, kind, model, litellm_call_id, retry_after_ms, request_id, msg). For each field: 1-sentence description of meaning + operator query pattern (e.g., for `upstream_status:401` → "LogQL query: `{app=\"openwhispr-api\"} | json | event=\"agent.stream.upstream_failure\" | upstream_status=401`").

      4. Operator alerts to consider — bulleted list of suggested Loki/Grafana alert recipes (NOT yaml — narrative): (a) sustained rate of `code:"upstream_auth"` → operator must rotate API keys; (b) `code:"upstream_invalid_model"` spike → desktop client / server alias mismatch; (c) `code:"upstream_quota_exceeded"` → top up provider billing; (d) `code:"upstream_rate_limit"` sustained → bump LiteLLM concurrency or upstream tier; (e) `code:"upstream_timeout"` + network errors → investigate the LiteLLM↔upstream-provider path. Each item has a "noise floor" line indicating expected baseline rate.

      5. i18n future — single paragraph noting canonical messages are English-only in v1; runtime i18n via i18next is a follow-up phase; the internal CANONICAL_ERROR_MESSAGES const at `apps/api/src/lib/agent-upstream-error-classify.ts` is the canonical key→English-text source the i18n catalog will adopt.

      6. Cross-references — link to `apps/api/src/lib/agent-upstream-error-classify.ts` (source of truth for codes + messages), link to `apps/api/src/routes/agent/stream.ts` (emitter), link to peer report `.planning/debug/agent-stream-upstream-error-2026-05-28.md`, link to `tests/e2e-cjm/features/agent-stream-error.feature` (E2E wire contract).
  </behavior>
  <action>
    Read `docs/operations.md` to determine the existing section structure. Choose insertion point: a new top-level section appended at end is safest (no existing-anchor renumbering risk).

    Section header: `## Agent stream error contract`.

    Use markdown tables for the wire-shape and taxonomy tables (3-4 columns each). Keep prose tight — operators read this; verbosity costs them debugging time.

    Constraint: every code/literal in the doc must match the source-of-truth strings in `apps/api/src/lib/agent-upstream-error-classify.ts` exactly. If the executor renames a code class during implementation (they shouldn't — D1-D4 lock the names), update both atomically.

    Belt-and-braces verification: after writing, `grep -F 'agent.stream.upstream_failure' docs/operations.md` returns ≥1; `grep -F 'AgentErrorCode' docs/operations.md` returns ≥1; `grep -cF 'upstream_auth' docs/operations.md` returns ≥2 (table cell + alerts section).

    Commit: `docs(260528-0cm): document agent stream type:"error" wire contract + AgentErrorCode taxonomy + log event schema`
  </action>
  <verify>
    <automated>grep -c 'agent.stream.upstream_failure' /Users/nick/openwhispr-server/docs/operations.md && grep -cE 'upstream_(auth|rate_limit|quota_exceeded|invalid_model|timeout|unknown)' /Users/nick/openwhispr-server/docs/operations.md</automated>
  </verify>
  <done>
    `docs/operations.md` contains the new "Agent stream error contract" section. The grep verifies finds `agent.stream.upstream_failure` ≥1 time AND all 6 code names referenced ≥1 time each (total ≥6). The section table + taxonomy match the helper module's source code exactly (executor cross-reads both during write).
  </done>
</task>

<task type="auto">
  <name>Task 8: Chart bump + image tag bump — 1.0.16 / appVersion 1.0.13 / image.tag 1.0.13</name>
  <files>charts/openwhispr-server/Chart.yaml, charts/openwhispr-server/values.yaml</files>
  <behavior>
    Chart.yaml: `version: 1.0.15 → 1.0.16`, `appVersion: "1.0.12" → "1.0.13"`. values.yaml: `image.tag: "1.0.12" → "1.0.13"` with a lineage comment line referencing the wire-contract fix.

    No other chart values touched. No template changes — the wire fix is in the api container image, not in chart manifests.

    Per MEMORY.md note `feedback_chart_bump_extraenv_strip`: scan downstream `values.yaml` overrides in any reachable operator-facing fixtures (`.planning/`, `compose/`, `tools/`) for `extraEnv:` shapes that might collide with chart-native env projection — none expected for this release (the chart didn't add native env projections in 1.0.16; the bump is application-level), but verify via `grep -rn 'extraEnv:' charts/ compose/ tools/ 2>/dev/null | head` during executor scan. If any downstream overrides target env keys touched by this release (none expected — wire contract is server-internal), document them in the release notes.
  </behavior>
  <action>
    1. Edit `charts/openwhispr-server/Chart.yaml`:
       - Change `version: 1.0.15` → `version: 1.0.16`.
       - Change `appVersion: "1.0.12"` → `appVersion: "1.0.13"`.
       - Leave maintainers / sources / keywords / annotations untouched.

    2. Edit `charts/openwhispr-server/values.yaml`:
       - Change `tag: "1.0.12"` (currently L179) → `tag: "1.0.13"`.
       - Add a comment line ABOVE the `tag:` line: `# 1.0.13 — agent stream type:"error" wire contract fix (260528-0cm); previously 1.0.12 emitted opaque done.upstream_error chunks that the desktop client could not render. See docs/operations.md "Agent stream error contract".`

    3. Verify chart lints clean: `helm lint charts/openwhispr-server`. Verify chart packages: `helm package charts/openwhispr-server --destination /tmp/`. Both exit 0.

    4. Belt-and-braces: `grep -rn 'extraEnv:' charts/ compose/ tools/ 2>/dev/null | head` — if any matches reference api env keys, surface in the release-notes commit body.

    Commit: `chore(server-chart): bump to 1.0.16 (agent stream wire-contract fix; appVersion → 1.0.13)`

    The commit message body MUST link to `.planning/quick/260528-0cm-agent-stream-error-contract/PLAN.md` and the peer report.
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && grep -E '^version:|^appVersion:' charts/openwhispr-server/Chart.yaml && grep -E '^\s+tag:' charts/openwhispr-server/values.yaml && helm lint charts/openwhispr-server 2>&1 | tail -5</automated>
  </verify>
  <done>
    Chart.yaml shows `version: 1.0.16` AND `appVersion: "1.0.13"`. values.yaml shows `tag: "1.0.13"` with the lineage comment. `helm lint charts/openwhispr-server` exits 0. The lineage comment includes the 260528-0cm reference.
  </done>
</task>

<task type="auto">
  <name>Task 9: Verification pass — full lint + typecheck + unit + integration + E2E CJM + LOCKER + helm lint + evidence projects self-test</name>
  <files></files>
  <behavior>
    Independent verification per project Hard Rule 3 (never report done based on sub-agent claims). The executor agent MUST run each command below, read its exit code + summary line with own eyes, and only proceed if ALL gates green. NO `git commit --no-verify` / `git push --no-verify` per project Hard Rule 4.

    Commands run sequentially because later gates depend on earlier (typecheck before test; test before evidence; e2e LAST among test-tier gates because slowest).
  </behavior>
  <action>
    1. **Lint** (LOCKER gates fire here):
       `pnpm --filter @openwhispr/api lint 2>&1 | tail -30`
       Expected: 0 LOCKER-01/02/03/04/05/06 violations on diff.

    2. **Typecheck**:
       `pnpm --filter @openwhispr/api typecheck 2>&1 | tail -10`
       Expected: 0 errors.

    3. **Unit + integration tests + coverage**:
       `pnpm --filter @openwhispr/api test --coverage 2>&1 | tail -40`
       Expected: all green; coverage on `agent-upstream-error-classify.ts` ≥ 90/90/90/90; coverage on the new lines in `stream.ts` 100%.

    4. **Existing test suite — no regressions outside the modified test files**:
       `pnpm --filter @openwhispr/api test 2>&1 | tail -10`
       Expected: 0 failures; the only test files that should have CHANGED behavior (vs. main HEAD~1) are `stream.test.ts` (Tests 9/10/17/18 rewritten), `agent-upstream-error-classify.test.ts` (new), `stream-error-mapping.test.ts` (new), `agent-stream-error-contract.test.ts` (new). Any other failure indicates an unintended regression — STOP and investigate.

    5. **CJM step-binding vitest unit coverage** (Task 6.5 PART C):
       `pnpm test 'tests/e2e-cjm/steps/__tests__/agent-stream-error.steps.test.ts' 2>&1 | tail -20`
       Expected: ≥6 unit cases green. No coverage waivers per `feedback_cjm_steps_need_unit_tests`.

    6. **E2E CJM** (Task 6.5 — the constitutional E2E gate per CLAUDE.md DISCIPLINE rule 3):
       `E2E=1 make e2e-cjm 2>&1 | tail -40`
       Expected: all CJM scenarios green including the 3 NEW ones (@cjm-12.3, @cjm-12.4, @cjm-12.5) AND no regression in the existing @cjm-12.1 / @cjm-12.2 scenarios. The hermetic mock-LiteLLM compose profile provides the upstream — no external services needed. Per MEMORY note `feedback_check_loki_after_tests`: after the e2e run, FIRST check `docker compose -p e2e-cjm logs api | tail -50` for any unexpected errors before declaring green.

    7. **Helm chart lint + package**:
       `helm lint charts/openwhispr-server 2>&1 | tail -5 && helm package charts/openwhispr-server --destination /tmp/ 2>&1 | tail -3`
       Expected: 0 errors; package writes `openwhispr-server-1.0.16.tgz`.

    8. **Pre-existing v1.0.12 evidence gate**:
       `pnpm test:evidence:projects-self-test 2>&1 | tail -30`
       Expected: the project-self-test gate accepts this commit's evidence. STOP if the gate fails. (Note: per PLAN-CHECK WARNING-2 — Task 10 also re-runs this AFTER commit to bind evidence to the landed SHA.)

    9. **Repo-wide grep for residual D4 literals**:
       `git grep -nE '"upstream_error"|"stream_error"' apps/api/src/ packages/*/src/ 2>&1 || echo "OK: no residual literals in production source"`
       Expected: NO matches. Test files + `.planning/` + dist/build artifacts MAY match (RESEARCH.md D4 ledger documents 1 load-test forensic comment + dist mirror — neither is production source).

    10. **Gitleaks** (project Hard Rule 4 — pre-commit hook runs anyway, but verify clean first):
        `git diff --cached | gitleaks detect --pipe --no-banner 2>&1 | tail -5`
        Expected: 0 leaks. The canonical messages contain NO credential shapes by construction (per LOCKER-05 + D3 design); test fixtures embedding `sk-or-v1-…` / `Bearer eyJ…` literals MUST be allowlisted in `.gitleaks.toml` per MEMORY.md note `feedback_no_traefik_antipatterns` (no `--no-verify` bypass).

        Specifically: the Task 1 + Task 4 test fixtures use the literal substrings `sk-or-v1-abcdef1234567890abcdef1234567890` and `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.deadbeef`. These are test placeholders, not real credentials. Add to `.gitleaks.toml` allowlist with a `description = "test fixtures for redaction assertions; 260528-0cm"` line, AND add a regression assertion in `tools/lint-gitleaks-config.test.ts` per project Hard Rule 4. The allowlist additions + regression test land in the SAME atomic commit as the test files.

    11. **Type-narrowing sanity check**:
        Verify the union widening in Task 3 didn't break any switch-on-`chunk.type` consumer:
        `git grep -nE 'switch.*chunk\.type|case "content"|case "done"|case "tool_call"' apps/ packages/ 2>&1 | tail -10`
        Read each match and confirm: any exhaustive-switch on `StreamChunk["type"]` either (a) already handles the new `"error"` case OR (b) has a default arm that ignores unknown types. If any consumer becomes non-exhaustive, ADD a `case "error":` arm that swallows the chunk (the consumer is downstream of the route catch — `"error"` chunks should never reach in-process consumers; this is defensive).

    If ALL 11 gates green, proceed to Task 10. If ANY gate fails, fix the underlying issue (per project no-workarounds rule) and re-run from step 1.
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && pnpm --filter @openwhispr/api lint 2>&1 | tail -5 && pnpm --filter @openwhispr/api typecheck 2>&1 | tail -5 && pnpm --filter @openwhispr/api test --coverage 2>&1 | tail -10 && pnpm test 'tests/e2e-cjm/steps/__tests__/agent-stream-error.steps.test.ts' 2>&1 | tail -5 && E2E=1 make e2e-cjm 2>&1 | tail -10 && helm lint charts/openwhispr-server 2>&1 | tail -3 && (git grep -nE '"upstream_error"|"stream_error"' apps/api/src/ packages/*/src/ 2>&1 || echo "OK")</automated>
  </verify>
  <done>
    All 11 gates green. Coverage report shows ≥90% on the new helper file (4 axes) and 100% on the modified `stream.ts` catch paths. No LOCKER violations. No D4 literal residue in production source. Gitleaks pipe-mode scan returns clean. Helm chart lints + packages successfully as `openwhispr-server-1.0.16.tgz`. Type-narrowing sanity check confirms no downstream consumer of `StreamChunk` regressed. E2E CJM gate green including the 3 new scenarios — satisfies CLAUDE.md DISCIPLINE rule 3.
  </done>
</task>

<task type="auto">
  <name>Task 10: Atomic release — tag v1.0.13 (image) + openwhispr-server-1.0.16 (chart) on the same SHA + post-commit evidence rebind</name>
  <files></files>
  <behavior>
    The wire-contract fix + chart bump ship as ONE atomic commit + TWO tags on the same SHA. No half-shipped releases.

    Per MEMORY.md note `feedback_no_traefik_antipatterns` / `feedback_chart_bump_extraenv_strip`: the chart bump must be paired with image build + image tag — no chart bump that points at a not-yet-published image tag.

    Per project Hard Rule 3 (verify before claim): orchestrator agent independently verifies (a) commit SHA on HEAD via `git log --oneline -1`, (b) both tags exist via `git tag --list 'v1.0.13' 'openwhispr-server-1.0.16'`, (c) clean working tree via `git status --short`.

    Per project Hard Rule 4: pre-commit + pre-push hooks run normally. NO `--no-verify` flags.

    Rev 2 (per PLAN-CHECK WARNING-2): step 4.5 re-runs the evidence gate AFTER `git tag` to bind the evidence fragment to the actual landed SHA, not the pre-commit working-tree state.
  </behavior>
  <action>
    1. **Build the api docker image at v1.0.13** (the image tag the chart's `values.yaml` now points at). Use the project's standard build command — typically `make build-api` or `docker build -t ghcr.io/yambr/openwhispr-api:1.0.13 -f apps/api/Dockerfile .`. The exact command lives in the project Makefile / CI workflow; the executor reads + invokes it. Push to the registry IF AND ONLY IF the user requests publication; otherwise the local image build is sufficient to prove the chart can resolve its image reference.

    2. **Stage + commit the wire fix changes** (all 13 files from frontmatter `files_modified` — including the 3 new tests/e2e-cjm artifacts — plus the `.gitleaks.toml` allowlist additions + `tools/lint-gitleaks-config.test.ts` regression-assertion lines from Task 9 step 10):
       Use `git add <file>` per file (NOT `git add -A` / `git add .`), then `git commit -m "$(cat <<'EOF' ... EOF)"` with the heredoc message body shown below.

       Commit message body:
       ```
       feat(api): agent stream type:"error" wire contract (260528-0cm; v1.0.13 / chart 1.0.16)

       Closes HIGH bug from peer 9zn786o0: POST /api/agent/stream collapsed every
       4xx/5xx + every connect/abort error into an opaque {type:"done",
       finishReason:"upstream_error"} chunk the desktop client could not render,
       producing empty assistant bubbles for every signed-up free-tier user.

       Wire change (CONTEXT.md D1-D4 locked):
       - New helper apps/api/src/lib/agent-upstream-error-classify.ts produces
         ClassifiedAgentError with 6-member AgentErrorCode union + canonical
         English messages + secret-redacted upstreamBody.
       - StreamChunk union gains {type:"error", error, code, provider} variant.
       - stream.ts preflight + drain catches BOTH emit a single terminal
         type:"error" chunk; never a done chunk after. req.log.warn → req.log.error
         with structured event "agent.stream.upstream_failure".
       - finishReason:"upstream_error" / "stream_error" literals removed entirely
         (D4: no deprecation cycle — repo grep shows zero production consumers).

       Tests:
       - 25+ helper cases (LitellmUpstreamError 401/402/403/404/429/4xx/5xx +
         AbortError + ECONNREFUSED/ECONNRESET/ETIMEDOUT/ENOTFOUND/EAI_AGAIN +
         UND_ERR_* + catch-all + secret-shape redaction).
       - stream.test.ts Tests 9/10/17/18 rewritten to assert type:"error".
       - stream-error-mapping.test.ts — route-level wire + structured log +
         secret-redaction assertions (13 mapping cases + log-level flip).
       - agent-stream-error-contract.test.ts — buildApp + MockAgent integration
         contract across 6 wire failure modes including ECONNREFUSED preflight
         and mid-stream socket close.
       - tests/e2e-cjm/features/agent-stream-error.feature — 3 CJM scenarios
         (@cjm-12.3 preflight 4xx, @cjm-12.4 happy-path regression, @cjm-12.5
         preflight 401) under E2E=1 make e2e-cjm (CLAUDE.md DISCIPLINE rule 3
         "E2E mandatory" closure for this wire surface change).
       - Step-binding vitest unit coverage per feedback_cjm_steps_need_unit_tests.

       Chart bump: 1.0.15 → 1.0.16, appVersion "1.0.12" → "1.0.13",
       image.tag → 1.0.13.

       Docs: docs/operations.md gains "Agent stream error contract" section with
       wire-shape table, AgentErrorCode taxonomy, log event schema, and
       suggested Loki/Grafana alert recipes.

       Naming alignment (PLAN.md rev 2 / B3): helper exports use shorter forms
       classifyUpstreamError / AgentErrorCode / ClassifiedAgentError vs. the
       longer names drafted in CONTEXT.md (classifyAgentUpstreamError /
       AgentUpstreamErrorCode / AgentUpstreamErrorEnvelope). Rationale recorded
       in PLAN.md `naming_alignment` frontmatter block.

       Web-client e2e deferral (PLAN.md rev 2 / B2): apps/web has NO agent chat
       UI in v1 (surface = auth + admin only); web e2e for /api/agent/stream
       deferred to the phase that lands web agent chat UI. Tracked in
       .planning/deferred-items.md.

       LOCKER posture: 01/02/03/04/05/06 clean on diff. Coverage ≥90/90/90/90
       on the new helper; 100% on modified route catch paths.

       Refs:
         .planning/quick/260528-0cm-agent-stream-error-contract/PLAN.md
         .planning/quick/260528-0cm-agent-stream-error-contract/CONTEXT.md
         .planning/quick/260528-0cm-agent-stream-error-contract/RESEARCH.md
         .planning/quick/260528-0cm-agent-stream-error-contract/PLAN-CHECK.md
         .planning/debug/agent-stream-upstream-error-2026-05-28.md
       ```

    3. **Tag the resulting SHA** with both release identifiers:
       ```
       SHA=$(git rev-parse HEAD)
       git tag -a v1.0.13 "$SHA" -m "Agent stream type:'error' wire contract fix (260528-0cm)"
       git tag -a openwhispr-server-1.0.16 "$SHA" -m "Chart bump for v1.0.13 — agent stream wire contract"
       ```

    4. **Verify tag co-location on the same SHA**:
       ```
       git rev-list -n 1 v1.0.13
       git rev-list -n 1 openwhispr-server-1.0.16
       # Both MUST output the same SHA.
       ```

    4.5. **Post-commit evidence rebind** (rev 2 / PLAN-CHECK WARNING-2):
       ```
       pnpm test:evidence:projects-self-test 2>&1 | tail -30
       ```
       Re-run AFTER the commit + tag land so the evidence fragment binds to the actual landed SHA (not the pre-commit working tree). Expected: gate accepts the commit's evidence + the fragment now references `$SHA`. STOP if it fails — investigate before any push.

    5. **Do NOT push** unless user explicitly requests. Per project rules, the user controls remote-push timing (especially given the per-user MEMORY note `project_r19_r23_auth_journey` — work lands on local main and is pushed only after manual verification).

    6. **Orchestrator independent verification** (Hard Rule 3):
       ```
       git log --oneline -1                                # SHA is on HEAD
       git tag --list 'v1.0.13' 'openwhispr-server-1.0.16' # both tags present
       git status --short                                   # working tree clean
       grep -F 'agent.stream.upstream_failure' apps/api/src/routes/agent/stream.ts  # fingerprint of the route edit
       grep -F 'classifyUpstreamError' apps/api/src/routes/agent/stream.ts          # helper imported
       grep -F 'type: "error"' apps/api/src/lib/sse-parser.ts                       # union widened
       grep -F '@cjm-12.3' tests/e2e-cjm/features/agent-stream-error.feature        # E2E feature present
       ```
       Every command MUST produce expected output. The orchestrator parses results before declaring done.
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && git log --oneline -1 && git tag --list 'v1.0.13' 'openwhispr-server-1.0.16' && git status --short && [ "$(git rev-list -n 1 v1.0.13)" = "$(git rev-list -n 1 openwhispr-server-1.0.16)" ] && echo "OK: tags co-located on same SHA" || echo "FAIL: tag mismatch"</automated>
  </verify>
  <done>
    Single commit on HEAD; both tags `v1.0.13` and `openwhispr-server-1.0.16` resolve to the SAME SHA; working tree clean; verification greps all produce expected output. Image artifact `openwhispr-api:1.0.13` exists locally (push gated on user request). Post-commit evidence gate exits 0 with the fragment bound to the landed SHA. The release is reproducible from this SHA alone — no orphaned edits, no missing artifacts, no `--no-verify` bypasses in the reflog.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → /api/agent/stream | Untrusted bearer + body; Zod-validated pre-hijack; auth-required onRequest hook |
| /api/agent/stream → LiteLLM proxy | Server-controlled; upstream may return adversarial 4xx/5xx body content that flows into log + (now) classifier output |
| LiteLLM → log sink (Loki) | Server-to-server; the new `event:"agent.stream.upstream_failure"` line MAY carry redacted upstream body fragments |
| /api/agent/stream catch → wire (raw.write) | Server-to-client; the new `type:"error"` chunk's `error` field is read directly by the renderer UI; must NEVER carry credential shapes |
| mock-litellm (e2e-cjm compose profile) → /api/agent/stream | Test-only boundary; control-plane endpoint for per-scenario response override MUST NOT be reachable in production compose profile |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260528-0cm-01 | Information Disclosure | classifyUpstreamError → wire `chunk.error` | mitigate | All `chunk.error` values are read from the internal CANONICAL_ERROR_MESSAGES frozen const (English-only literals). Test asserts no `sk-…`/`Bearer ey…`/`AKIA…`/`AIza…` regex matches in wire bytes. Raw `bodyText` NEVER flows to `chunk.error` (D3 lock). |
| T-260528-0cm-02 | Information Disclosure | classifyUpstreamError → `req.log.error.upstream_body_truncated` | mitigate | All body extractions go through `redactSecretShapes(...).slice(0, 500)` (LOCKER-05 + belt-and-braces). Test asserts secret-shape redaction at the log boundary. |
| T-260528-0cm-03 | Information Disclosure | wire `chunk` JSON shape | mitigate | `chunk` schema is exactly `{type, error, code, provider}` — no `upstream_body_truncated` / `upstream_status` / `kind` / `litellm_call_id` field exists on the wire. Test asserts `Object.keys(chunk)` matches exactly that 4-key set. |
| T-260528-0cm-04 | Denial of Service | mid-stream drain catch | mitigate | The `try { raw.write(...) } catch {}` defensive pattern is preserved; socket-closed mid-write is swallowed (no thrown exception escapes the route). The `finally { raw.end() }` block at L338-L347 ensures the connection always terminates — no half-open streams that block downstream consumers. |
| T-260528-0cm-05 | Tampering | StreamChunk type widening | mitigate | The new variant is type-only (`{type:"error", ...}`); the `translateChunk` generator (sse-parser) never yields it, so adversarial upstream SSE frames cannot impersonate a server-emitted error chunk. Only the route catch blocks construct + write the variant. |
| T-260528-0cm-06 | Repudiation | structured log `agent.stream.upstream_failure` | mitigate | Every upstream failure produces exactly one `req.log.error` line with `request_id: req.id`; downstream Loki/Grafana correlation by `request_id` is unambiguous. Test asserts the binding shape per case. |
| T-260528-0cm-07 | Spoofing | provider field hardcoded | accept | `provider:"litellm"` is a server-self-attestation, not a verifiable claim. The wire field is informational, not security-load-bearing. Corporate operators correlate to real upstream provider via `litellm_call_id` in their own observability stack — that field stays in logs, not on the wire. |
| T-260528-0cm-08 | Elevation of Privilege | n/a — pure error-path edit | accept | The route's auth gating (L148 `req.user.id` check pre-hijack) is unchanged. The new helper module is pure (no I/O, no auth surface). |
| T-260528-0cm-09 | Tampering | mock-litellm control-plane endpoint (E2E fixture) | mitigate | Control-plane override endpoint is gated by `MOCK_LITELLM=1` env in the e2e-cjm compose profile ONLY; production compose profile does NOT expose it (verified via grep on `compose/litellm/*.yaml` for the env var — production profile bundles real LiteLLM Proxy, not the mock). The fixture's per-scenario override headers carry no auth — by design, since the mock is reachable only from inside the e2e compose network. |
</threat_model>

<verification>
## Phase-level verification

1. **Wire contract regression — manual reproducer** (post-Task 5, pre-commit): Boot the local docker compose stack with `LITELLM_BASE_URL` pointing at the bundled proxy on a `litellm_config.yaml` that has NO `openai/gpt-oss-120b` alias (the bundled default — no change needed). `curl -N -H "Authorization: Bearer <test-bearer>" -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"hi"}],"model":"openai/gpt-oss-120b"}' https://localhost/api/agent/stream`. Expected: HTTP 200, Content-Type `application/x-ndjson`, body is EXACTLY one line `{"type":"error","error":"Requested model is not available on this server. Choose a different model or contact your operator.","code":"upstream_invalid_model","provider":"litellm"}` followed by `\n`, socket closes. Document curl output in the commit body as live evidence per project Hard Rule 3.

2. **Loki query for the structured log line**: After the manual reproducer fires, query Loki: `{app="openwhispr-api"} | json | event="agent.stream.upstream_failure" | code="upstream_invalid_model"`. Expected: exactly one record with bindings {`upstream_status: 400`, `code: "upstream_invalid_model"`, `provider: "litellm"`, `model: "openai/gpt-oss-120b"`, `request_id: <req.id>`, `upstream_body_truncated: "<redacted truncated string>"`}. Per MEMORY note `feedback_check_loki_after_tests`, this Loki check is FIRST after any e2e/compose run.

3. **CI-gated wire contract regression** (rev 2 — replaces ad-hoc visual check per PLAN-CHECK BLOCKER-2 fix): `E2E=1 make e2e-cjm` exercises @cjm-12.3 / @cjm-12.4 / @cjm-12.5 in CI — these assertions consume the NDJSON wire bytes via the same `parseNdjson` helper the existing `agent-stream.steps.ts` uses (sibling of the desktop / web client's NDJSON parser shape). This replaces the previous "one-time visual verification" with a deterministic CI gate that asserts the wire contract on every PR, closing the renderer-coupling regression risk identified in PLAN-CHECK BLOCKER-2.

4. **No regression in successful streaming**: Repeat curl with `model: "openwhispr-default"` (the bundled alias). Expected: HTTP 200, Content-Type `application/x-ndjson`, body contains N>0 `{"type":"content", ...}` lines + 1 terminal `{"type":"done", ...}` line. NO `{"type":"error", ...}` line on the happy path. ALSO covered by @cjm-12.4 in CI.

5. **Coverage report fingerprint**: `pnpm --filter @openwhispr/api test --coverage --reporter=lcov` then read the lines/branches/functions numbers for `agent-upstream-error-classify.ts` and `stream.ts` from `coverage/lcov.info`. Helper file ≥ 90/90/90/90; route catch paths 100/100/100/100 on diff per project DISCIPLINE rule 2.

6. **LOCKER posture proof** (all 6 LOCKER rules):
   - LOCKER-01: `grep -n 'NODE_ENV' apps/api/src/lib/agent-upstream-error-classify.ts apps/api/src/routes/agent/stream.ts apps/api/src/lib/sse-parser.ts` returns ZERO matches in production code (only the `bootstrap.ts`/`config/*.ts` carve-outs are allowed; this phase touches none of those).
   - LOCKER-02: `grep -nE 'as any|as unknown as|@ts-(ignore|nocheck|expect-error)' apps/api/src/lib/agent-upstream-error-classify.ts apps/api/src/routes/agent/stream.ts apps/api/src/lib/sse-parser.ts` returns ZERO matches.
   - LOCKER-03: no new `localhost`/`127.0.0.1`/`:3000`/`:4000`/`:8080`/UUID literals/credential-shape literals introduced in production sources (test fixtures allowlisted per Task 9 step 10).
   - LOCKER-04: every new export has ≥1 non-test importer (verified in Task 9 step 1; `CANONICAL_ERROR_MESSAGES` not exported by design).
   - LOCKER-05: every `bodyText`/`err.message` extraction in the helper goes through `redactSecretShapes(...).slice(0, 500)`; assert via `grep -nE 'redactSecretShapes.*\.slice\(0, 500\)' apps/api/src/lib/agent-upstream-error-classify.ts` ≥ 2 matches.
   - LOCKER-06: no `child_process.spawn('bash', ['-c', ...])` / `execSync` introduced (this phase doesn't touch shell-out paths).

7. **CLAUDE.md DISCIPLINE rule 3 (E2E mandatory) closure proof** (rev 2): `ls tests/e2e-cjm/features/agent-stream-error.feature && grep -c '@cjm-12.[345]' tests/e2e-cjm/features/agent-stream-error.feature` returns the file path + 3 (one for each new scenario). `E2E=1 make e2e-cjm` exits 0 in Task 9 step 6.
</verification>

<success_criteria>
- [ ] `apps/api/src/lib/agent-upstream-error-classify.ts` exists; exports `classifyUpstreamError`, `AgentErrorCode`, `ClassifiedAgentError` (CANONICAL_ERROR_MESSAGES is internal, not exported — LOCKER-04 clean by construction).
- [ ] `apps/api/src/lib/sse-parser.ts` `StreamChunk` union widened with `type:"error"` variant.
- [ ] `apps/api/src/routes/agent/stream.ts` preflight + drain catches BOTH call `classifyUpstreamError` + emit single terminal `type:"error"` NDJSON line + emit structured `req.log.error`.
- [ ] `apps/api/src/routes/agent/stream.ts` `endWithFinish(raw, "upstream_error")` call deleted; synthetic `finishReason:"stream_error"` chunk deleted; `req.log.warn` on upstream/drain failure flipped to `req.log.error`.
- [ ] `git grep '"upstream_error"\|"stream_error"' apps/api/src/ packages/*/src/` returns ZERO matches.
- [ ] All test files exist and pass: `agent-upstream-error-classify.test.ts` (25+ cases), `stream.test.ts` (Tests 9/10/17/18 rewritten), `stream-error-mapping.test.ts` (5 describe blocks), `agent-stream-error-contract.test.ts` (6 contract cases).
- [ ] `tests/e2e-cjm/features/agent-stream-error.feature` exists with 3 scenarios (@cjm-12.3 / @cjm-12.4 / @cjm-12.5); step bindings + vitest unit coverage in place; `E2E=1 make e2e-cjm` exits 0 — CLAUDE.md DISCIPLINE rule 3 satisfied.
- [ ] `pnpm --filter @openwhispr/api test --coverage` reports ≥90% lines/branches/functions/statements on the new helper file; 100% on modified `stream.ts` catch paths.
- [ ] `pnpm --filter @openwhispr/api typecheck` exits 0.
- [ ] `pnpm --filter @openwhispr/api lint` exits 0 (all 6 LOCKERS clean on diff).
- [ ] `helm lint charts/openwhispr-server` exits 0; chart packages as `openwhispr-server-1.0.16.tgz`.
- [ ] `Chart.yaml` shows `version: 1.0.16` + `appVersion: "1.0.13"`; `values.yaml` shows `tag: "1.0.13"` with lineage comment.
- [ ] `docs/operations.md` contains new "Agent stream error contract" section with wire-shape table + AgentErrorCode taxonomy + log event schema + alert recipes.
- [ ] Single atomic git commit on HEAD; two tags `v1.0.13` and `openwhispr-server-1.0.16` co-located on the same SHA.
- [ ] Post-commit evidence gate (`pnpm test:evidence:projects-self-test`) exits 0 with the fragment bound to the landed SHA.
- [ ] Live curl-based manual reproducer per `<verification>` step 1 produces the expected single-line NDJSON response.
- [ ] Loki query per `<verification>` step 2 returns the structured log line with full binding shape.
- [ ] No `git commit --no-verify` / `git push --no-verify` flags used (gitleaks + lefthook hooks ran clean).
- [ ] PLAN.md `naming_alignment` frontmatter block records the CONTEXT.md → PLAN.md export rename (B3 closure).
- [ ] Web-client e2e deferral logged in `.planning/deferred-items.md` with rationale "apps/web v1 has no agent chat UI — surface is auth + admin only" (B2 closure).
</success_criteria>

<output>
After completion, create `.planning/quick/260528-0cm-agent-stream-error-contract/SUMMARY.md` recording:
- Commit SHA + both tag identifiers (`v1.0.13`, `openwhispr-server-1.0.16`).
- Live curl reproducer output (both failure-mode and happy-path) per `<verification>` steps 1 + 4.
- Loki structured-log evidence per `<verification>` step 2.
- `E2E=1 make e2e-cjm` final-line output proving @cjm-12.3 / @cjm-12.4 / @cjm-12.5 green (rev 2).
- Coverage numbers for `agent-upstream-error-classify.ts` (lines/branches/functions/statements).
- Files touched (13 from frontmatter + `.gitleaks.toml` allowlist + `tools/lint-gitleaks-config.test.ts` regression) + LOC delta (≈+1300 lines net, ≈-75 deleted — most LOC are tests including the new e2e fixtures).
- Deferrals carried forward: (a) provisioning of Groq chat aliases (`openai/gpt-oss-120b`, `qwen/qwen3-32b`, `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `openai/gpt-oss-20b`) → v1.0.14; (b) i18n of canonical messages → future i18n phase; (c) server-side retries on upstream rate-limit → client-policy decision; (d) generated SDK regen for client-side type sync → out of scope per CONTEXT.md (peer says immutable upstream); (e) web-client e2e for /api/agent/stream → revisit when web agent chat UI lands (rev 2).
- Operator runbook reference: `docs/operations.md` "Agent stream error contract" section is now the source-of-truth for alert thresholds + code-class meanings.
</output>

---

## Files Modified (table — rev 2)

| Path | Nature | LOC est |
|---|---|---|
| `apps/api/src/lib/agent-upstream-error-classify.ts` | NEW (helper) | ~120 |
| `apps/api/src/lib/sse-parser.ts` | MODIFY (union widening + 1-line type-only import + 1-line comment) | ~+10 |
| `apps/api/src/routes/agent/stream.ts` | MODIFY (hoist resolvedModel + new closure + 2 catch rewrites + import + comment) | ~+50 / -30 |
| `apps/api/tests/unit/lib/agent-upstream-error-classify.test.ts` | NEW (25+ cases) | ~280 |
| `apps/api/tests/unit/routes/agent/stream.test.ts` | MODIFY (rewrite Tests 9, 10, 17, 18) | ~+60 / -40 |
| `apps/api/tests/unit/routes/agent/__tests__/stream-error-mapping.test.ts` | NEW (5 describes, 13+ wire/log/redaction cases) | ~320 |
| `apps/api/tests/integration/agent-stream-error-contract.test.ts` | NEW (6 contract cases with buildApp + MockAgent + testcontainers) | ~230 |
| `tests/e2e-cjm/features/agent-stream-error.feature` | NEW (3 CJM scenarios — rev 2) | ~40 |
| `tests/e2e-cjm/steps/agent-stream-error.steps.ts` | NEW (step bindings — rev 2) | ~120 |
| `tests/e2e-cjm/steps/__tests__/agent-stream-error.steps.test.ts` | NEW (vitest unit coverage for steps — rev 2 + feedback_cjm_steps_need_unit_tests) | ~100 |
| `docs/operations.md` | MODIFY (append new section) | ~+90 |
| `charts/openwhispr-server/Chart.yaml` | MODIFY (2 fields) | ~+2 / -2 |
| `charts/openwhispr-server/values.yaml` | MODIFY (1 field + lineage comment) | ~+2 / -1 |
| `.gitleaks.toml` | MODIFY (allowlist 2 test fixture literals; Task 9 step 10) | ~+4 |
| `tools/lint-gitleaks-config.test.ts` | MODIFY (regression assertion for allowlist; Task 9 step 10) | ~+8 |
| `.planning/deferred-items.md` | MODIFY (append web-client e2e deferral entry — rev 2 / B2) | ~+8 |

**Net:** ~+1300 lines added, ~-75 deleted across 15 files (heavy on tests per project DISCIPLINE rule 2 + Hard Rule on real-surface characterization tests; rev 2 adds 3 e2e artifacts + step-binding unit coverage + deferred-items entry).

Note on mock-litellm fixture: if the e2e compose profile's mock-litellm does NOT yet support per-scenario response overrides, Task 6.5 PART B adds that capability (small fixture-only change inside the existing mock service; tracked in the same atomic commit). No impact on production compose profile.

---

## Implementation Order (TDD)

1. **Task 1 (RED)** — helper unit tests fail (module-not-found).
2. **Task 2 (GREEN)** — helper implemented; Task 1 passes; coverage ≥90/90/90/90.
3. **Task 3 (refactor)** — `StreamChunk` union widened; typecheck clean.
4. **Task 4 (RED)** — route-level tests fail (assertion mismatches: expected `type:"error"` received `type:"done"`).
5. **Task 5 (GREEN)** — `stream.ts` catches refactored; Tasks 1+4 pass.
6. **Task 6 (integration contract)** — buildApp + MockAgent 6-case suite passes.
7. **Task 6.5 (E2E CJM — rev 2)** — feature + steps + step-binding unit coverage; `E2E=1 make e2e-cjm` green for new scenarios.
8. **Task 7 (docs)** — operations.md operator-facing section added.
9. **Task 8 (chart bump)** — Chart.yaml + values.yaml bumped; helm lint clean.
10. **Task 9 (verification)** — full lint/typecheck/test/coverage/e2e-cjm/helm/gitleaks gates all green.
11. **Task 10 (atomic release)** — single commit + dual tags on same SHA + post-commit evidence rebind.

Strict ordering — Tasks 2, 5 each depend on the immediately preceding RED. Task 4's tests deliberately stay RED until Task 5 lands. Task 6.5's e2e depends on Task 5 GREEN (route emits new shape). Tasks 7+8 (docs, chart) are technically parallelizable with Task 6 / 6.5 but folded into linear order for atomic-commit cleanliness.

---

## Test Matrix (rev 2 — e2e cases added)

### Helper unit tests (Task 1): 25+ cases

LitellmUpstreamError mapping: 401, 403, 402, 429 (no retry), 429 (retryAfterMs=30000), 429 (retryAfterMs=0), 404, 400+invalid-model-name, 400+model_not_found-json, 400+not-found-generic, 400+other-body, 500, 502, 503, 504. (15 cases.)

Network/abort mapping: AbortError, ECONNREFUSED, ECONNRESET, ETIMEDOUT, ENOTFOUND, EAI_AGAIN, UND_ERR_HEADERS_TIMEOUT, UND_ERR_BODY_TIMEOUT, UND_ERR_CONNECT_TIMEOUT, UND_ERR_ABORTED. (10 cases.)

Catch-all: plain Error, TypeError, null, undefined, string throw, object throw. (6 cases.)

Security: secret-shape redaction (sk-or-v1 leak), Bearer ey leak, 2000-char body truncation to 500. (3 cases.)

### Route mapping unit tests (Task 4 part C — stream-error-mapping.test.ts): 5 describes

1. Wire envelope per code (13 stub-litellm cases).
2. Structured log binding shape (13 paired log-capture cases).
3. Log level flip (req.log.error called; req.log.warn NOT called for these paths).
4. Secret-shape redaction at the wire boundary.
5. Mid-stream drain parity (content preserved + terminal type:"error").

### Integration contract tests (Task 6): 6 cases

401 → upstream_auth; 429+Retry-After → upstream_rate_limit; 503 → upstream_unknown; mid-stream socket-close → terminal type:"error" + content preserved (provider EXACTLY "unknown" per rev 2 tightening); 400 model_not_found → upstream_invalid_model; ECONNREFUSED to 127.0.0.1:1 → upstream_timeout.

### E2E CJM tests (Task 6.5 — rev 2): 3 scenarios + step-binding unit cases

CJM scenarios (`E2E=1 make e2e-cjm`):
1. @cjm-12.3 preflight 4xx model_not_found → single terminal `type:"error"` with `code:"upstream_invalid_model"`, `provider:"litellm"`, canonical error string.
2. @cjm-12.4 happy-path regression — `type:"text-delta"` + terminal `type:"finish"`; no `type:"error"`.
3. @cjm-12.5 preflight 401 → single terminal `type:"error"` with `code:"upstream_auth"`, `provider:"litellm"`.

Step-binding unit cases (vitest in `__tests__/agent-stream-error.steps.test.ts`): ≥6 cases covering request building (URL/method/headers/body), NDJSON parsing (1-line / N-line), assertion helpers (code / provider / error matchers), mock-litellm control-plane configuration helper.

---

## Coverage Targets per File

| File | Lines | Branches | Functions | Statements |
|---|---|---|---|---|
| `apps/api/src/lib/agent-upstream-error-classify.ts` | ≥90% | ≥90% | ≥90% | ≥90% |
| `apps/api/src/routes/agent/stream.ts` (catch paths only, diff lines) | 100% | 100% | 100% | 100% |
| `apps/api/src/lib/sse-parser.ts` (no new logic — type-only ratchet) | unchanged | unchanged | unchanged | unchanged |
| `tests/e2e-cjm/steps/agent-stream-error.steps.ts` (rev 2 — step bindings) | ≥80% (via vitest sibling) | ≥80% | ≥80% | ≥80% |

Coverage measured via `pnpm --filter @openwhispr/api test --coverage`; step-binding coverage via root `pnpm test`; per-file numbers extracted from `coverage/lcov.info` summary.

---

## Verification Checklist (cross-references Task 9 — rev 2)

- [ ] `pnpm --filter @openwhispr/api lint` exits 0; all 6 LOCKERS clean on diff.
- [ ] `pnpm --filter @openwhispr/api typecheck` exits 0.
- [ ] `pnpm --filter @openwhispr/api test --coverage` exits 0; coverage gates hit.
- [ ] `pnpm --filter @openwhispr/api test` (full suite) exits 0; no unintended regressions in tests outside the 4 modified test files.
- [ ] `pnpm test 'tests/e2e-cjm/steps/__tests__/agent-stream-error.steps.test.ts'` exits 0 (step-binding unit coverage).
- [ ] `E2E=1 make e2e-cjm` exits 0; @cjm-12.3 / @cjm-12.4 / @cjm-12.5 + all pre-existing scenarios green.
- [ ] `helm lint charts/openwhispr-server` exits 0.
- [ ] `helm package charts/openwhispr-server` writes `openwhispr-server-1.0.16.tgz`.
- [ ] `pnpm test:evidence:projects-self-test` (v1.0.12 gate) accepts this commit's evidence (Task 9 pre-commit + Task 10 step 4.5 post-commit rebind).
- [ ] `git grep -nE '"upstream_error"|"stream_error"' apps/api/src/ packages/*/src/` returns 0 matches.
- [ ] `gitleaks detect --pipe` on staged diff returns 0 leaks (test fixtures allowlisted in `.gitleaks.toml`; allowlist additions land in the SAME atomic commit).
- [ ] `git tag --list 'v1.0.13' 'openwhispr-server-1.0.16'` shows both tags present.
- [ ] `git rev-list -n 1 v1.0.13` === `git rev-list -n 1 openwhispr-server-1.0.16` (tags co-located).
- [ ] Live curl reproducer (post-deploy) produces expected single-line NDJSON `type:"error"` response.
- [ ] Loki query for `event="agent.stream.upstream_failure"` returns the structured log line with full binding shape.

---

## Release Artifacts

| Artifact | Identifier | Lineage |
|---|---|---|
| API container image | `ghcr.io/yambr/openwhispr-api:1.0.13` | Built from commit SHA at Task 10 step 1 |
| Helm chart package | `openwhispr-server-1.0.16.tgz` | `helm package` from `charts/openwhispr-server/` at the same SHA |
| Git tags | `v1.0.13`, `openwhispr-server-1.0.16` | Both annotated tags on the same commit SHA |

Push to remote registries gated on user request (per MEMORY note `project_r19_r23_auth_journey` — landed-locally pattern).

---

## Risk Register (rev 2 — R7 added per PLAN-CHECK B1)

- **R1 — Removing `upstream_error`/`stream_error` from FinishReason union breaks pre-existing tests (Tests 9/10/17/18 in `stream.test.ts`).**
  Mitigation: rewrite all 4 IN-PLACE in the SAME atomic commit (Task 4). RESEARCH.md D4 ledger + grep evidence confirm zero OTHER consumers in production source.

- **R2 — Mid-stream `contentEmitted` detection — no flag exists in `stream.ts`.**
  Mitigation per RESEARCH.md R7: no flag needed — D1 lock says the same `type:"error"` chunk regardless of preceding content. Test asserts content preserved + terminal `type:"error"` chunk + NO `type:"done"` chunk in the drain-error case.

- **R3 — `retryAfterMs` in canonical message wording (graceful degradation).**
  Mitigation: append " (retry in ~Ns)" suffix ONLY when `err.retryAfterMs` is present AND > 0; canonical base message stands alone when retryAfterMs is undefined / 0. Test covers both code paths.

- **R4 — Provider field hardcoded "litellm" loses upstream-provider debugging context.**
  Mitigation per D2 lock: operator correlates via `litellm_call_id` in the structured log binding + LiteLLM Proxy's own observability. Documented in `docs/operations.md` section (Task 7).

- **R5 — Canonical messages English-only — i18n future-deferred.**
  Mitigation: DOCS-09 prohibits Cyrillic in source; English literals shipped to `chunk.error` IS the v1 contract. Internal CANONICAL_ERROR_MESSAGES const is the i18n-catalog key source for the follow-up phase.

- **R6 — Pre-push v1.0.12 evidence gate must accept this commit's evidence.**
  Mitigation: Task 9 step 8 runs `pnpm test:evidence:projects-self-test` BEFORE commit; Task 10 step 4.5 RE-RUNS it AFTER tag (rev 2 / PLAN-CHECK WARNING-2 fix) to bind the fragment to the landed SHA. If the gate requires `LITELLM_BASE_URL` to point at a real LiteLLM instance, use the mock-LiteLLM compose profile per MEMORY note `feedback_smoke_before_full_e2e`. STOP if the gate fails.

- **R7 — E2E coverage gap — wire surface change without `tests/e2e/` or `tests/e2e-cjm/` artifact would violate CLAUDE.md DISCIPLINE rule 3 ("E2E mandatory") and could ship the bug to prod if the mock-LiteLLM control-plane override pattern doesn't exist in the bundled fixture.** (Rev 2 / PLAN-CHECK BLOCKER-1.)
  Mitigation: Task 6.5 creates `tests/e2e-cjm/features/agent-stream-error.feature` + step bindings + vitest unit coverage; reuses existing `agent-stream.feature` + `agent-stream.steps.ts` patterns (same compose profile, same Cucumber harness, same `make e2e-cjm` target). If the bundled mock-litellm fixture does NOT yet support per-scenario response overrides, Task 6.5 PART B extends it in the SAME atomic commit (small fixture-only change isolated to the e2e compose profile; production compose unaffected — see threat T-260528-0cm-09).

- **R8 — LOCKER-04 dead export risk on `CANONICAL_ERROR_MESSAGES`.**
  Mitigation: `CANONICAL_ERROR_MESSAGES` is NOT exported from the helper module; declared as internal const. Tests assert against literal string fixtures duplicated test-side. Frontmatter `exports` list reflects: `classifyUpstreamError`, `AgentErrorCode`, `ClassifiedAgentError` only.

- **R9 — Gitleaks pre-commit / pre-push hook fires on test fixture credential shapes (`sk-or-v1-…`, `Bearer eyJ…`).**
  Mitigation per project Hard Rule 4: add allowlist entries in `.gitleaks.toml` for these test fixture literals + regression assertion in `tools/lint-gitleaks-config.test.ts`, in the SAME atomic commit as the test files (Task 4 + Task 6). Alternative — replace fixtures with synthetic non-matching strings — explored but rejected because asserting redaction REQUIRES the redactor to recognize the secret shape, which means the input must match the regex.

- **R10 — sse-parser → agent-upstream-error-classify same-layer lib edge could appear circular.**
  Mitigation per RESEARCH.md R5: `sse-parser.ts` type-imports only (`import type { AgentErrorCode }`); helper never imports from sse-parser. Verified non-circular by reading both files' import lists.

- **R11 — Integration test ECONNREFUSED case may require `agent.enableNetConnect()` toggle.**
  Mitigation per Task 6 action: use a separate `describe` block that does NOT install MockAgent for this case (or selectively `enableNetConnect()` for `127.0.0.1:1` only). Document the toggle in test prose.

---

## Out-of-Scope Deferrals (rev 2 — web-client e2e deferral added per B2)

1. **Provisioning 5 Groq chat aliases** (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3-32b`, `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`) — peer-requested but separate decision. Track as v1.0.14 follow-up after wire fix verified GREEN. CONTEXT.md "Out of scope" explicitly defers this.

2. **LitellmUpstreamError class refactor** — already correct per RESEARCH.md R1; out of scope.

3. **Server-side retries on upstream errors** — client policy decision; not server-domain. Out of scope.

4. **Generated SDK regen for client-side type sync** — CONTEXT.md "Out of scope: client renderer changes — the wire contract is client-source-of-truth, we conform to it"; immutable upstream per peer.

5. **i18n of canonical messages** — English-only v1; RU + others land in a future i18next-keyed catalog phase. Internal CANONICAL_ERROR_MESSAGES const is the source for the catalog.

6. **/api/transcribe non-stream envelope** — already canonical 502 + `error.code:"upstream_error"`; CONTEXT.md "Out of scope".

7. **Reason-cleanup / realtime stream parity** — separate routes, separate phases. CONTEXT.md "Out of scope".

8. **LOCKER-04 BLOCKING flip / LOCKER-05 BLOCKING flip / LOCKER-06 BLOCKING flip** — CLAUDE.md DISCIPLINE 14 notes these flip in Phases 41 / 37 / 36.a respectively; this phase keeps them WARN-only per existing ledger.

9. **Web-client e2e for `/api/agent/stream`** (rev 2 / PLAN-CHECK BLOCKER-2 closure with option-b deferral).
   **Rationale:** `apps/web` v1 has NO agent chat UI surface. Verified at planner-side (rev 2 investigation): `apps/web/src/app/` route groups are `(admin)` + `(auth)` + `(public)`; the `(public)` group contains exactly `forgot-password|reset-password|setup|sign-in|sign-up|verify-email` — no agent route, no chat component. `grep -rln 'agent\|/api/agent' apps/web/src` returns ZERO matches. The MEMORY rule `feedback_web_e2e_required_alongside_desktop` triggers ONLY when a feature bifurcates client surface — `/api/agent/stream` does not bifurcate the web surface in v1 because the web surface does not consume it.
   **Coverage in the meantime:** server-side wire contract enforced via the new `tests/e2e-cjm/agent-stream-error.feature` (Task 6.5) — the same NDJSON parser shape any future web client would adopt is exercised in CI on every PR. Renderer-coupling regression risk is mitigated by the CI gate (PLAN-CHECK BLOCKER-2 fix).
   **Revisit trigger:** the phase that lands web agent chat UI MUST add a Playwright-driven web e2e for `/api/agent/stream` happy-path + at least one failure mode (e.g., 401 → user-facing error bubble). Track in `.planning/deferred-items.md`.

---

## Operator Runbook (Post-Merge)

After v1.0.13 ships, operators should configure the following Loki alerts (suggested thresholds — tune per traffic):

| Code | Alert Threshold | Operator Action |
|---|---|---|
| `upstream_auth` | Sustained rate > 1/min for 5 min | Rotate the API key in LiteLLM env (`OPENROUTER_API_KEY` / `GROQ_API_KEY` / `OPENAI_API_KEY`); redeploy LiteLLM container |
| `upstream_quota_exceeded` | Any occurrence | Top up provider billing; verify spend limits in LiteLLM dashboard |
| `upstream_rate_limit` | Sustained rate > 5/min for 10 min | Bump LiteLLM concurrency limits OR upgrade upstream provider tier |
| `upstream_invalid_model` | Sustained rate > 2/min for 5 min | Desktop client / server alias mismatch — verify `compose/litellm/litellm_config.yaml` `model_list` against the client's `chatAgentModel` selector |
| `upstream_timeout` | Sustained rate > 3/min for 10 min | Investigate the LiteLLM → upstream-provider network path; check undici dispatcher logs; rule out provider degradation |
| `upstream_unknown` | Sustained rate > 1/min for 5 min | Read `upstream_body_truncated` field in the log binding for diagnosis; treat as upstream provider degradation until classified |

LogQL query template: `{app="openwhispr-api"} | json | event="agent.stream.upstream_failure" | code="<code>"`.

For correlation with the actual upstream provider behind LiteLLM (groq/openai/openrouter/anthropic): pivot by `litellm_call_id` field into LiteLLM Proxy's own log stream (the proxy's logs carry `metadata.llm_provider` per LiteLLM observability conventions). This phase's structured log binding includes `litellm_call_id` whenever the drain-side catch fires (header was already captured at L294 pre-fix); preflight-side catches have `litellm_call_id: undefined` because no response existed.

Cross-reference: `docs/operations.md` "Agent stream error contract" section is the canonical source for this taxonomy. `tests/e2e-cjm/features/agent-stream-error.feature` is the canonical CI gate for the wire envelope shape (rev 2).
