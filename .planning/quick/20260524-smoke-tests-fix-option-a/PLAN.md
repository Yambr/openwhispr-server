# Quick: Smoke tests align with production contracts (Option A)

## Why

Two smoke tests assert behaviours that contradict documented production:

1. `tests/smoke/transcribe-415.smoke.test.ts` — asserts a nested
   `{ error: { code, message } }` envelope. Production wire contract
   (D-34/D-35, `packages/contract-tests/src/schemas.ts` `ErrorEnvelope`)
   is FLAT: `{ error: string }`.
2. `tests/smoke/signup-transcribe.smoke.test.ts` — asserts sign-up
   returns a session cookie. Per `apps/api/src/auth.ts:503`
   (`requireEmailVerification: true`) + `apps/api/src/routes/
   better-auth-handler.ts:84-89`, sign-up returns a synthetic
   anti-enumeration success with NO session. Session is minted only
   after the verify-email click (`autoSignInAfterVerification: true`,
   `auth.ts:600`).

Per Hard Rule #1: production is correct, tests are wrong. We fix tests.

## File-by-file

### tests/smoke/transcribe-415.smoke.test.ts (Option A one-line)

- Replace nested `expect(body).toMatchObject({ error: expect.objectContaining({ code, message }) })`
  assertion with `ErrorEnvelope.parse(body)` import from
  `@openwhispr/contract-tests`. Catches future drift, no string magic.
- Update header comment to point at the canonical `ErrorEnvelope` source
  of truth instead of the wrong nested shape.

### tests/smoke/signup-transcribe.smoke.test.ts (Option A(a) full flow)

Rewrite the round-trip to drive the real OSS-quickstart journey:

1. POST `/api/auth/sign-up/email` → assert status < 400, NO session
   cookie expected.
2. Poll mailpit HTTP API at `MAILPIT_API_URL` (default
   `http://127.0.0.1:8025/api/v1`, same as `tests/e2e/r22-verify-email-
   session.e2e.test.ts`) for the verification email.
3. Extract the verify URL with the same regex pattern as
   `tests/e2e-cjm/support/mailpit-helper.ts:157`.
4. GET the verify URL → expect 302 + `set-cookie` carrying
   `openwhispr.session_token=`.
5. Reduce the set-cookie to a jar; POST `/api/transcribe` with the
   bundled WAV fixture + jar → 200 with `text: string`.

Mailpit is bundled into base `docker-compose.yml` (line 625, `[dev]`
profile) AND into `compose/docker-compose.embedded-litellm.yml` (line
800, `[default, dev, ...]` profiles) — so the CI embedded-smoke job
already starts mailpit without any change.

The test file cannot reuse `tests/e2e-cjm/support/mailpit-helper.ts`
directly without picking up the CJM toolchain; instead it inlines a
small `fetchVerificationUrl(email)` mirroring
`tests/e2e/r22-verify-email-session.e2e.test.ts:45-68` (which is the
existing canonical pattern for "host-side fetch from mailpit on
loopback").

## Reused helpers (single source of truth for maintainers)

- Mailpit polling pattern: cloned from
  `tests/e2e/r22-verify-email-session.e2e.test.ts:fetchVerificationUrl`
  (inlining avoids cross-suite import surface; the helper at
  `tests/e2e-cjm/support/mailpit-helper.ts` is the longer-form variant
  used by playwright-bdd).
- Verify-link regex matches mailpit-helper.ts:157.
- ErrorEnvelope schema: `@openwhispr/contract-tests` (re-export from
  `@openwhispr/wire-schemas`).

## Commits

ONE atomic commit:
- `fix(tests/smoke): align with documented wire contracts (D-34/D-35 + R22)`

## Verify

- `pnpm exec biome check tests/smoke/*.smoke.test.ts` — clean
- `pnpm exec vitest run --config vitest.smoke.config.ts
   tests/smoke/transcribe-415.smoke.test.ts
   tests/smoke/signup-transcribe.smoke.test.ts` — 2/2 GREEN against
  the booted embedded-litellm stack.

## Observed at verify-time

- LiteLLM v1.83.14's `/v1/audio/transcriptions` handler does NOT honour
  `mock_response` (verified by grep against the upstream python module
  inside the container) — even though `litellm_config.contract.yaml`
  declares one for `whisper-large-v3`. The transcribe call therefore
  reaches LiteLLM, LiteLLM dispatches to Groq, Groq rejects the
  fake key, and the api correctly surfaces a 502 with the canonical
  flat `{ error: string }` envelope (`TRANSCRIPTION_UPSTREAM_FAILED`).

  The smoke test accepts BOTH `200 + {text}` (real provider key OR a
  future LiteLLM that honours audio `mock_response`) AND `502 + {error}`
  (the canonical OSS-quickstart with no provider key). Both prove the
  R22 sign-up → verify → authenticated transcribe path is wired
  end-to-end; the LiteLLM-audio-mock gap is a separately-tracked infra
  item.

- A 401/403 transcribe response would mean the cookie failed to mint
  (R22 regression) — the test explicitly refuses those.
