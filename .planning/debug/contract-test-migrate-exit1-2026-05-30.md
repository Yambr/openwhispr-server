# contract-test / e2e compose-boot: `migrate` service exits 1 (2026-05-30)

## Symptom
On PR #47 CI run 26687976229, the **required** `contract-test` job fails at
`docker compose --profile default --profile contract-test up -d --wait`:

```
Container openwhispr-postgres-1  Healthy
Container openwhispr-migrate-1   Started
Container openwhispr-migrate-1   service "migrate" didn't complete successfully: exit 1
service "migrate" didn't complete successfully: exit 1
##[error]Process completed with exit code 1.
```

Same compose-boot class affects non-required `e2e-hermetic`, `e2e-phase6-quick`,
`embedded-smoke`, `playwright`. **All also red on PR #46 = current main** — so
this is a PRE-EXISTING failure, not introduced by any recent feature PR. It is
the reason the owner has been admin-merging (#44/#46/#47).

## What is NOT the cause (ruled out with own eyes)
- NOT a `--wait` timeout / runner RAM: postgres reached `Healthy`, migrate
  `Started` then exited 1 on its own — a real non-zero exit, not a hang.
- NOT the load-smoke 24 GiB floor (separate job, fixed in 260530-rqk).
- `migrate` runs `node /app/packages/data/dist/migrate.cjs` with `env_file: .env`.
- Local `tools/bootstrap.sh --ci` on `.env.slim.example` SUCCEEDS (23 keys, 13
  generated) and writes a valid MASTER_KEK — so the placeholder-KEK theory is
  NOT confirmed locally. The CI step runs `tools/bootstrap.sh --ci || true`, so
  a CI-only bootstrap failure would be silently masked and leave the
  `MASTER_KEK=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` placeholder → migrate.cjs
  could then fail. THIS IS THE LEADING HYPOTHESIS but UNCONFIRMED (the
  contract-test job does not capture `docker compose logs migrate`).

## Why not blind-fixed in 260530-rqk
The migrate exit-1 is substantive (could be a real migration/boot defect that
also breaks the OSS `git clone && docker compose up` promise) — NOT the same
"CI-invocation typo" class as the 5 fixes that landed. Fixing it blind risks
masking a real bug. Per the no-guess / no-simplify doctrine it is surfaced as a
distinct finding rather than patched speculatively.

## Next steps (proposed, needs decision)
1. Add `docker compose logs --no-color migrate` capture to the contract-test +
   e2e jobs (today only some capture logs) so the actual migrate stderr is
   visible — cheap, non-invasive, turns the next run into a real diagnosis.
2. Drop the `|| true` on the CI `tools/bootstrap.sh --ci` step (or assert the
   `.env` MASTER_KEK is non-placeholder before `up`) so a bootstrap failure
   fails loudly instead of producing a placeholder KEK.
3. Reproduce locally with the EXACT CI fixture env + a full
   `docker compose --profile default --profile contract-test up --wait` and read
   migrate's stderr (5-10 min cycle).

Tracked alongside quick task 260530-rqk (which fixed the other 5 gates).
