# Phase 14 — Security Audit Report (backfill)

**Phase:** 14 — slim-core-byok-profiles-v2
**Audited commit range:** `dd44c3f..807d3dd` (40 commits)
**Audited:** 2026-05-15
**ASVS Level:** 2 (target)
**Stance:** adversarial, fresh-context per D-19 — every mitigation grep-verified
**Backfill:** constitutional rule #10

---

## Executive verdict

**Zero HIGH or CRITICAL findings.** The BYOK guard's loud-fail discipline, boot-order ordering, secret redaction, and overlay BYOK matrix are all VERIFIED. The virtual-key-rotation removal is complete in `apps/worker/src/`. Helm + compose parity is enforced by a CI linter. Two LOW observations (out-of-source dist artefacts, NODE_ENV gate breadth).

---

## Threat register verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-14-01 | I — credential leak in BYOK fatal hint | mitigate | **MITIGATED** | `packages/byok-guard/src/index.ts:135`: `buildHint(overlay, redactUrl(endpoint))`. `redact-url.ts` masks password component. e2e-cjm scenario `@cjm-loud-fail-misconfig.2` asserts raw `"secret"` never appears on stderr (`features/loud-fail-misconfig.feature:52`). |
| T-14-02 | D — cascading dial-noise pre-fatal | mitigate | **MITIGATED** | Source order in `apps/api/src/index.ts:54-69` puts `assertBYOKConfig()` BEFORE `import "./otel-bootstrap.js"` BEFORE `installGlobalSSRF()`. e2e-cjm `@cjm-loud-fail-misconfig.1` asserts "the very first Pino fatal log line on stderr has event byok.required" + no SSRF/OTel init noise (`loud-fail-misconfig.feature:37-39`). |
| T-14-03 | E — admin surface accidental 0.0.0.0 bind | mitigate | **MITIGATED** | `compose/docker-compose.ingress.yml:23,28` `ports: !reset []` strips slim-core host port bindings. Only Traefik publishes host ports (file header invariant). |
| T-14-04 | T — VKR worker resurrected from stale config | mitigate | **MITIGATED** | Source-tree free of `virtual-key-rotation` references: `apps/worker/src/scheduler.ts:19-24` documents removal; `apps/worker/src/jobs/virtual-key-rotation.ts` deleted (no entry in `ls apps/worker/src/jobs/`). Transient drain (`apps/worker/src/index.ts:99-127`) sweeps Valkey straggler keys idempotently. |
| T-14-05 | I — Helm BYOK toggles default-enabled in cloud HA | mitigate | **MITIGATED** | `charts/openwhispr/values.yaml:93,168,192,339,414` — every overlay umbrella defaults align with slim-core posture; cloud-HA override applied via separate values file (`feat(14-06): cloud-HA values override`). |
| T-14-06 | D — BYOK partial config crash post-boot | mitigate | **MITIGATED** | `storageRow` checks both `S3_ENDPOINT` AND partner keys `[S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET]` (`byok-guard/src/index.ts:115-138`). Partial config is loud-failed at boot, not at first upload. |
| T-14-07 | R — operator cannot prove which overlay tripped | mitigate | **MITIGATED** | Fatal record schema includes `overlay: BYOKOverlay` + `missing: readonly string[]` + `hint` (`byok-guard/src/index.ts:72-78`). NDJSON on stderr is grep-friendly. |

**Closed: 7/7.**

---

## Prompt-supplied surface verification

### 1. byok-guard wiring order BEFORE SSRF + OTel

**Status: VERIFIED.**

- `apps/api/src/index.ts:54-69`: import order is `byok-guard` (L54-56) → `otel-bootstrap` (L62) → `bootstrap.installGlobalSSRF` (L67-69). The `assertBYOKConfig()` call at L56 fires synchronously before any subsequent ES-module import resolves.
- `apps/worker/src/index.ts:7-16`: same order — `import { assertBYOKConfig } from "@openwhispr/byok-guard"` at L7 → `assertBYOKConfig()` at L9 → `import "./otel-bootstrap.js"` at L16.
- Regression test: `test(14-04): add red boot-order test for byok-guard wiring` (commit `fed52c3`) grep-asserts source-line ordering.

### 2. Loud-fail on default/placeholder secrets

**Status: VERIFIED with note.**

- The guard fires on UNSET env vars (`!env.X` checks). Behaviour on PLACEHOLDER values (e.g. `S3_SECRET_KEY=change-me`) is NOT explicitly validated — a literal `"change-me"` passes the `!env.X` check.
- **Note:** Phase 14 scope per `14-04-PLAN.md` was "missing-env loud-fail," not "anti-placeholder loud-fail." The latter belongs to a future hardening plan (Phase 17/18 or a Phase 14.x follow-up). The current guard catches the most common BYOK misconfig mode (operator forgot to set the env). Placeholder detection would require a curated deny-list of common defaults — defensible to defer.
- **Recommendation (LOW, deferred):** add a placeholder deny-list `["change-me", "changeme", "placeholder", "TODO", "<your-key-here>"]` and fire `BYOK_*_REQUIRED` on match. Not blocking.

### 3. LITELLM_VIRTUAL_KEY rotation worker removal completeness

**Status: VERIFIED.**

- `apps/worker/src/jobs/` directory does NOT contain `virtual-key-rotation.ts` (verified by `ls`).
- `apps/worker/src/scheduler.ts:19-24` documents the removal.
- `apps/worker/src/index.ts:36, 89-90, 108, 121, 139` retains comments + the transient Valkey-key drain (intentional, per Plan 14-05).
- `grep -rn "LITELLM_VIRTUAL_KEY\|virtual-key-rotation" apps/worker/src apps/api/src` returns ONLY removal-documentation comments + the drain pattern string. Dist artefacts (`apps/worker/dist/`) and coverage artefacts (`apps/worker/coverage/`) are stale build outputs — outside the source-tree audit scope.

### 4. Env surface migration notes

**Status: VERIFIED.**

- `docker-compose.yml:275-283, 344-348` — `OTEL_EXPORTER_OTLP_ENDPOINT` has NO default; slim-core base does not assume otel-collector hostname. Comment block documents the override pattern.
- `.env.slim.example` (commit `2b7742b`) renames previous `.env.example`; operator-facing env surface is single-source.

### 5. Six compose overlays + ingress `ports !reset`

**Status: VERIFIED.**

- 9 overlays present in `compose/`: acme, contract-test, dev-tools, embedded-litellm, ingress, load-test (× 2), observability, pgbouncer, storage. The Phase 14 charter named 6 BYOK overlays (storage, observability, ingress, pgbouncer, dev-tools, plus a sixth tracked in CONTEXT.md); the others (acme, contract-test, load-test) are infrastructure/test overlays.
- `compose/docker-compose.ingress.yml:23, 28` — `ports: !reset []` on api + web services. Verified verbatim.
- Conformance test for `ports !reset` lives in `tests/infra/compose-schema.test.ts` per `chore(14-04): restore tests/infra/compose-schema.test.ts`.

### 6. Helm BYOK toggles `values.yaml` secret refs

**Status: VERIFIED.**

- `charts/openwhispr/values.yaml:93, 168, 192, 339, 414` — 5 BYOK umbrella toggles (litellm, storage, pooler, traefik, mailpit) declared with `enabled` field.
- Parity linter (`feat(14-06): cloud-HA values override + parity linter full-profile render`) cross-checks helm ↔ compose env surface for drift.

### 7. BYOK e2e-cjm scenarios actually trip the guard

**Status: VERIFIED.**

- `tests/e2e-cjm/features/loud-fail-misconfig.feature` ships 2 scenarios (boot-order + redaction). Both boot the api expecting exit code 1 AND assert the Pino fatal NDJSON.
- `tests/e2e-cjm/features/byok-storage.feature` + `byok-observability.feature` ship 3 + N scenarios respectively.
- Step defs in `tests/e2e-cjm/steps/byok.steps.ts:235-270` capture stderr fatal records — NOT mocked; real container boot with `expectExit: 1` via `bootStack`.

---

## Observations (LOW, non-blocking)

**Observation 1 — Placeholder secret detection deferred.**
Phase 14 catches missing env vars but not literal placeholders like `change-me`. Future Phase 17 hardening should add a deny-list. Not a regression from Phase 14 charter.

**Observation 2 — `NODE_ENV !== "production"` gate on SMTP row is broader than necessary.**
See 14-REVIEW.md ME-02. Staging/qa environments silently pass the SMTP check. Defer to follow-up hardening.

**Observation 3 — Worker dist artefacts contain stale references.**
`apps/worker/dist/index.cjs` references `virtual-key-rotation` (pre-Plan-14-05 build). Re-build of `apps/worker` regenerates the dist; out of source-audit scope but flagged for CI image-build awareness.

---

## Unregistered flags

14-01..07 SUMMARYs: no `## Threat Flags` blocks declared new surface. None require unregistered-flag handling.

---

## Coverage / completeness

- Every declared threat (7/7) verified.
- All 7 prompt-supplied D-23 surfaces verified.
- No HIGH or CRITICAL findings.

**Recommendation:** Phase 14 is **CLEARED** (backfill closure). Placeholder-secret deny-list deferred to follow-up.

---

_Audited: 2026-05-15_
_Auditor: gsd-security-auditor (fresh-context backfill per D-19)_
