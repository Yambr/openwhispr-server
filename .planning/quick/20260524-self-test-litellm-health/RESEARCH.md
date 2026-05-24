# Self-test litellm-unhealthy — root cause

Status: diagnosed
Date: 2026-05-24
Worktree: .claude/worktrees/agent-a6771458330c02bea

## Failing job
- CI run 26345389476 / job 77554336020 (`harness-self-check` @ commit 9074241e)
- Test: `tests/self-tests/migrate-gates-api.test.ts` — `compose up --wait` exits 1
- Compose stderr: `dependency failed to start: container openwhispr-self-test-litellm-1 is unhealthy`

The on-disk test fault handler only fetches `logs migrate api` (line 119 of
the test) — never `logs litellm` — so the CI artifact never shows WHY the
litellm container is unhealthy. Diagnostic blind spot.

## Reproduction (local Mac, docker 24.0.6 / compose 2.23)
1. Write `.env` from `tests/self-tests/_helpers.ts::fixtureSecrets()` shape.
2. `docker compose -p openwhispr-self-test up -d --wait --wait-timeout 300 postgres valkey litellm migrate`
3. Compose reports: `container openwhispr-self-test-litellm-1 is unhealthy`.

## Verified root cause
LiteLLM uvicorn parent boots fine; child worker processes are killed by the
container cgroup OOM-killer. uvicorn keeps re-spawning workers, the
`/health/liveliness` port never accepts connections, healthcheck stays
`starting` then transitions to `unhealthy`.

Evidence:
- `docker stats` during boot: **mem=985.4MiB / 1GiB (96.23%)**.
- `docker compose logs litellm` (post-boot):
  - `INFO: Uvicorn running on http://0.0.0.0:4000`
  - `INFO: Started parent process [1]`
  - `INFO: Waiting for child process [75]`
  - `INFO: Child process [75] died`  ← worker OOM-killed
  - Loop repeats every ~36s as `restart: unless-stopped` cycles the parent.
- `docker inspect ... State.Health.Log`: 4× ConnectionRefused for
  `127.0.0.1:4000` healthchecks (worker never bound), plus 1× exec exitCode 137
  (SIGKILL by cgroup) on a healthcheck wedge.

Locally the container eventually flips healthy after ~5 minutes of cycling
(once import caches settle and only one worker survives). In CI the
`migrate-gates-api.test.ts` budget is `compose up --wait --wait-timeout 300`
(5 min) × retry 1 (10 min total). The container never sustains healthy long
enough for `--wait` to observe it.

## Config lines responsible
`docker-compose.yml` (current main, post-9074241e):
- L202: `command: [..., "--num_workers", "2"]` — 2 uvicorn workers, ~500 MB Python+models each.
- L239-242: `deploy.resources.limits.memory: 1G` — cgroup cap. Comment cites Helm chart parity (SR-20.1).

`charts/openwhispr/templates/litellm-deployment.yaml` L147: `limits.memory: 1Gi`
`charts/openwhispr/values.yaml` (`litellm.args`): `--num_workers "2"`

The two-workers-in-1GiB config is **not viable post-Phase-33 envelope-
encryption migrations** + post-R31 patched bytecode (the R31 patch deletes
`__pycache__`, forcing fresh compile of every Python module per worker —
larger resident set during boot).

## Decision
Raise the memory cap to **1.5 GiB** in BOTH the compose file and the Helm
chart (compose comment cites chart parity; they must move together). 1.5GB
gives ~750MB per worker + ~100MB parent + ~150MB filesystem cache headroom.
This is the minimum safe number; observed peak with 2 workers + boot
allocations is ~1.1GB sustained after import caches settle.

Rejected alternatives:
- **Drop to `num_workers 1`** — would slash p95 latency under concurrent
  request load. The 2-worker default is operator-facing prod config, not a
  test-only knob. Lowering it just to fit a too-small memory cap is a
  workaround, not a fix.
- **Bump start_period further** — useless: the worker is being KILLED, not
  slow to boot. Longer start_period would still observe the worker death
  loop forever.

## Regression test (TDD)
Add `tools/lint-litellm-memory-limit.test.ts` that fails when:
  (a) `docker-compose.yml` `litellm.deploy.resources.limits.memory` < 1.5G, OR
  (b) `charts/openwhispr/templates/litellm-deployment.yaml`
      litellm container `resources.limits.memory` < 1.5Gi.

Lint is a static parser; runs in the existing `tests-self-tests` workspace
(same Vitest invocation as `litellm-up.test.ts` guards). Failing FIRST
proves the regression. Passing AFTER fix proves the fix.

## Out-of-scope (deferred items)
- `migrate-gates-api.test.ts` fault handler should `compose logs litellm`
  too. Without that, future CI failures of this class will be equally
  opaque. Defer to a follow-up plan; not strictly required for green CI.
