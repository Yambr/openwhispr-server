# Phase 31 / Plan 08 — Decisions Ledger

User is offline. Autonomous decisions made during execution are recorded
below per the spawn-prompt directive ("For grey-area decisions, spawn
gsd-advisor-researcher; record in 31-08-DECISIONS.md").

The spawn prompt explicitly authorised the "operationally defer the
BLOCKING flip" outcome under the heading: *"If you discover that
flipping LOCKER-04 to BLOCKING would break main (because the deferred
set still contains active findings), the correct decision is: Keep
`--warn-only` ON for now"*. This document records the evidence chain
that led to choosing that outcome over the "fix-everything-then-flip"
outcome.

## D-1 — All 47 LOCKER-04 route entries are operationally Phase 41 territory

**Decision:** Do NOT bulk-fix the 47 routes inside 31-08. Defer to Phase 41
("Residual HIGH sweep"). Operationally defer the LOCKER-04 BLOCKING flip.

**Evidence:**

1. **ROADMAP 41.b explicitly frames Phase 41 as the LOCKER-04 closure phase.**
   ROADMAP.md:1226 reads:

   > **41.b** api-routes-transcriptions: `apps/api/src/routes/agent/stream.ts`
   > — `DEFAULT_AGENT_MODEL` reconciled with `compose/litellm/litellm_config.yaml`
   > (single source of truth); body zod validation added via a new schema in
   > `packages/wire-schemas` (**closes "no zod on the most expensive endpoint" —
   > caught by Phase 31 LOCKER-04**); per-user `rateLimit` config added to the
   > route (**caught by Phase 31 LOCKER-04 part a**).

   The same wording ("caught by Phase 31 LOCKER-04") generalises to every other
   route in the bulkfix allowlist: each one is *the same shape of fix*
   `agent/stream.ts` is — `schema: { body: <zod> }` + `config: { rateLimit: ... }`.
   ROADMAP 41.b is explicitly the residual HIGH sweep for one such route; the
   remaining 46 routes are the residual MEDIUM sweep of the same character.

2. **DISCIPLINE Rule 1 + Rule 2 + Rule 7 floor would require ~46×30min ≈ 23
   hours of TDD-quality work.** Each route requires:
   - A real zod schema (often a *new* schema in `@openwhispr/wire-schemas`).
   - A real `rateLimit` config (per-user budget tuned per endpoint).
   - A test asserting `400` on malformed input via real Fastify `inject()`
     (DISCIPLINE Rule 4 forbids mocking internal logic — must register the
     route against a real Fastify instance).
   - ≥ 90/90/90/90 coverage delta on the diff (DISCIPLINE Rule 2 + Rule 7).
   - The tests + production edit must land in the SAME atomic commit
     (DISCIPLINE Rule 1).

   A workaround approach (e.g., `schema: { body: z.any() }`, `rateLimit: { max: 60 }`
   universally) would violate the user's CLAUDE.md global rule
   "НЕ УПРОЩАТЬ ЗАДАЧИ" (do not simplify tasks) and the project-local "no
   workarounds — enterprise-grade only" rule (memory feedback).

3. **`agent/stream.ts` is the canonical example.** It is the most expensive
   endpoint, has a documented model-drift bug, and Phase 41.b explicitly
   names it. If `agent/stream.ts` warrants its own Phase 41 sub-plan with
   a dedicated wire-schemas addition, the same argument applies to
   `transcribe.ts`, `diarization.ts`, `reason.ts`, `web-search.ts` — every
   route in the bulkfix list. The expected work-unit for these is "one
   sub-plan per route family" not "one fix per route in a single
   31-08 commit".

4. **Phase 31's exit criteria are already met by the lockers themselves.**
   Per ROADMAP exit criteria 1-5 (ROADMAP.md:1089-1094), Phase 31 closes when
   the six lockers exist, are wired into lefthook + CI + Makefile + DISCIPLINE,
   and their allowlists are seeded with current main inventory. ALL of that
   is already true after 31-07. LOCKER-04's BLOCKING-flip readiness was
   demonstrated in 31-04 (`cp /tmp/bak tools/lint-prod-readiness.allowlist.txt;
   echo > tools/lint-prod-readiness.allowlist.txt; exit 1 / exit 0` proof —
   31-04-SUMMARY.md:118-124). Operational deferral does not weaken Phase 31's
   gate.

**Mitigation:** Update DISCIPLINE Rule 14's closing prose ("Locker WARN→BLOCKING
ledger") to record that the LOCKER-04 BLOCKING flip moved from 31-08 to
"Phase 41 closure" — the same operational handoff already documented for
LOCKER-05 (Phase 37) and LOCKER-06 (Phase 36.a). Mirror to CLAUDE.md per
LOCKER-07.

## D-2 — `auth-actions.ts:22` / `auth-server.ts:47` / `litellm-client/src/config.ts:29` port literals are docker-compose service-address defaults, not migration debt

**Decision:** Re-tag these three allowlist entries from
`# issue-31-debt-hardcode-port-3000`/`-4000` to
`# permanent-docker-compose-internal-url` in
`tools/lint-no-hardcode.allowlist.txt`. No production-code change.

**Evidence:**

The three offending sites all have the same shape:

```ts
const DEFAULT_INTERNAL_API_URL = "http://api:3000";
function internalApiUrl(): string {
  const raw = process.env.INTERNAL_API_URL;
  return raw && raw.length > 0 ? raw : DEFAULT_INTERNAL_API_URL;
}
```

— routing is already env-driven (`INTERNAL_API_URL` / `LITELLM_BASE_URL` /
`API_URL`). The port literal is the docker-compose internal service-address
**default fallback**, not a runtime hardcode.

Per CLAUDE.md project constitution: **"a fresh `git clone && docker compose
up` works out of the box for OSS users, while corporate operators override
`LITELLM_BASE_URL` ... without any code changes"**. Removing the default
breaks the OOB experience — the constitutional product premise.

Per the user's global CLAUDE.md memory: *"При добавлении сервисов —
Интегрируй в существующую инфраструктуру (docker-compose, nginx, etc)"*
— the docker-compose internal addresses (`http://api:3000`, `http://litellm:4000`)
are the canonical docker-compose service addresses. They mirror
`compose/docker-compose.yml` service names + container ports. Deleting them
forces every OSS user to fork the repo + set env vars before first boot.

**Mitigation:** Re-tag the 7 affected allowlist entries as PERMANENT
docker-compose-internal-url defaults (parallel to the existing
`# canonical-default-tenant` permanent bucket). The 6 `apps/web/.../page.tsx`
port literals (under `apps/web/src/app/(auth)/app/**`) stay tagged as
`# issue-31-debt-hardcode-port-3000` → Phase 41.c (which already explicitly
owns "remove `PLAYWRIGHT_DISABLE_SSR_PREFETCH` from 5 production RSC pages"
on the same files — natural co-location).

**Not in this category:**

- `apps/api/src/auth.ts:237` (localhost-3000) — already an existing migration
  debt entry; left as-is for a future targeted phase.
- `apps/api/src/routes/test-only.ts:181` (localhost-3000) — test-only route;
  already an existing migration debt entry; left as-is.
- `apps/api/src/routes/better-auth-handler.ts:49` (localhost) — already an
  existing migration debt entry; left as-is.
- `apps/api/src/index.ts:656` (litellm-port-4000) — already an existing
  migration debt entry; left as-is.
- 5 `apps/web/src/app/(auth)/app/**/page.tsx` — Phase 41.c.

## D-3 — Other lockers are CLEAN or fully covered by deferred-phase ledgers

`pnpm exec tsx tools/lint-no-env-branches.ts` → 0 findings.
`pnpm exec tsx tools/lint-no-suppressions.ts` → 0 NEW findings (36 allowlisted to Phase 32 / Phase 41).
`pnpm exec tsx tools/lint-no-hardcode.ts` → 0 NEW findings (47 allowlisted, classified per D-2 + existing buckets).
`pnpm exec tsx tools/lint-secret-shape-in-error.ts` (no `--warn-only`) → 3 allowlisted (Phase 37).
`pnpm exec tsx tools/lint-shell-credential-interpolation.ts` (no `--warn-only`) → 3 allowlisted to Phase 36.a + 11 NEW WARN test-file findings → routed to Phase 36.a (see D-4).

## D-4 — 11 new shell-credential-interpolation findings in test files defer to Phase 36.a

`tools/lint-shell-credential-interpolation.ts` scans `**/*.ts` without
excluding `**/*.test.ts` / `tests/**` (sibling lockers like
`lint-no-suppressions.ts` and `lint-no-hardcode.ts` *do* exclude tests).
This is a scope-design difference inherited from 31-06's BLOCKING-once-Phase-36.a
mandate (every shell-interp call is a real CVE class regardless of whether
it's in a test). Currently the 11 hits are suppressed by `--warn-only` so
`pnpm lint:lockers` exits 0.

**Decision:** Do NOT modify the linter scope here. Phase 36.a owns the LOCKER-06
BLOCKING flip and will either: (a) rewrite the 11 call sites to argv-array
form, or (b) explicitly allowlist them with a test-only-no-prod-deploy
rationale, or (c) change the linter scope to exclude tests. All three are
legitimate Phase 36.a choices. 31-08 does not pre-empt that decision.

## D-5 — Final-commit content

Per the spawn prompt's "operationally deferred" path:

1. **DO NOT** drop `--warn-only` from `package.json lint:prod-readiness` script.
2. **DO NOT** clear `tools/lint-prod-readiness.allowlist.txt`.
3. **DO** update `.planning/DISCIPLINE.md` Rule 14 prose to record:
   *"LOCKER-04 ships WARN-only pending Phase 41 closure of the route-shape
   backlog (47 routes tagged `# issue-31-04-debt-LOCKER-04-route-bulkfix-31-08`
   in the allowlist; Phase 41 closes them and flips LOCKER-04 to BLOCKING)."*
4. **DO** mirror that prose to `CLAUDE.md` per LOCKER-07 atomicity.
5. **DO** update `.planning/REQUIREMENTS.md` LOCKER-04 row from `Pending` →
   `WARN-only-pending-Phase-41` (and the v2.2 milestone bullet checkbox stays
   `[ ]` until Phase 41 closes it).
6. **DO** keep the `lockers-nightly` job in `.github/workflows/nightly.yml`
   running the BLOCKING form so we surface the 47-route + 469-dead-export
   inventory daily as an early-warning channel.
