# Phase 37: LitellmUpstreamError bodyText truncation (CR-9) — Context

**Source:** ROADMAP Phase 37 + `.planning/review/litellm-client.md` CR-01 + Phase 31-05-DECISIONS.md (LOCKER-05 surfaced 2 sibling leaks in pyannote-client.ts).

## Pre-flight

Per Phase 31-05 DECISIONS: there are **3 error classes**, not 1, with public readonly `bodyText: string` that leak full upstream bodies via pino's own-property serializer:
1. `packages/litellm-client/src/errors.ts:31` — `LitellmUpstreamError.bodyText` (the documented CR-9)
2. `apps/api/src/lib/pyannote-client.ts:68` — `PyannoteBadRequestError.bodyText` (sibling — Phase 31-05 discovery)
3. `apps/api/src/lib/pyannote-client.ts:80` — `PyannoteUpstreamError.bodyText` (sibling)

All three currently store the FULL upstream body. Default `message` is truncated to 200 chars but pino enumerates ALL own properties.

## Goal

For each of the 3 error classes:
- Truncate `bodyText` at construction: `this.bodyText = bodyText.slice(0, 200)`
- Mark `bodyText` `private readonly` (TypeScript compile-time only; doesn't block pino at runtime but reduces surface area)
- Override `toJSON()` to return `{ name, message, status }` ONLY — pino's `serializers.err` calls `err.toJSON()` if present; this guarantees `bodyText` NEVER reaches Loki

## RED tests

Per error class:
- `const err = new <Class>(500, 'x'.repeat(10000), ...)`
- Assert `JSON.stringify(err).length < 500` bytes
- Assert `JSON.stringify(err)` does NOT contain `'x'.repeat(201)` substring
- Assert pino-style structured log with `err` as field does NOT contain the full 10000-char body
- Coverage ≥ 90/90/90/90 on each modified file

## LOCKER-05 flip

Plan 31-05 shipped `lint-secret-shape-in-error` in WARN-only mode with the 3 entries allowlisted. After Phase 37 lands, REMOVE all 3 from `tools/lint-secret-shape-in-error.allowlist.txt` + drop `--warn-only` from `package.json` `lint:secret-shape-in-error` → BLOCKING. Atomic with the GREEN fix commit.

## Scope (out)

- New error classes elsewhere in the codebase. Pure surgical fix on the 3 known violations.
- Phase 41.f's other litellm-client HIGH fixes (timeouts, SSRF assert, model alias drift, streamOptions).
