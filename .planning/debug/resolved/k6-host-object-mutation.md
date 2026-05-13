---
slug: k6-host-object-mutation
status: investigating
trigger: make load-test PROFILE=mock (mock plateau, 2026-05-12)
goal: find_and_fix
tdd_mode: true
created: 2026-05-12
---

# Debug Session — k6 host-object mutation in load-test transcribe flow

## One-line symptom

Every k6 VU iteration throws `TypeError: Cannot assign to property __k6_http_file of a host object` at `tools/load-test/src/main.ts:98:27` in `httpFile()`, called from `tools/load-test/src/flows/transcribe.ts:50`, called from `tools/load-test/src/main.ts:185` (the transcribe scenario). Aborted the 30-min mock plateau at ramp-up — k6 thresholds blew up before sustained phase started.

## Current Focus

- **hypothesis:** `http.file()` from `k6/http` returns a Go-backed host object in the goja JS engine; its properties are non-configurable/frozen, so `Object.assign(fd, {...})` fails. The marker pattern itself is sound; the **mutation strategy** is wrong.
- **next_action:** Confirm the host-object hypothesis against k6/goja docs, then evaluate three fix options (spread, wrap, idiomatic k6 multipart API) for whether they preserve the `http.file` identity that `http.request` uses for multipart encoding.

## Symptoms (pre-filled from user)

1. Stack itself is healthy: 15/15 containers `Up (healthy)` for 2+ minutes during the failed run, including api, postgres, pgbouncer×4, valkey, traefik, mock-litellm. The bug is **client-side in the k6 sandbox**, not in the api/stack.
2. Offending code at `tools/load-test/src/main.ts:96-104` (introduced by commit `638c342`, Plan 08.1-01 Task 2):
   ```ts
   httpFile(bytes: Uint8Array, filename: string, contentType: string) {
     const fd = http.file(bytes, filename, contentType) as Record<string, unknown>;
     return Object.assign(fd, {
       __k6_http_file: true as const,
       bytes,
       filename,
       contentType,
     });
   }
   ```
3. `http.file()` from `k6/http` returns a host object (Go-backed proxy in goja). Properties typically non-configurable/frozen → `Object.assign` adding a new property is rejected with the observed TypeError.
4. The vitest unit tests that 08.1 added were GREEN because the vitest mock for `http.file` returns a plain JS object, not a host object. So the bug never surfaced in pre-commit/CI, only under the real `k6 run` binary.
5. Stack runs locally (Docker Desktop, 35GB RAM, 10 CPU, 491GB free). `bash tools/load-test/scripts/preflight.sh --yes` returns OK. `make load-test PROFILE=mock` boots the stack but k6 fails as above.

## Scope (three goals)

### G1. Root-cause and fix transcribe flow
Confirm host-object hypothesis (cite k6/goja docs) or identify divergent root cause. Evaluate:
- Spread to fresh object: `{ ...fd, __k6_http_file: true, ... }` — does it preserve k6 identity?
- Wrap: `{ file: fd, __k6_http_file: true, ... }` + consumer adjustment.
- Idiomatic k6 multipart API (no marker hack).

### G2. Audit sibling flows
- `tools/load-test/src/flows/reason.ts`
- `tools/load-test/src/flows/agent-stream.ts`
- `tools/load-test/src/flows/realtime-ws.ts`
- `tools/load-test/src/main.ts` `ws()` wrapper (`new WebSocket(...)`)
- `tools/load-test/src/setup.ts` (provisionUsers)

Report Confirmed / Suspicious / Clean per file with file:line evidence.

### G3. k6-smoke gate
Concrete preflight stage: `k6 run --vus 5 --duration 30s` against api before 30-min plateau. Failure cap (>1 error/VU/30s → abort). Pipeline integration point in `run.sh`. CI viability (full compose cost/benefit). Home: existing `run.test.sh` or new script.

## Evidence

- timestamp: 2026-05-12 (session open)
  source: user-supplied symptom report
  observation: TypeError reproduced on every VU iteration; stack healthy; vitest green.

## Context

Bug introduced by Plan 08.1-01 Task 2 fix (commit `638c342`) that closed deferral anomaly #1 (99.93% HTTP error rate, plan 08-07 first run). Fix live-validated by `tools/load-test/scripts/forensic-probe.ts` — but forensic-probe uses Node `undici` not k6, so it proved api correctness but not k6 client correctness. Paths diverged at host-object mutation.

Unblocks Phase 8-08 (SLO publication) — no green plateau ⇒ no baseline numbers.

## Constitutional constraints

- Strict TDD: red test/repro before fix.
- ≥90/90/90/90 coverage on diff.
- Commit subjects lower-case conventional, scoped `(08.1-fix)` or similar.
- Co-author trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` with blank line before trailer (commitlint).
- English-only source artifacts.
- Working dir `/Users/dev/openwhispr-server`, branch `main`.

## Resolution

- **root_cause CONFIRMED:** k6's `http.file(bytes, filename, contentType)`
  returns a goja-backed `FileData` host object whose property descriptors
  are non-configurable. Plan 08.1-01 Task 2's
  `Object.assign(fd, {__k6_http_file: true, bytes, filename, contentType})`
  rejected with `TypeError: Cannot assign to property __k6_http_file of
  a host object` on every VU iteration. k6 detects multipart encoding by
  runtime type identity of `*FileData` instances inside the request
  body — it does NOT need the custom marker. The marker existed purely
  as a vitest-side convenience, so the vitest path (plain JS object)
  stayed green while the live k6 path blew up.

- **fix chosen — Option A (modified):** return the FileData verbatim
  from the k6 adapter (no spread, no Object.assign, no wrapping). The
  spread variant `{...fd, ...}` would have lost the host-object
  identity that k6 keys multipart detection on. The wrap variant
  `{file: fd, __k6_http_file: true, ...}` would have required consumer
  changes in every flow. The idiomatic-k6 variant (drop the marker
  entirely from the runtime path) is what we landed: the `HttpFile`
  TypeScript interface was widened so the marker is optional, kept on
  the vitest mock-adapter path so existing test assertions keep
  working, removed from the runtime path.

- **commits:**
  - `3ad3470` — fix(08.1-followup): httpFile must not mutate k6 host object
  - `60ceff6` — chore(08.1-followup): audit findings — sibling k6 flows clean
  - `f3a17a9` — feat(08.1-followup): add k6 smoke gate to load-test run pipeline

- **G2 audit verdicts** (full report: `.planning/phases/08.2-agent-stream-undici-dispatcher-fix/audits/k6-host-object-mutation-audit.md`):
  | File | Verdict |
  | ---- | ------- |
  | `flows/transcribe.ts` | FIXED in 3ad3470 |
  | `flows/reason.ts` | CLEAN — JSON.stringify body, read-only response |
  | `flows/agent-stream.ts` | CLEAN — JSON.stringify body, custom Trend.add() |
  | `flows/realtime-ws.ts` | CLEAN — socket methods invoked, no property writes |
  | `main.ts ws()` wrapper | CLEAN — constructor only, no mutation |
  | `setup.ts` provisionUsers | CLEAN — wraps response in fresh plain object |

- **G3 smoke gate:**
  - Script: `tools/load-test/scripts/k6-smoke.sh`
  - Bundle: `tools/load-test/src/smoke.ts` → `dist/smoke.js`
  - Behaviour tests: `tools/load-test/scripts/k6-smoke.test.sh` (8/8 PASS)
  - run.sh wiring: step 5a, AFTER `pnpm run build`, BEFORE plateau `k6 run`
  - Bypass: `SMOKE_SKIP=1`
  - CI deferral: flagged for Phase 0/6 hardening — full-compose runner cost.

- **regression test guarantee:** future regressions that re-introduce
  `Object.assign` on a goja-backed object will fail synchronously under
  vitest (the new `k6HttpFile() host-object safety (regression)`
  describe block stubs `globalThis.__k6_http.file` to return an
  `Object.freeze`'d faux FileData — strict-mode mutation throws
  immediately). The smoke gate is the live-stack belt-and-braces.
