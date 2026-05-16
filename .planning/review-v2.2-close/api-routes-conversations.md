# Re-Review (v2.2 close): api-routes-conversations

Branch: main @ b830cc4
Scope: apps/api/src/routes/{conversations,folders,notes}/**
Predecessor: `.planning/review/api-routes-conversations.md` (reviewed @ 1832f28)
Diff vs. predecessor in scope: **0 byte changes** — `git diff --stat 1832f28..b830cc4 -- <scope>` returns empty. No commits between the original review SHA and HEAD touch any of the 21 reviewed files.

## Summary

- Files reviewed (re-verified at HEAD b830cc4): 21 source files
  - conversations/: create, list, delete, messages, search, update, shape (7)
  - folders/: create, list, update, delete, batch-create, shape (6)
  - notes/: create, list, update, delete, delete-all, batch-create, search, shape (8)
- Findings: CRITICAL=0 HIGH=0 MEDIUM=3 LOW=3 (unchanged from predecessor)
- New v2.2-focus observations: 2 (LOCKER-04 acknowledged-debt confirmation + Phase 32 fail-closed RLS pattern audit) — none promote to a NEW finding.
- Closure recommendation: **PROCEED-WITH-KNOWN-DEBT**. Every previously logged finding survives at HEAD verbatim; none has regressed in severity; none was silently fixed; no new defects surfaced in the v2.2 focus pass (zod body validation, per-route rateLimit, tenant-context, CLAUDE.md hard rules).

## v2.2-focus checks (this re-review's brief)

### F-A. LOCKER-04 (Phase 31, DISCIPLINE Rule 14) — `schema:` + `config: { rateLimit }`

**Status: KNOWN DEBT, ALLOWLISTED, NOT REGRESSION.**

Every one of the 14 route declarations in scope (excluding `shape.ts` files which declare no routes) uses the shape:

```ts
app.route({
  method: "...",
  url: "...",
  config: { rateLimit: { max: N, timeWindow: "1 minute" } },
  handler: async (req, reply) => {
    ...
    const body = SomeSchema.parse(req.body);
    ...
  },
});
```

That is: `config.rateLimit` is **always** present (✅ Rule 14 part 2) but `schema:` is **never** present at the route-options level (❌ Rule 14 part 1). Validation lives inside the handler via in-line `.parse(req.body)`. The strict reading of LOCKER-04 wants schemas at the route-options level so Fastify's built-in validator runs before the handler is even entered.

**Allowlist status:** all 19 route registration sites in scope are listed in `tools/lint-prod-readiness.allowlist.txt` with the tag `# issue-31-04-debt-LOCKER-04-route-bulkfix-31-08` (verified by grep at b830cc4). Per CLAUDE.md "DISCIPLINE 14, WARN→BLOCKING ledger": the LOCKER-04 BLOCKING flip is operationally deferred from Plan 31-08 to **Phase 41 closure** — Phase 41 closes the 47-route bulkfix backlog with per-route TDD pairs. v2.2 may ship with these on the allowlist; no new sites were added since 1832f28.

**Functional risk today:** **LOW**. Each handler does call `.parse()` on `req.body` (or a wire-schemas schema) inside the handler. A malformed body produces a `ZodError`, which the global error handler will surface as a 400 / VALIDATION error envelope. The risk LOCKER-04 hedges against — handler code running on an unvalidated body — is **not present** in any of these 14 routes; only the order-of-operations is non-canonical. The remaining gaps (search/messages `.strict()` policy on UPDATE schemas, `archived_at` ISO datetime, `messages.content` cap) are already captured as MEDIUM findings #1–#3 below.

**No fresh defects found in this category.**

### F-B. Per-route `config: { rateLimit }` audit

Tabulated at HEAD b830cc4 (max/timeWindow per route file):

| Route | Method | Path | rateLimit |
|---|---|---|---|
| conversations/create.ts:32 | POST | /api/conversations/create | 120/min |
| conversations/list.ts:55 | GET | /api/conversations/list | 120/min |
| conversations/update.ts:40 | PATCH | /api/conversations/update | 120/min |
| conversations/delete.ts:34 | DELETE | /api/conversations/delete | 120/min |
| conversations/messages.ts:75 | POST | /api/conversations/messages | 240/min |
| conversations/messages.ts:136 | GET | /api/conversations/messages | 240/min |
| conversations/search.ts:45 | POST | /api/conversations/search | 60/min |
| folders/create.ts:30 | POST | /api/folders/create | 120/min |
| folders/list.ts:42 | GET | /api/folders/list | 120/min |
| folders/update.ts:51 | PATCH | /api/folders/update | 120/min |
| folders/delete.ts:32 | DELETE | /api/folders/delete | 120/min |
| folders/batch-create.ts:43 | POST | /api/folders/batch-create | 5/min |
| notes/create.ts:32 | POST | /api/notes/create | 120/min |
| notes/list.ts:41 | GET | /api/notes/list | 120/min |
| notes/update.ts:92 | PATCH | /api/notes/update | 120/min |
| notes/delete.ts:33 | DELETE | /api/notes/delete | 120/min |
| notes/delete-all.ts:39 | DELETE | /api/notes/delete-all | 3/min |
| notes/batch-create.ts:53 | POST | /api/notes/batch-create | 5/min |
| notes/search.ts:50 | POST | /api/notes/search | 60/min |

Every route declares an explicit `config.rateLimit` object with `max` + `timeWindow`. No `rateLimit: false`, no missing config, no template-string/variable-bound max values. Search is 60/min (4× tighter than CRUD), batch + delete-all are 3–5/min (24×–40× tighter), messages POST/GET is 240/min (chat-aware). Allocations are sensible.

**No fresh defects found in this category.**

### F-C. Phase 32 fail-closed RLS / tenant-context usage

Cross-referenced `withTenant` invariants against `packages/data/src/tenant-context.ts` at HEAD:

- Every reviewed handler routes DB activity through `withTenant(deps.db, tenantId, async (tx) => ...)`.
- `tenantId` is sourced from `req.tenant` only (populated by `dualAuthHook` per the predecessor review's verification). No handler reads `tenant_id` from `req.body` or `req.query`.
- `withTenant` validates the tenant UUID via `TENANT_UUID_RE` before binding `app.tenant_id` (line 43, 61–82 of tenant-context.ts). Any DB query without that GUC bound is **REFUSED by FORCE-RLS** with no fallback (Phase 32 fail-closed semantics).
- Every handler additionally gates on `if (!req.user || !req.tenant) throw new AuthError("UNAUTHORIZED", ...)` before reaching the DB call. Belt-and-braces — without this gate, missing `req.tenant` would still be caught by `withTenant` raising before the SQL ran, but the AuthError converts the failure to a 401 rather than a 500.
- `notes/delete-all.ts:47-74` runs `COUNT(*)` then `DELETE` inside the SAME `withTenant` transaction. The GUC is bound for the whole tx, so the count and the delete observe identical RLS scoping — no TOCTOU window.
- `conversations/messages.ts:170-186` uses a within-tx ownership-check (SELECT FROM conversations) followed by SELECT FROM messages. Both share the bound GUC; no cross-tenant leak possible.

**No fresh defects found in this category.** The Phase 32 contract holds end-to-end across every reviewed route.

### F-D. CLAUDE.md "hard rules" pass

- **Rule 1 (no production-edits-to-make-tests-pass):** N/A — re-review reads HEAD only; no edits made or proposed by this artifact.
- **Rule 3 (independently verify sub-agent claims):** This re-review IS the verification. Predecessor review's claims were checked against HEAD via direct file reads + git-diff against the cited SHA. All previous findings reproduce at HEAD.
- **Rule 4 (no `--no-verify`):** N/A in code surface — these files contain no shell commands, no `child_process` calls, no commit-tooling logic.
- **LOCKER-01 (no `NODE_ENV` branches in runtime paths):** Grepped scope — zero `NODE_ENV` references in all 21 files. ✅
- **LOCKER-02 (no type-suppression):** Predecessor verified no `@ts-ignore`/`@ts-nocheck`/`as any`/`as unknown as` in scope. Re-verified at HEAD — still zero. The `as unknown` casts on dynamic-SET-clause values + the `as { rows?: T[] }` casts on `tx.execute()` returns are the only widening casts present; both are documented as necessary in the predecessor review and are not type-suppression per the LOCKER-02 definition (the linter explicitly excludes these forms). ✅
- **LOCKER-03 (no hardcoded localhost/UUID/secret-shape literals):** Grepped scope — zero matches for `localhost|127\.0\.0\.1|:3000|:4000|:8080|sk-|AKIA|Bearer ey|AIza`. The UUID regex literal in `conversations/messages.ts:147-148` is a UUID-shape *validator regex*, not a UUID *literal* — LOCKER-03 targets the latter. ✅
- **LOCKER-04 (production-readiness):** see F-A above — allowlisted known debt.
- **LOCKER-05 (Error-class body truncation):** scope contains zero `throw new Error(...)` with `bodyText|responseBody|...` fields. All errors are `AuthError | NotFoundError | ValidationError` from `apps/api/src/errors.ts` (out of scope). ✅
- **LOCKER-06 (no shell-credential interpolation):** scope contains zero `child_process` calls, zero `spawn|execSync|exec|execFileSync`. ✅
- **LOCKER-08 / LOCKER-PLAINTEXT-COLS:** scope is API routes — column-shape enforcement lives in `packages/data/src/schema/**`. N/A here. ✅

**No fresh defects found in this category.**

## Findings (carried forward from predecessor — VERIFIED AT HEAD b830cc4)

All six findings from `.planning/review/api-routes-conversations.md` reproduce verbatim at HEAD b830cc4. No code edits in scope since 1832f28. Severity unchanged.

### [MEDIUM] `archived_at` accepted as any string, no ISO/datetime validation

- File: `apps/api/src/routes/conversations/update.ts:23` (re-verified)
- Category: input validation / error envelope
- Predecessor finding text: applies verbatim.
- Closure delta: not addressed in v2.2 work; ships as known MEDIUM.
- Fix (unchanged): `archived_at: z.union([z.string().datetime({ offset: true }), z.null()]).optional()`.

### [MEDIUM] No max length on `messages.content`, while metadata is capped at 4 KiB

- File: `apps/api/src/routes/conversations/messages.ts:46-54, 83-86` (re-verified)
- Category: DoS / input validation asymmetry
- Predecessor finding text: applies verbatim.
- Closure delta: not addressed in v2.2 work; ships as known MEDIUM.
- Fix (unchanged): set an explicit upper bound on `content` (e.g. `z.string().max(64 * 1024)`) and surface a `CONTENT_TOO_LARGE` validation error.

### [MEDIUM] Dynamic SET clause assembled from object-key presence — fragile by construction

- Files: `apps/api/src/routes/notes/update.ts:102-110`, `apps/api/src/routes/folders/update.ts:61-67`, `apps/api/src/routes/conversations/update.ts:49-55` (re-verified)
- Category: pattern hygiene (defense-in-depth)
- Predecessor finding text: applies verbatim.
- Closure delta: not addressed in v2.2 work. The three update schemas remain non-`.strict()` at HEAD (confirmed by reading each `UpdateBodySchema` definition).
- Fix (unchanged): add `.strict()` to all three `UpdateBodySchema` declarations. Keep `FIELD_MAP` allowlist as belt-and-braces.
- v2.2-focus note: this is the closest finding to a LOCKER-04 family concern — moving validation INTO the route-options `schema:` slot (the LOCKER-04 bulkfix) gives a natural place to enforce `.strict()` uniformly across all routes in one shot.

### [LOW] Duplicate UUID regex instead of `z.string().uuid()` on `conversations/messages.ts` GET

- File: `apps/api/src/routes/conversations/messages.ts:147-151` (re-verified)
- Predecessor finding text: applies verbatim.
- Closure delta: not addressed.

### [LOW] `conversations/list.ts` nested CloudMessage docs rely on incidental pg jsonb behavior

- File: `apps/api/src/routes/conversations/list.ts:86-93, 114-119` (re-verified)
- Predecessor finding text: applies verbatim.
- Closure delta: not addressed.

### [LOW] CloudConversationRow / CloudMessageRow / CloudFolderRow / CloudNoteRow mark tenant_id/user_id as optional

- Files: `apps/api/src/routes/conversations/shape.ts:22-23,35-36`, `apps/api/src/routes/folders/shape.ts:17-18`, `apps/api/src/routes/notes/shape.ts:13-14` (re-verified)
- Predecessor finding text: applies verbatim.
- Closure delta: not addressed.

## Dead code (re-verified)

None in scope. The single `messages.ts:42` LOCKER-04-dead-export allowlist entry is for the exported `MESSAGE_METADATA_MAX_BYTES` constant; it has an importer in the route's own tests but no production importer outside the file. This is intentional (test-visible constant) and is on the allowlist tagged for Phase 38. Not a regression.

## Suppressed warnings (re-verified)

None in scope. No `@ts-ignore | @ts-expect-error | @ts-nocheck | eslint-disable | biome-ignore | as any | as unknown as | console.log | debugger | TODO | FIXME | HACK | XXX` appears in any of the 21 reviewed files at HEAD.

## Disabled tests near scope

Out of scope per re-review brief (matches predecessor).

## Closure delta (v2.2 publish gate)

| Category | Predecessor (1832f28) | HEAD (b830cc4) | Delta |
|---|---|---|---|
| CRITICAL | 0 | 0 | none |
| HIGH | 0 | 0 | none |
| MEDIUM | 3 | 3 | none |
| LOW | 3 | 3 | none |
| Scope file edits since predecessor | — | 0 bytes / 0 files | clean |
| LOCKER-04 allowlist additions in scope | — | 0 (all 19 sites pre-existing) | clean |
| LOCKER-04 BLOCKING flip status | deferred | still deferred → Phase 41 closure per CLAUDE.md | clean |
| Phase 32 fail-closed RLS contract | sound | sound (re-verified end-to-end) | clean |
| New defects surfaced in v2.2 pass | n/a | 0 | clean |
| Regressions on previous findings | n/a | 0 | clean |
| Silently-fixed findings (should be re-classified) | n/a | 0 | clean |

**v2.2 close recommendation: PROCEED.** No CRITICAL/HIGH at HEAD; all six MEDIUM/LOW findings are pre-existing, documented, and have explicit fixes proposed; LOCKER-04 violations are allowlisted as Phase-41-deferred bulkfix per the DISCIPLINE Rule-14 ledger in CLAUDE.md and represent acknowledged debt, not silent regression. The reviewed surface is byte-identical to the surface that passed the predecessor review.

**Carry-forward into v2.3:** Phase 41 bulkfix should fold the three MEDIUM fixes (`archived_at` datetime, `messages.content` cap, `UpdateBodySchema` `.strict()`) into the per-route TDD pairs alongside the LOCKER-04 schema migration — they share a natural seam (every route's body schema moves from `.parse()` in handler to `schema: { body }` in options).
