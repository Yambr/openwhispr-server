# @openwhispr/load-test

**Status:** Wave 0 scaffold (Phase 08 / Plan 02).

k6 load-test workspace for OpenWhispr Server. Targets the 1000-VU
on-demand scenario defined in `docs/operations.md` (added in Wave 4 /
Plan 08).

## What ships in Wave 0 (this plan)

- Workspace scaffold: `package.json`, `tsconfig.json`, `tsup.config.ts`,
  `vitest.config.ts`.
- Unit-testable TypeScript helpers consumed by the future k6 flows:
  - `src/scenario-picker.ts` — weighted RNG over the locked
    50/25/15/10 endpoint mix (D-LOAD-3).
  - `src/setup.ts` — `provisionUsers()` pure function (called by the
    k6 `setup()` hook in Wave 2).
  - `src/utils/auth.ts` — Bearer-token rotation helpers.
  - `src/utils/http.ts` — `BASE_URL` and default headers.
- Shell scripts:
  - `scripts/verify-compose.sh` — argument parser for the
    `docker compose --profile <name> config --quiet` validator (the
    `load-test-mock` / `load-test-realistic` profiles land in Wave 1 /
    Plan 05).
  - `scripts/fd-probe.test.sh` — harness asserting the contract of
    `apps/api/scripts/fd-probe.sh` (the probe itself is Wave 0 /
    Plan 04).

## What does NOT ship in Wave 0

- The k6 flow files (`src/flows/transcribe.ts`, `reason.ts`,
  `agent-stream.ts`, `realtime-ws.ts`) — those hit live compose
  services and depend on the `load-test-mock` / `load-test-realistic`
  profiles. They land in Wave 2 / Plan 06.
- The k6 `default` export and `options` (also Plan 06).
- The fd-probe shell script under `apps/api/scripts/` (Plan 04).

## Running the unit tests

```sh
pnpm --filter @openwhispr/load-test test
pnpm --filter @openwhispr/load-test test:coverage  # enforces 90/90/90/90
pnpm --filter @openwhispr/load-test typecheck
pnpm --filter @openwhispr/load-test build
```

## Running the shell harnesses

```sh
bash tools/load-test/scripts/verify-compose.test.sh
bash tools/load-test/scripts/fd-probe.test.sh
```

## Pointers

- Plan source: `.planning/phases/08-load-test-tuning-slo-publication/08-load-test-tuning-slo-publication-02-load-test-scaffold.md`
- Operator runbook (Wave 4): `docs/operations.md`
- Phase context: `.planning/phases/08-load-test-tuning-slo-publication/08-CONTEXT.md`
