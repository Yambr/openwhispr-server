---
quick_id: 260530-kkz
slug: cleanup-no-rephrase-contract
date: 2026-05-30
status: in-progress
---

# Quick Task: Cleanup-no-rephrase contract test

## Goal

Add a hermetic server-side contract test that locks the **verbatim
passthrough** guarantee for the voice→text cleanup path: `POST /api/reason`
cleanup-shape returns the cleanup model's output BYTE-FOR-BYTE, with the
server adding/changing nothing (no rephrase, no added content, no
post-processing).

Regression guard for the reasoning-rephrase incident (peer gr0flvsr's
litellm fix: backing model under alias `qwen3.6-cleanup` swapped from a
reasoning model to an instruct checkpoint + temperature:0). That fix lives
on the litellm side; THIS test guards OUR layer's contract so a future
server regression (e.g. someone adding a "polish" post-step) is caught.

## What the test pins (honest scope)

This is a UNIT/contract test against `makeFakeLitellm` (network-boundary
fake, per constitution — NO internal mocks). It guarantees OUR layer's
contract, NOT real-model behavior:

1. Server returns `upstreamJson.choices[0].message.content` VERBATIM as
   `ReasonResponse.text` — a golden dirty-transcript → cleaned-output pair
   where the fake returns the cleaned text and the route echoes it byte-
   for-byte (no added preamble/commentary/rephrase by the server).
2. Cleanup-shape still routes to `cleanupModel` + carries thinking-off
   extras (`extra_body.chat_template_kwargs.enable_thinking:false`).
3. The cleanup system prompt is sent (server-side prompt is applied).
4. Negative assertion: the server does NOT mutate, truncate, or augment the
   model output (response.text === the exact fake content, nothing appended).

Real-model "does not rephrase" behavior is OUT OF SCOPE for a unit test —
that is pinned by (a) the operator's instruct-model + temp:0 litellm config,
and (b) the separate nightly e2e (task #17) against the real stage alias.

## Surface

- Test file: `apps/api/tests/unit/routes/reason.test.ts` (extend the R33
  block — reuses `buildApp` + `makeFakeLitellm` + `makeFakeDb`).
- Production code: NONE — behavior already exists at `reason.ts:197`
  (`text: upstreamJson.choices?.[0]?.message?.content ?? ""`). This is a
  regression-locking test, not a behavior change.

## Verification

- New test GREEN (behavior already correct → locks it).
- Full `reason.test.ts` suite still GREEN.
- `pnpm test:all` green for the pre-push evidence gate (never --no-verify).
