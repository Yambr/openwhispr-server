<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->
# tests/smoke/ — synthetic transaction probes (Phase 22 / SR-22.1)

Five fast HTTP probes that prove the docker compose stack is functionally
healthy AFTER `docker compose up --wait` succeeds and BEFORE the much
heavier `make e2e-cjm` Playwright run. Each probe MUST complete in under
500 ms (target whole-suite wall-clock: < 5 s).

Per memory `feedback_smoke_before_full_e2e`: `lint → build → per-service-up
→ stack → smoke → playwright`, in that order, with logs check at each
layer. Per memory `feedback_check_loki_after_tests`: on smoke failure the
CI job dumps `docker compose logs --tail=200` so the operator sees
container logs first, not a Playwright trace.zip.

## Probes

| File                                | Asserts                                                                   |
|-------------------------------------|---------------------------------------------------------------------------|
| `health.smoke.test.ts`              | `GET /api/health` → 200 + `migrations_completed: true`                    |
| `transcribe-415.smoke.test.ts`      | `POST /api/transcribe` with `text/plain` → 415 + typed-error envelope     |
| `realtime-handshake.smoke.test.ts`  | `WSS /v1/realtime` without bearer → close code in 4401/4403/1008          |
| `web-root.smoke.test.ts`            | `GET https://web.localhost/` → 200 + `<html>` substring in body           |
| `traefik-host-split.smoke.test.ts`  | `GET /api/health` on `web.localhost` → 404 (host-split correct)           |

## Run

```bash
make smoke
```

The target runs vitest against `tests/smoke/**/*.smoke.test.ts` using
`vitest.smoke.config.ts`. The probes use the real `https://api.localhost`
and `https://web.localhost` URLs and expect Traefik to be reachable —
the canonical sequence is `make up && make smoke`.

## CI wiring

`.github/workflows/ci.yml` has a `smoke` job that runs between the
`docker compose up --wait` step and the `e2e-cjm` job. On failure it
dumps `docker compose logs --tail=200` so the failing container surface
is visible without re-running locally.
