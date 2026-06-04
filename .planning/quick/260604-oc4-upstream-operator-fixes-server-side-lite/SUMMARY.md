---
phase: quick-260604-oc4
plan: 01
subsystem: litellm-client + realtime relay + operator docs
tags: [upstream-bugfix, litellm, realtime, attribution, docs]
requires: []
provides:
  - "endUser email attribution (body user + configurable LITELLM_USER_HEADER_NAME) across all litellm-client gateway calls"
  - "REALTIME_FORCE_TRANSCRIPTION_MODEL — operator realtime model wins over client override (Beta + GA paths)"
  - "operator runbooks for both new env vars + the requestKind/thinking contract + reverse-proxy body-size requirement"
affects:
  - packages/litellm-client
  - apps/api realtime relay
tech-stack:
  added: []
  patterns:
    - "opt-in operator env header (empty-is-unset, CR/LF/colon-rejected at load)"
    - "force-pin operator value over untrusted client value on a relay translate seam"
key-files:
  created:
    - packages/litellm-client/tests/unit/auth-headers.test.ts
    - .env.external.example
    - .env.local-speaches.example
  modified:
    - packages/litellm-client/src/config.ts
    - packages/litellm-client/src/index.ts
    - apps/api/src/config/realtime.ts
    - apps/api/src/lib/realtime-frame-translate.ts
    - apps/api/src/routes/realtime.ts
    - apps/api/src/routes/reason.ts
    - apps/api/src/routes/transcribe.ts
    - apps/api/src/routes/index.ts
decisions:
  - "D-1: x-litellm-end-user-id stays the UUID; email lands in body.user + the configurable header (both, not instead)"
  - "D-4: REALTIME_FORCE_TRANSCRIPTION_MODEL defaults TRUE; force pins model on Beta AND GA paths; language passes through"
  - "diarization is NOT a litellm-client consumer — it uses its own pyannote-client / speaches fetch; out of scope for the endUser header"
metrics:
  duration: "~1.5h"
  completed: 2026-06-04
  commits: 3
  tasks: 3
---

# Quick 260604-oc4 Plan 01: Upstream operator fixes (server-side lite) Summary

Three independent server-side fixes from a corporate-operator upstream bug report,
delivered as exactly 3 atomic commits under strict TDD (RED proven before GREEN, tests +
production in the same commit):

1. **Fix #4** — LiteLLM end-user EMAIL attribution: body `user` now prefers the
   authenticated email over the UUID, plus an opt-in configurable HTTP header
   (`LITELLM_USER_HEADER_NAME`). `x-litellm-end-user-id` stays the stable UUID.
2. **Fix #1.5** — `REALTIME_FORCE_TRANSCRIPTION_MODEL` (default on): the operator
   transcription model wins over a client-supplied realtime model on both the Beta and GA
   translate paths; client `language` still passes through.
3. **Docs #2.4 + #3.1** — env examples (all 5), operator runbooks, the requestKind /
   thinking-off contract, and the reverse-proxy ≥100 MB body-size requirement.

## Commits

| # | SHA | Title | Targeted test result |
|---|-----|-------|----------------------|
| 1 | `dcd20894` | feat(litellm): end-user email body attribution + configurable LITELLM_USER_HEADER_NAME (upstream #4) | litellm-client config(51) + auth-headers(8) + index(56) PASS |
| 2 | `5a3c3dde` | fix(realtime): force operator transcription model over client override (upstream #1.5) | config/realtime + realtime-frame-translate + realtime route + realtime-language = 100 PASS |
| 3 | `2ddabd4f` | docs: env + operator runbooks for upstream #4 / #1.5 / #2.4 / #3.1 | verify script: OK (5/5 env files, body-size, requestKind) |

## Both realtime paths covered (peer-flagged preconfigured concern)

The desktop client sends its own `session.update` ONLY when `!preconfigured`. Both paths
land on the operator model:
- **preconfigured** (client sends nothing): the relay ORIGINATES its session.update via
  `buildRelaySessionUpdateFrame(config)` carrying `config.model` = `REALTIME_TRANSCRIPTION_MODEL`
  (pre-existing R31 DEFECT 6; tested at realtime-frame-translate.test.ts:459-524).
- **!preconfigured** (client sends its own model): the new `REALTIME_FORCE_TRANSCRIPTION_MODEL`
  force-override pins `model: force` on both Beta and GA translate paths (this fix).

## endUser seam resolution (diarization + realtime)

- **reason / transcribe** — route through litellm-client; pass `endUser: req.user.email ?? req.user.id`.
- **realtime** — does NOT use litellm-client authHeaders; dials upstream WS directly. `req.user.email`
  IS reachable at the WSS-upgrade handler; litellm-mode `?user=` now carries email; the stable
  `openwhispr_user_id` spend-logs key stays UUID (D-1).
- **diarization** — NOT a litellm-client consumer (`createPyannoteClient` + direct speaches `fetch`);
  the endUser header surface does not apply. PLAN's interface note was inaccurate for current code.
  No endUser added. Future email attribution for the diarization hop = a distinct change.

## wire-schemas no-op confirmation

`packages/wire-schemas` UNAFFECTED — `git diff --name-only 7ee254b2..HEAD | grep wire-schemas`
returns nothing. `endUser` is server→upstream only; the desktop client never sends it.

## Deviations from Plan (all auto-fixed, Rule 3)

1. lint-no-hardcode + lint-no-env-branches allowlists: pure line-DRIFT bumps (135→151, 713→719)
   with appended rationale — NO new allowlist entries.
2. biome noAssignInExpressions: `pinGaTranscriptionModel` rewritten with explicit if/else.
3. `.gitignore`: added `!` negations so `.env.external.example` + `.env.local-speaches.example`
   (previously shadowed/untracked) are version-controlled.
4. `realtime.test.ts` litellm-mode `?user=` assertion updated UUID→email (intended D-2 change).
5. Commit-message headers trimmed to commitlint's 100-char limit (kept `(upstream #N)` tags).

## Constitutional compliance

Strict TDD (RED→GREEN same-commit); LOCKER-01/02/03/04 clean (the two `as unknown as` are in
the TEST file auth-headers.test.ts — permitted; production src has none); network-boundary-only
mock (injected fake `request`); no `--no-verify` (gitleaks + biome + lockers + commitlint passed).

## Independent orchestrator verification (hard rule 3)

- (a) commits on HEAD: `dcd20894`, `5a3c3dde`, `2ddabd4f` confirmed via git log.
- (c) claimed edits present: grep-confirmed userHeaderName/endUser/forceTranscriptionModel at
  cited lines; endUser:req.user.email at reason.ts:178 + transcribe.ts:232.
- LOCKER-02: the only `as unknown as` hits are in the test file (allowed); production clean.
- allowlist edits: pure line-drift, no new entries.
- wire-schemas: empty diff.
- (b) test suites re-run by orchestrator — see commit-table results above.
- (d) tree clean (only the new .planning/quick dir untracked + scheduled_tasks.lock).
