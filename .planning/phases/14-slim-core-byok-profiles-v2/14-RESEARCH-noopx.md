# Worker noopX research — Phase 14 BYOK-03

## Current noopX usage

Both noopX adapters are constructed in `apps/worker/src/index.ts:79-94` and injected
exclusively into the `virtualKeyRotation` BullMQ worker at `apps/worker/src/index.ts:137-145`.
They appear nowhere else in `apps/worker/src/jobs/` — only one job handler depends on
either of them:

- `apps/worker/src/jobs/virtual-key-rotation.ts` defines both `LiteLlmKeyClient`
  (`generateKey({tenant_id,user_id}) → {key_id}` / `deleteKey({key_id})`) and
  `UserKeyLookup` (`loadCurrentKeyId(userId) → string|null` /
  `storeNewKeyId(userId, newKeyId) → void`) as the minimal collaborator interfaces.
- `apps/worker/src/scheduler.ts:91-98` enqueues a **sentinel** weekly cron tick
  with `{tenant_id: NIL_UUID, user_id: NIL_UUID, reason: "scheduled"}` —
  the file header explicitly says "production dispatcher iterates the user/tenant
  table to fan-out per-user children" and "on-demand rotation goes via
  /api/admin/keys/rotate (Plan 06-09)".
- **Neither** the per-user fan-out dispatcher **nor** `/api/admin/keys/rotate` has
  been implemented yet (no matches in `apps/api/src/routes/`). The Zod schema
  `virtualKeyRotationSchema` will REJECT the nil-UUID sentinel itself
  (`z.string().uuid()` does not exclude nil-UUID, so the schema *passes*; the
  handler then opens a `set_config('app.tenant_id', '00000000-…')` transaction
  that will fail RLS lookups but not error before reaching the noop).

What's missing in the supporting infrastructure:

1. `@openwhispr/litellm-client` **does not expose `/key/generate` or `/key/delete`** —
   `packages/litellm-client/src/index.ts` only exports `chatCompletions`,
   `chatCompletionsStream`, `audioTranscriptions`, and `passthrough`. Building a
   "real LitellmKeyClient" means **extending the client package** with two new
   methods (using the already-loaded `LITELLM_MASTER_KEY` + `LITELLM_BASE_URL`).
2. `packages/data/src/schema/user_settings.ts` **has no column** for a current
   LiteLLM virtual key id. The available jsonb columns (`sttOverrides`,
   `noteRecordingOverrides`) are domain-specific and not designed to hold
   key-rotation state. A real `UserKeyLookup` therefore requires **either**
   a new migration (add `litellm_key_id text` to `user_settings`) **or** a
   semantic re-use of `user_settings` jsonb (constitutionally weaker — string
   typed inside JSON, no FK semantics, no index).

## noopSender precedent (Phase 13)

Commit `17c603e` (`feat(13-01): ship e2e-cjm harness + worker EmailSender + …`)
closed `noopSender` by:

1. Extracting the real implementation into a **new shared package** (`@openwhispr/email`)
   with a `createEmailSender({log, env})` factory.
2. The factory **throws at construction time** when `NODE_ENV === "production"` and
   `SMTP_HOST` is unset (`packages/email/src/EmailSender.ts:74-83` —
   `"SMTP_HOST is required in production (event:email.smtp_required_in_production)"`).
3. In non-prod the factory returns a fallback sender that returns
   `{delivered: false, reason: "smtp-not-configured"}` — **explicitly NOT** the prior
   silent `{delivered: true}` lie. The worker treats this as a non-fatal skip.
4. `apps/worker/src/index.ts:74` swaps `const noopSender = …` for
   `const realSender = createEmailSender({log, env: process.env})`. The boot
   crash happens at `createEmailSender(…)`, before any BullMQ worker is constructed.

The canonical pattern is therefore: **real adapter as the only path; loud-fail in
prod at construction; documented non-prod fallback that does NOT lie** ("never
swallow" is named in the file header as Pitfall #4).

## Adapter 1: noopLitellmKeyClient

### Current behavior + usage sites

`apps/worker/src/index.ts:79-86` — returns `{key_id: "noop-" + Date.now()}` on
`generateKey`, no-ops on `deleteKey`. Injected only into the
virtual-key-rotation worker. The interface is **two HTTP calls to LiteLLM**:
`POST /key/generate` and `POST /key/delete` (both standard LiteLLM Proxy
endpoints already authenticated by the worker's `LITELLM_MASTER_KEY`).

Crucially, **`@openwhispr/litellm-client` does not currently implement these
methods.** A "real adapter" therefore means *adding* `generateKey` / `deleteKey`
to the shared client package, OR writing a worker-local thin client.

### Comparison

| Option | Effort | Test surface | Closes feature gap | Risk |
|--------|--------|--------------|--------------------|------|
| 1. Real adapter via @openwhispr/litellm-client (extend package with `generateKey`/`deleteKey`) | Medium — new methods on shared client, factory in worker, unit tests with undici MockAgent. ~3 files, 1 new dep on existing client | BullMQ + LiteLLM HTTP (already covered for transcribe/reason via MockAgent; same harness extends here) | YES — actual rotation will work end-to-end once API route lands | Mid: introduces /key/generate semantics that need version-pinning against LiteLLM v1.83.7-stable+; new methods need contract tests |
| 2. Loud-fail at worker boot when LITELLM_BASE_URL+LITELLM_MASTER_KEY absent (mirror noopSender prod gate) | Low — ~5 lines in worker entry mirroring `createEmailSender`'s prod gate; no shared package change | Just one boot-time assertion test | NO — even with config present, the worker would still need a real adapter to actually rotate; this option alone leaves rotation non-functional | Low: if env present, the rotation worker BOOTS but every job still hits a stub or crashes — false sense of safety |
| 3. Hybrid: extend client package + loud-fail at boot + remove noop entirely | Medium-high — option 1 work + option 2 gate, no fallback path | Same as option 1 + boot-gate test | YES — and prod misconfig is caught at boot | Mid: same as option 1; pattern matches noopSender precedent exactly |

### Recommendation: **Option 3 (Hybrid)**

The noopSender precedent IS option 3: a real adapter that **also** loud-fails on
prod misconfig, with no silent fallback in the worker entry. The constitutional
"no internal mocks in production code" rule means option 2 alone is insufficient
(noop stays, just with a guard around its non-use). Option 1 alone is
insufficient because Phase 14's BYOK-02 explicitly requires loud-fail on
misconfigured prod env.

**Caveat:** the per-user fan-out dispatcher and `/api/admin/keys/rotate` are
**not implemented**. Even with a real LitellmKeyClient, the weekly cron tick
will fail at the schema/RLS layer on the nil-UUID sentinel. The cron schedule
itself may need to either become a no-op-by-design dispatcher stub (with its
own loud-fail when a real dispatcher route is missing) or be **disabled until
the dispatcher lands**. This is a separate scope question for the phase plan —
NOT a justification for keeping `noopLitellmKeyClient` (which is unconditionally
a constitutional violation).

## Adapter 2: noopUserKeyLookup

### Current behavior + usage sites

`apps/worker/src/index.ts:87-94` — returns `null` from `loadCurrentKeyId`,
no-ops on `storeNewKeyId`. Only consumer is the virtual-key-rotation handler
(`apps/worker/src/jobs/virtual-key-rotation.ts:67,77`).

The interface implies persistent storage of "the user's currently-active LiteLLM
key id". The natural home is `user_settings` (RLS-isolated by `tenant_id`), but
**no `litellm_key_id` column exists** today. The existing `api_keys` table is
for inbound bearer tokens to OUR API (Argon2id-hashed `key_hash`), not for
outbound LiteLLM virtual keys held on the user's behalf. The two are unrelated.

The schema gap means a "real adapter" requires:
- A new migration adding `litellm_key_id text` (or `bytea` if encrypted) to
  `user_settings`, OR
- A `pgcrypto`-encrypted store (consistent with `@openwhispr/data`'s `encryption/`
  subdir — secret material).

### Comparison

| Option | Effort | Test surface | Closes feature gap | Risk |
|--------|--------|--------------|--------------------|------|
| 1. Real adapter via @openwhispr/data drizzle queries + new migration adding `user_settings.litellm_key_id` (encrypted) | High — migration + drizzle schema change + encryption integration + RLS-isolation property test + unit tests | DB (real Postgres via testcontainers, RLS isolation) + drizzle codegen | YES — full rotation persistence | High: schema change requires Phase 14 to ship a migration; encrypted-at-rest contract (D-A7 in the job file says "store encrypted") needs the same pgcrypto plumbing already used elsewhere |
| 2. Loud-fail at worker boot when DATABASE_URL_OWNER absent (already required for appOwnerPool; effectively a no-op gate today) | Low — assertion already implicit; explicit assertion ~3 lines | One boot-time assertion test | NO — DATABASE_URL is already required; the noop stays installed, and the rotation job would crash on the first non-sentinel enqueue regardless | Low: pure documentation of an already-true invariant; does not remove the constitutional noop |
| 3. Hybrid: schema migration + real adapter + loud-fail at boot | High — option 1 + a thin boot assertion | Same as option 1 + boot-gate test | YES — same as option 1 | High: scope creep into Phase 14 — adds a feature-bearing migration to a phase whose theme is BYOK/slim-core configuration, not feature work |
| 4. Defer feature, **delete noop + delete virtual-key-rotation worker registration entirely**, scheduler stops enqueuing the cron, route stays unimplemented | Low — remove ~30 lines from worker entry + scheduler.ts cron tick; reroute via Phase 15+ once `/api/admin/keys/rotate` is planned | Removed surface — net negative | YES (correctly: there is no feature to close in Phase 14) | Low-Mid: must verify nothing else depends on the queue handle; loses cron heartbeat for an unused feature — acceptable since no API path enqueues real payloads |

### Recommendation: **Option 4 (Delete the entire virtual-key-rotation wiring) — primary; Option 3 — fallback if user wants the feature in Phase 14 scope**

Rationale: Both noops feed *only* the virtual-key-rotation worker, whose
production driver (`/api/admin/keys/rotate` route + per-user fan-out
dispatcher + `user_settings.litellm_key_id` column) **is not implemented**.
The cron currently enqueues a nil-UUID sentinel that cannot succeed. Closing
the audit by replacing noops with real adapters means **building three
missing pieces** (client method + DB column + API route) — that is a feature,
not an audit closure, and the phase theme (Slim Core + BYOK) does not call
for it (REQUIREMENTS.md BYOK-03 says "replace with real adapters **or
loud-fail**", which is satisfied by removing the dead wiring).

Option 4 closes the constitutional violation by removing the noop entirely
(no stub left in production code) AND removes the dead cron tick. Option 3 is
only justified if Phase 14's scope explicitly absorbs key-rotation feature
work — which the ROADMAP entry does NOT mention.

For **adapter 1 (LitellmKeyClient)**, option 4 likewise applies symmetrically:
if the rotation worker goes away, the LitellmKeyClient interface in
`virtual-key-rotation.ts` becomes dead code along with the noop. The
recommendation for adapter 1 therefore collapses to: **delete the rotation
worker wiring along with both noops**.

## Final per-adapter recommendation

- **noopLitellmKeyClient**: delete (together with the virtual-key-rotation
  worker registration in `index.ts:137-145` and the cron tick in
  `scheduler.ts:91-98`). If the feature is later wanted, follow noopSender's
  pattern: extend `@openwhispr/litellm-client` with `generateKey`/`deleteKey`
  and loud-fail in prod when config absent.
- **noopUserKeyLookup**: delete (same removal scope — both noops are consumed
  by the same worker). If later wanted, add `user_settings.litellm_key_id`
  via a phase-specific migration and back it with `@openwhispr/data` drizzle
  queries.

This collapses BYOK-03 into a single mechanical removal commit, satisfies the
"or loud-fail" branch of the requirement (by removing the unsafe path
entirely), and avoids feature scope-stretch into Phase 14.

## Open questions for the user

1. **Is virtual-key-rotation in Phase 14 scope?** ROADMAP Phase 14 success
   criteria do not mention it; REQUIREMENTS BYOK-03 says "real adapters OR
   loud-fail". If rotation is meant to be live in Phase 14, recommendation
   shifts to Option 3 for both adapters (and requires three new pieces of
   work: client methods, DB column, API route).
2. **If we delete the rotation worker registration, what about the existing
   tests?** `apps/worker/src/scheduler.test.ts` covers the virtual-key-rotation
   cron — they would need to be deleted in the same commit (no orphan tests).
3. **Is the file-header comment on `virtual-key-rotation.ts` (D-A7) saying
   the SECRET must be stored encrypted in `user_settings`/`tenant_settings`
   still authoritative?** That implies pgcrypto-encrypted storage of the
   returned `key` (not just `key_id`), which is a larger design surface than
   the current `UserKeyLookup` interface (which only persists the id).
4. **Confirm Phase 14 does NOT intend to introduce new migrations.** If
   migrations are out-of-scope for Phase 14, options 3 for adapter 2
   becomes unavailable and option 4 is the only remaining path.
