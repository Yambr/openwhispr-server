# Phase 61 — load-test status & deferral

**Date:** 2026-05-22

## Outcome

Phase 61 ran `make load-smoke` (mock-profile k6 load smoke) to refresh the
published load numbers on the v2.4 branch. The run surfaced a **systemic rot
in the load-test path** — six distinct pre-existing bugs, accumulated because
the load-test (`tools/load-test/scripts/run.sh`, last meaningfully exercised in
Phase 8) was never reconciled with Phase 14's slim-core split, the BYOK boot
guard, or the env-template restructuring that all landed afterwards.

## Fixed in Phase 61 (committed to v2.4-oss-publish)

1. **`run.sh` missing observability overlay** — `docker-compose.load-test.yml`
   carries partial grafana/loki/tempo/mimir/otel-collector fragments expecting
   full service definitions; Phase 14 moved those into
   `compose/docker-compose.observability.yml`. Merged project errored with
   `service "grafana" has neither an image nor a build context`. — FIXED
2. **`run.sh` missing storage overlay** — BYOK guard `BYOK_STORAGE_REQUIRED`
   crash-looped the api (no `S3_ENDPOINT`). — FIXED (layer
   `compose/docker-compose.storage.yml`).
3. **`run.sh` missing ingress overlay** — added for completeness. — FIXED.
4. **`POSTGRES_ADMIN_URL` missing `?sslmode=disable`** in `.env.full.example`
   + `.env.embedded.example` — every other DB URL has it; the omission made
   `ensureLitellmDatabase` connect with TLS-on against the non-SSL dev
   postgres → migrate exited 1. — FIXED.

## Identified, NOT fixed — deferred to a load-test reconciliation phase

5. **`.env.full.example` is internally inconsistent.** It sets
   `INGRESS_BASE_URL=https://api.localhost/` which makes the BYOK guard
   (`packages/byok-guard`, `https://` base → require `INGRESS_TLS_CERT_PATH`)
   refuse api boot — but the template never sets `INGRESS_TLS_CERT_PATH`, and
   the ingress overlay does not supply it either. The api cannot boot from a
   straight `.env.full.example` bootstrap. `.env.slim.example` avoids this by
   using `http://localhost:4000`.
6. **`.env.slim.example` is deliberately a 5-key minimal template** (CONTEXT
   decision) and does not declare `POSTGRES_OWNER_USER` / `POSTGRES_APP_USER` /
   `POSTGRES_DB`, yet `docker-compose.yml:53,67` hard-references
   `${POSTGRES_OWNER_USER}` / `${POSTGRES_APP_USER}` with NO `:-` default.
   There is a genuine gap between "the slim template is minimal by design" and
   "the base compose hard-references keys the slim template omits". The right
   fix is either `:-` defaults in compose OR a dedicated `.env.load-test.example`.

## Decision

Per CLAUDE.md Hard Rule 2 ("surface costly architectural decisions as
deferred-items, not in-flight rewrites"): fixing #5 and #6 correctly means
reconciling the env-template/compose-default contract — a focused change with
its own TDD cycle and a real risk of touching the slim-core CONTEXT decision.
That is **out of scope for v2.4** (an audit-and-publish milestone).

**Phase 61 ships:** the three `run.sh` overlay fixes + the `sslmode` env fix
(real, committed, correct). The published mock-profile SLO numbers in
`docs/operations.md` remain the Phase-8 Run-5 baseline — those numbers are
hardware-bound and the canonical re-baseline target is operator H100 hardware
anyway (per memory `feedback_realistic_profile_smoke_and_baseline` and
`docs/operations.md` `OPERATOR_RERUN_ON_GPU`). v2.4 does not invalidate them.

**Deferred:** a "load-test path reconciliation" phase — close #5 + #6, add a
dedicated `.env.load-test.example` (or compose `:-` defaults), and run a fresh
mock plateau. Tracked here; add to `.planning/deferred-items.md`.
