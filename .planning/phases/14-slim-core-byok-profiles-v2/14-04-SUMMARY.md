---
phase: 14-slim-core-byok-profiles-v2
plan: 04
subsystem: byok-boot-guard
tags: [byok, loud-fail, pino, otel-sentinel, workspace-package]
requires:
  - .env.slim.example documents the BYOK env contract (plan 14-02)
  - slim-core base docker-compose.yml ships without storage/observability/ingress/pgbouncer/dev-tools (plan 14-01)
  - packages/email/createEmailSender loud-fail precedent (Phase 13 commit 17c603e)
  - apps/api/src/lib/redact-url.ts HI-02 helper (Phase 13)
provides:
  - packages/byok-guard/ workspace package (@openwhispr/byok-guard)
  - assertBYOKConfig(env?, opts?) — boot-time guard with 5-row BYOK matrix
  - OTEL_EXPORTER_OTLP_ENDPOINT=disabled sentinel in api + worker bootstrap
  - boot-order discipline test (apps/api/src/__tests__/boot-order.test.ts)
affects:
  - apps/api/src/index.ts (byok-guard import + call before SSRF + OTel)
  - apps/worker/src/index.ts (same)
  - apps/api/src/otel-bootstrap.ts (NodeSDK | null + sentinel short-circuit)
  - apps/worker/src/otel-bootstrap.ts (same)
  - apps/api/src/otel-bootstrap.test.ts (D-T3 "first executable line" rule amended)
tech-stack:
  added:
    - "@openwhispr/byok-guard": "workspace:*" (dependency in apps/api + apps/worker)
  patterns:
    - "Pino-9 synchronous-destination flush-discipline (replaces deprecated pino.final)"
    - "Workspace-package boundary (mirrors packages/email/) for code shared by 2+ apps"
    - "Vendored < 30-LoC helper (redact-url.ts) to keep the package self-contained"
    - "First-violation-only loud-fail (single fatal record per boot, matrix order)"
    - "`NodeSDK | null` exported shape with `if (target === null) return` no-op-safe wrappers"
key-files:
  created:
    - packages/byok-guard/package.json
    - packages/byok-guard/tsconfig.json
    - packages/byok-guard/vitest.config.ts
    - packages/byok-guard/src/index.ts
    - packages/byok-guard/src/redact-url.ts
    - packages/byok-guard/src/__tests__/byok-guard.test.ts
    - packages/byok-guard/src/__tests__/redact-url.test.ts
    - apps/worker/src/otel-bootstrap.test.ts
    - apps/api/src/__tests__/boot-order.test.ts
  modified:
    - apps/api/package.json
    - apps/worker/package.json
    - apps/api/src/index.ts
    - apps/worker/src/index.ts
    - apps/api/src/otel-bootstrap.ts
    - apps/worker/src/otel-bootstrap.ts
    - apps/api/src/otel-bootstrap.test.ts
    - pnpm-lock.yaml
    - .planning/deferred-items.md
decisions:
  - "Hoisted byok-guard to packages/byok-guard/ workspace package (PLAN-CHECK F-02 resolution) rather than apps/api/src/lib/ — mirrors packages/email/ analog, enables zero-cross-app-relative-import wiring."
  - "Vendored redact-url.ts (5 LoC effective) into the package rather than depending on apps/api — keeps package self-contained and respects the apps/* ← packages/* one-way dependency direction."
  - "Replaced pino.final() (CONTEXT.md decision 2 wording) with pino.destination({ sync: true, dest: 2 }) — Pino 9 removed the legacy `final` API. Operational invariant (flush-before-exit) is identical; only the API name changed. Exposed as createBootLogger() so tests can assert the discipline."
  - "process.exit(1) (not sysexits.h 78) — matches apps/api/src/index.ts:675 precedent; CONTEXT.md decision 2 explicitly forbids the sysexits regression."
  - "First-violation-only ordering: storage → observability → ingress → pgbouncer → dev-tools. Operators fix one at a time; multi-fatal noise is anti-pattern (also enforced by single exit(1) call)."
  - "Sentinel `=disabled` short-circuits NodeSDK CONSTRUCTION (not just startSdk) — `new NodeSDK({...})` itself wires the default exporter into the global meter provider, so merely skipping start() would still produce the dial noise the sentinel is meant to suppress."
metrics:
  duration_minutes: 12
  tasks_completed: 3
  commits: 6
  files_created: 9
  files_modified: 9
  unit_tests_added: 27
  coverage_byok_guard: "100/100/100/100"
completed: 2026-05-14
---

# Phase 14 Plan 04: BYOK Boot Guard + OTel `=disabled` Sentinel — Summary

One-liner: Workspace package `@openwhispr/byok-guard` exposes a Pino-fatal-and-exit boot guard wired into both api + worker before any side-effecting import, complemented by an OTEL_EXPORTER_OTLP_ENDPOINT=disabled sentinel that short-circuits NodeSDK construction so a slim-core deployment without the observability overlay does not flood stderr with collector retries.

## What shipped

### 1. `packages/byok-guard/` — new workspace package

Layout (mirrors `packages/email/`):

```
packages/byok-guard/
├── package.json            # name: @openwhispr/byok-guard, deps: pino
├── tsconfig.json           # extends ../../tsconfig.base.json
├── vitest.config.ts        # 90/90/90/90 coverage floor
└── src/
    ├── index.ts            # assertBYOKConfig() + BYOK_MATRIX + createBootLogger
    ├── redact-url.ts       # vendored from apps/api/src/lib/redact-url.ts
    └── __tests__/
        ├── byok-guard.test.ts   # 16 cases
        └── redact-url.test.ts   # 5 cases
```

### 2. BYOK matrix (CONTEXT.md decision 2 — verbatim)

| Overlay | Missing env(s) | Code | NODE_ENV gate |
|---|---|---|---|
| storage | `S3_ENDPOINT` (or partner keys `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` when ENDPOINT set) | `BYOK_STORAGE_REQUIRED` | none |
| observability | `OTEL_EXPORTER_OTLP_ENDPOINT` (sentinel `disabled` allowed) | `BYOK_OBSERVABILITY_REQUIRED` | none |
| ingress | `INGRESS_BASE_URL` | `BYOK_INGRESS_REQUIRED` | none |
| pgbouncer | `DATABASE_URL` | `BYOK_DATABASE_REQUIRED` | none |
| dev-tools | `SMTP_HOST` | `BYOK_SMTP_REQUIRED` | production only |

First-violation-only: rows are evaluated in declaration order; the first miss emits ONE fatal record and exits 1.

### 3. Fatal record (example — storage row, S3_ENDPOINT unset)

```json
{
  "level": 60,
  "time": 1778777141042,
  "pid": 5738,
  "hostname": "...",
  "name": "boot",
  "event": "byok.required",
  "code": "BYOK_STORAGE_REQUIRED",
  "overlay": "storage",
  "missing": ["S3_ENDPOINT"],
  "hint": "Set the missing env(s) OR enable the overlay (docker compose -f docker-compose.yml -f compose/docker-compose.storage.yml up).",
  "msg": "BYOK env missing for disabled overlay; refusing to start"
}
```

For credential-bearing envs (e.g. `S3_ENDPOINT=https://user:secret@s3.corp/`) the `hint` field is run through the vendored `redactUrl()` helper before serialization — verified by the redaction test case (asserts the raw `secret` substring NEVER appears on stderr).

### 4. Boot-order diff (apps/api/src/index.ts)

```diff
+// Phase 14 / Plan 04 / Task 3 — BYOK boot guard. MUST run BEFORE the
+// OTel SDK import side-effect below: a misconfigured OTLP endpoint
+// would otherwise cause cascading dial noise on stderr before the
+// fatal "byok.required" record reaches operators. Also runs BEFORE
+// installGlobalSSRF() to avoid wasted setup on a process about to
+// exit 1. The guard is a pure-function call that returns void on a
+// satisfied env contract — happy path adds zero overhead.
+import { assertBYOKConfig } from "@openwhispr/byok-guard";
+
+assertBYOKConfig();
+
 // Phase 6 / Plan 03 / Task 1 (D-T3 load order) — OTel SDK must start
 // BEFORE any other import resolves so `@opentelemetry/instrumentation-pino`
 // patches the `pino` module at require time. ...
 import "./otel-bootstrap.js";
 import { installGlobalSSRF } from "./bootstrap.js";

 installGlobalSSRF();
```

`apps/worker/src/index.ts` receives the same insert (before the worker's own `./otel-bootstrap.js` import).

### 5. Workspace dep additions

```diff
 // apps/api/package.json
   "dependencies": {
+    "@openwhispr/byok-guard": "workspace:*",
     "@openwhispr/contract-tests": "workspace:*",
     ...
   }
```

```diff
 // apps/worker/package.json
   "dependencies": {
+    "@openwhispr/byok-guard": "workspace:*",
     "@openwhispr/email": "workspace:*",
     ...
   }
```

### 6. `=disabled` sentinel — OTel bootstrap type propagation

Before (both files):

```ts
export const sdk = new NodeSDK({...});
export const startSdk = (target = sdk): void => { try { target.start(); } catch { ... } };
export const shutdownSdk = (target = sdk): Promise<void> => target.shutdown().catch(...);
```

After:

```ts
const OTEL_DISABLED = process.env.OTEL_EXPORTER_OTLP_ENDPOINT === "disabled";
export const sdk: NodeSDK | null = OTEL_DISABLED ? null : new NodeSDK({...});
export const startSdk = (target: NodeSDK | null = sdk): void => {
  if (target === null) return;
  try { target.start(); } catch { ... }
};
export const shutdownSdk = (target: NodeSDK | null = sdk): Promise<void> => {
  if (target === null) return Promise.resolve();
  return target.shutdown().catch(...);
};
```

The worker also gates `PeriodicExportingMetricReader` + `OTLPMetricExporter` construction behind `OTEL_DISABLED` (the exporter would otherwise open a default gRPC channel at construction time).

## Test coverage

- `packages/byok-guard/`: 21 cases, **100/100/100/100** (lines/branches/functions/statements).
- `apps/api/src/otel-bootstrap.test.ts`: 4 new sentinel cases + 1 amended boot-order case → 12 total, all pass.
- `apps/worker/src/otel-bootstrap.test.ts` (new file): 5 cases, all pass.
- `apps/api/src/__tests__/boot-order.test.ts` (new file): 7 cases, all pass.

Total across plan-relevant suites: **46 tests passing**.

## Deviations from plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `pino.final()` does not exist in Pino 9**

- **Found during:** Task 1 GREEN
- **Issue:** CONTEXT.md decision 2 and 14-04-PLAN.md `<implementation>` block call for `pino.final(logger).fatal(...)` followed by `process.exit(1)`. Pino 9 (the version pinned at `apps/api/package.json:45` — `^9.5.0`, resolved at 9.14.0) removed the `pino.final` export entirely (deprecated since v6). `pino.final` is not on the default export and not in `pino.d.ts`. Calling it throws `TypeError: pino.final is not a function`.
- **Fix:** Replaced `pino.final(logger).fatal()` with a synchronous Pino destination — `pino({...}, pino.destination({ sync: true, dest: 2 }))`. Synchronous mode is the modern Pino-9 equivalent: every `.fatal()` write reaches the OS stderr buffer before the next JS statement executes, so `process.exit(1)` immediately after fatal can never truncate the log line. The operational invariant (no truncation on fatal+exit) is identical to what `pino.final` enforced; only the API surface changed. Exposed the constructor as the module-level `createBootLogger()` helper so the test surface can verify the discipline via direct shape assertion (the spy approach was incompatible with ESM read-only namespace bindings under Vitest).
- **Files modified:** `packages/byok-guard/src/index.ts`, `packages/byok-guard/src/__tests__/byok-guard.test.ts`
- **Commit:** `2bcb180`

**2. [Rule 1 - Bug] Existing `D-T3 first executable line` test would regress**

- **Found during:** Task 3 GREEN
- **Issue:** `apps/api/src/otel-bootstrap.test.ts` line 61-84 (pre-Phase-14) asserted that `import "./otel-bootstrap.js"` is the literal first executable line of `apps/api/src/index.ts`. The Phase-14 plan inserts the byok-guard import + call AHEAD of that line, so this test would fail.
- **Fix:** Rewrote the test to assert the first THREE executable lines are `import { assertBYOKConfig } from "@openwhispr/byok-guard";`, then `assertBYOKConfig();`, then `import "./otel-bootstrap.js";` — preserving the no-business-logic-between-the-guard-and-OTel-init spirit while explicitly documenting the Phase 14 amendment.
- **Files modified:** `apps/api/src/otel-bootstrap.test.ts`
- **Commit:** `630d969`

### Out-of-scope deferred

Pre-existing typecheck failures in `apps/api` and `apps/worker` (typed-queue / with-tenant-context / litellm-client / various test files) — verified unrelated to byok-guard or otel-bootstrap edits via `grep -i otel|sdk|NodeSDK` on the typecheck output. Logged to `.planning/deferred-items.md` under "From Plan 14-04 (Phase 14)".

## Commit chain

```
bf53462 test(14-04): add failing byok-guard unit suite (16 cases)
2bcb180 feat(14-04): implement byok-guard with per-overlay matrix and pino-9 sync flush
9a313c4 test(14-04): add red otel-bootstrap =disabled sentinel cases (api + worker)
b523625 feat(14-04): add OTEL_EXPORTER_OTLP_ENDPOINT=disabled sentinel in api + worker
fed52c3 test(14-04): add red boot-order test for byok-guard wiring
630d969 feat(14-04): wire @openwhispr/byok-guard before SSRF + OTel in api and worker
```

Strict TDD chain: each `feat` commit is preceded by a `test` commit that lands the failing assertions for the same surface. Tests and code land in coupled pairs per the project's TDD discipline.

## Self-Check: PASSED

- File existence verified for all 9 created and 8 modified files (see Self-Check section below).
- Commit hashes verified present in `git log`.
- All 46 plan-relevant tests pass.
- Coverage on `packages/byok-guard/` = 100/100/100/100.
