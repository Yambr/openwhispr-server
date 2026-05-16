# Re-Review: packages/data — v2.2 milestone close audit

**HEAD:** b830cc4
**Baseline:** `.planning/review/data.md` @ 9ff5040
**Reviewed:** 2026-05-16

## Summary

- BLOCKER (CRITICAL): 0
- WARNING: 7 (4 OPEN carry-forward + 3 NEW)

## 9-Category Result

1. Migration 0018 RLS NULLIF pattern present & used — **PASS**
2. Migrations 0019/0020 envelope encryption (48 bytea sidecars + plaintext drop) — **PASS**
3. LOCKER-08 zero `text("access_token"|...)` in schema — **PASS**
4. encryption/{envelope,lens,boot}.ts present and wired — **PASS** (auth.ts:319 wrapAdapter, index.ts:82 validateEncryptionBoot)
5. No raw SQL template strings with user input — **PASS with note** (NEW-01 below)
6. migrate.ts LiteLLM-init idempotent — **PASS** (shouldSkipLitellmDbAutocreate escape hatch)
7. 0021 _safe_table_reset SECURITY DEFINER — **PASS** (search_path locked, REVOKE PUBLIC, GRANT owner-only)
8. TENANT_SCOPED_TABLES drift — **NOT VERIFIED** (no programmatic parity test)
9. Suppressed warnings / disabled tests — **PASS**

## Closure delta

| ID | Original | Status |
|---|---|---|
| CR-01 ALTER ROLE app.tenant_id default | CRITICAL | **CLOSED** (0018) |
| CR-02 OAuth tokens plaintext | CRITICAL | **CLOSED** (0019/0020 + lens wired) |
| HI-01 migrate.ts LiteLLM autocreate escape | HIGH | **CLOSED** (Phase 41.e shouldSkipLitellmDbAutocreate) |
| HI-02 TRUNCATE in 0005 destructive | HIGH | **CLOSED** via 0021 helper |
| HI-03 OAuth no TTL enforcement | HIGH | **CLOSED** via lens expiresColumn gate |
| HI-04 column DEFAULT bound to GUC | HIGH | **CLOSED** (0018 DROPs DEFAULTs) |
| MD-01 encryption module dead | MED | **CLOSED** |
| MD-02 Vault/Kms stubs | MED | **CLOSED** (boot.ts EX_CONFIG refuse) |
| MD-03 client.ts pool max hardcoded | MED | **OPEN** WARNING |
| MD-04 FIXTURE_PASSWORD exported | MED | **OPEN** WARNING |
| MD-05 SEED_*_ID UUIDs exported | MED | **OPEN** WARNING |
| LO-01 session_lookup_by_token no audit | LOW | partial (companion fn DROPped) |
| LO-02 TENANT_SCOPED_TABLES drift test missing | LOW | **OPEN** WARNING |

## New findings

### NEW-01 — backfill SQL identifier interpolation lacks pgIdent whitelist
- File: `packages/data/src/encryption/backfill.ts:108-168`
- Issue: `runBackfill` interpolates table/column names directly into SQL via `"${name}"`. Today author-controlled (CLI), but exported public; future caller might wire operator input.
- Fix: pgIdent whitelist regex at the loop entry (mirror `migrate.ts:43`).

### NEW-02 — oauth-state-codec plaintext fallback dead post-0020 but ungated
- File: `packages/data/src/encryption/oauth-state-codec.ts:93-95`
- Issue: `decryptCodeVerifierFromRow` falls back to `row.code_verifier` (plaintext) when sidecars are absent. After 0020 drops the column, branch is unreachable in production — but it remains defensive code that would happily surface plaintext if a future migration accidentally re-introduced the column.
- Fix: replace fallback with explicit throw; or gate behind `OPENWHISPR_OAUTH_STATE_PLAINTEXT_FALLBACK=1` (off by default).

### NEW-03 — validateMasterKek silent base64url decode
- File: `packages/data/src/encryption/boot.ts:84-96`
- Issue: `Buffer.from(raw, "base64url")` silently drops chars outside the alphabet. Length check passes if the alphabet-only prefix decodes to 32 bytes. Silent footgun, not exploitable.
- Fix: round-trip check `decoded.toString("base64url") === raw.replace(/=+$/, "")`.

## Constitutional Lockers (data scope)

- LOCKER-02: PASS (only single `as <T>` casts)
- LOCKER-03: PARTIAL (SEED_*_ID literals in src/seed/, allowlisted but worth re-confirming)
- LOCKER-05: N/A (no Error subclasses carry response-body fields)
- LOCKER-06: N/A (no child_process in packages/data/src/)
- LOCKER-08: PASS

## Verdict

No BLOCKERs. Two CRITICALs closed end-to-end. 4 open WARNINGs + 3 new WARNINGs → v2.3 backlog. MD-04 (FIXTURE_PASSWORD without `NODE_ENV != production` guard on seed function) is the highest-priority remaining item — could land in production via `seedConformanceFixtures()` if an operator wires it.
