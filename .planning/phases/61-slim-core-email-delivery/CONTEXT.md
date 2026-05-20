# Phase 61 — slim-core verification-email delivery (R19)

## Background

The OpenWhispr client team filed **R19** (work-order
`/Users/nick/openwhispr/.planning/phases/08-client-server-audit/SERVER-REQUIREMENTS.md`
§R19, lines ~1130-1234; client commit `275af7e7`) after a LIVE manual
probe of the cloud sign-up journey against the slim-core stack — a real
`POST /api/auth/sign-up/email` then `POST /api/auth/sign-in/email`, not
an e2e harness run.

**Severity: HIGH — breaks the real first-run user journey.** A genuine
new user cannot register and sign in:
1. `POST /api/auth/sign-up/email` → `200 {token:null, emailVerified:false}`
   (Better Auth defers the session pending verification — correct).
2. `POST /api/auth/sign-in/email` → `403 EMAIL_NOT_VERIFIED` (correct
   given an unverified user).
3. The verification email never arrives → the user is permanently
   stuck at step 2. The `OPENWHISPR_TEST_ROUTES` seed endpoint
   (R1/R13) bypasses this by minting a pre-verified user, but that is a
   test-only route — a real user has no path through.

## Root cause — verified against the live slim-core stack (2026-05-20)

`docker compose logs worker` shows the email job failing on every
attempt: `event:"email.failed"`, `ECONNREFUSED 192.168.96.2:587`,
subject `"Verify your OpenWhispr email address"`.

Two compounding defects, both confirmed:

1. **`mailpit` is NOT a service in the base `docker-compose.yml`.** It
   is deliberately confined to the overlay
   `compose/docker-compose.dev-tools.yml` (a Phase-14 decision — see
   that file's header: "No api.depends_on.mailpit re-add … slim-core api
   boot is intentionally decoupled from mailpit"). A plain
   `docker compose up -d` (no overlays) therefore has no `mailpit`
   service; `docker compose ps mailpit` → `no such service`. The
   running Mailpit container belongs to a different compose project.
   Because `mailpit` is not a service on the `openwhispr_internal`
   network, Docker DNS cannot resolve the hostname → `SMTP_HOST=mailpit`
   resolves to a stale/wrong address (`192.168.96.2`).

2. **`SMTP_PORT` is unset on a plain bring-up.** `.env:22` has
   `SMTP_HOST=mailpit` but NO `SMTP_PORT`. `packages/email/src/EmailSender.ts:117`
   defaults `SMTP_PORT` to **587** when unset. Mailpit's SMTP listener
   is on **1025**, not 587. The `compose/docker-compose.dev-tools.yml`
   overlay sets `SMTP_PORT: "1025"` on both api+worker — but that
   overlay is NOT applied in a plain slim-core bring-up. So even once
   `mailpit` resolves, the worker would still hit the wrong port.

The base `docker-compose.yml` deliberately ships NO `SMTP_PORT` (the
dev-tools overlay header explains: "it'd be lying when the overlay is
absent; the overlay owns the dev-tools wiring"). R19 changes that
calculus — the slim-core base IS the dev/test stack now (Phase 59
established `NODE_ENV=development` for it), and the base bring-up MUST
deliver email.

## Tension with the prior Phase-14 decision

The Phase-14 design deliberately kept `mailpit` out of the base compose
and the worker's email send loud-fails at runtime when `SMTP_HOST` is
unreachable. R19's bar — "a plain `docker compose up -d` (no overlays,
same bar as R6) MUST deliver verification email end-to-end" — overrides
that. The slim-core stack is the OSS-quickstart / dev-test topology
(no Traefik, plain http, `NODE_ENV=development` per Phase 59); a self-
contained mail catcher belongs in it. The dev-tools overlay's `mailpit`
+ `SMTP_PORT` entries become redundant once they move to the base — the
overlay should be left clean (no duplicate `mailpit`).

## Goal

After this phase:
1. A plain `docker compose up -d` of the slim-core stack (NO overlays)
   delivers a verification email end-to-end: a real
   `POST /api/auth/sign-up/email` results in a delivered verification
   email retrievable from the bundled Mailpit; after verification
   `POST /api/auth/sign-in/email` returns `200` with a session.
2. `docker compose logs worker` shows `email.sent`, never
   `email.failed` / `ECONNREFUSED`.
3. The fix is config/compose only (recommended R19 option (a) —
   Mailpit as a first-class slim-core service). No client change. No
   production-code change unless a genuine defect surfaces.
4. `pnpm lint:lockers` green (8 lockers); `pnpm typecheck` no new
   errors vs the 5-error baseline; `pnpm --filter @openwhispr/api test`
   + `@openwhispr/worker test` still green.
5. The client work-order `SERVER-REQUIREMENTS.md` R19 annotated CLOSED
   with the server commit SHA.

## Track summary

### Track A — Mailpit as a first-class slim-core service
R19 recommended option (a).

- Move the `mailpit` service definition from
  `compose/docker-compose.dev-tools.yml` into the base
  `docker-compose.yml` — on the `openwhispr_internal` network, same
  image (`axllent/mailpit:v1.29`), HTTP UI bound to `127.0.0.1:8025`,
  the existing healthcheck.
- Set `SMTP_PORT: "1025"` on the base `api` + `worker` service
  `environment` blocks (the value the overlay currently owns). Keep
  `SMTP_HOST` resolution working — `.env` already has
  `SMTP_HOST=mailpit`; confirm the base compose / `.env.slim.example`
  expresses the `mailpit`+`1025` pairing as the slim default.
- Remove the now-redundant `mailpit` service and the api/worker
  `SMTP_PORT: "1025"` entries from `compose/docker-compose.dev-tools.yml`
  so there is exactly one definition (no compose-merge duplication). Be
  careful: the dev-tools overlay's api/worker blocks ALSO set other
  env (`NODE_ENV`, `OPENWHISPR_TEST_ROUTES`, etc.) — only the
  `SMTP_PORT` lines and the whole `mailpit:` service move; leave the
  rest of the overlay intact.
- Decide whether `api`/`worker` should gain a `depends_on: mailpit`
  (the Phase-14 decision deliberately did NOT, so the api boot stays
  decoupled and `EmailSender` loud-fails at runtime, not boot). Keeping
  that decoupling is fine — Mailpit just needs to exist on the network;
  a hard `depends_on` is optional. Document the choice.
- Update `.env.slim.example` (and `.env.full.example` if it implies
  the dev profile) so the documented slim default is `SMTP_HOST=mailpit`
  + `SMTP_PORT=1025` and a fresh clone works OOB.

### Track B — end-to-end verification on the live stack
- Bring up a plain slim-core `docker compose up -d` (no overlays).
- Drive a REAL `POST /api/auth/sign-up/email`, read the verification
  link/token from the bundled Mailpit (`http://127.0.0.1:8025` UI or
  its `/api/v1/messages` API), complete verification, then
  `POST /api/auth/sign-in/email` → assert `200` with a session.
- Confirm `docker compose logs worker` shows `email.sent`.
- This is the R19 §"verification protocol" item 20.

## Constraints

- **Config/compose fix only** — R19 is a mail-delivery wiring defect.
  Do NOT change client code (the client correctly POSTs sign-up and
  polls `verification-status`). Do NOT change production server code
  unless Track B surfaces a genuine code defect — then CLAUDE.md hard
  rule 1 applies (HALT + deferred-items if blocked).
- **Plain bring-up bar** — the verification MUST be against
  `docker compose up -d` with NO `-f compose/…` overlays (same bar as
  R6). An overlay-only fix does not close R19.
- **No bypassing gitleaks hooks** — CLAUDE.md hard rule 4. Mailpit
  needs no credentials, but `.env.*.example` edits must not embed real
  secrets.
- **Constitutional lockers green** — `pnpm lint:lockers` (8) after the
  change. Compose/env files are mostly outside the lockers' source
  scope, but run it to be sure.
- **Single source of truth** — after the move there must be exactly
  one `mailpit:` service definition and one `SMTP_PORT` declaration
  per service; no compose-merge shadowing.
- **EN-only** source artifacts.

## Verification gate

Phase passes when:
1. `mailpit` is a service in the base `docker-compose.yml`;
   `docker compose ps mailpit` (plain, no overlay) shows it Up+healthy.
2. `compose/docker-compose.dev-tools.yml` no longer redefines
   `mailpit` or the api/worker `SMTP_PORT` (no duplication); the
   overlay still applies cleanly on top of the base.
3. Live: plain `docker compose up -d` → real `POST /api/auth/sign-up/email`
   → verification email present in Mailpit → verify → `POST
   /api/auth/sign-in/email` returns `200` with a session.
4. `docker compose logs worker` shows `email.sent`, zero
   `ECONNREFUSED` / `email.failed`.
5. `pnpm lint:lockers` green (8); `pnpm typecheck` 5-baseline;
   `api` + `worker` test suites green.
6. `git log --oneline` shows the expected commit(s).
7. Client `SERVER-REQUIREMENTS.md` R19 annotated CLOSED + server SHA.

## Reference

- Client work-order: `/Users/nick/openwhispr/.planning/phases/08-client-server-audit/SERVER-REQUIREMENTS.md` §R19
- `docker-compose.yml` — base slim-core stack (no `mailpit` service today)
- `compose/docker-compose.dev-tools.yml` — current `mailpit` + `SMTP_PORT` home
- `packages/email/src/EmailSender.ts:117` — `SMTP_PORT` default 587
- `.env:22` — `SMTP_HOST=mailpit` (no `SMTP_PORT`)
- `.env.slim.example` lines ~175-180 — commented SMTP block
- Phase 14 decision (mailpit→overlay): dev-tools overlay header + that phase's RESEARCH §A.3
- Phase 59 — established `NODE_ENV=development` for the slim-core base
- R6 (slim-core boots clean, plain bring-up) — the parity bar R19 cites
- CLAUDE.md hard rules: 1, 3, 4
