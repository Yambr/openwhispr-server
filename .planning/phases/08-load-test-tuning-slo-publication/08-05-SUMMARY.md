---
phase: 08-load-test-tuning-slo-publication
plan: 05
subsystem: ops/compose
tags: [docker-compose, load-test, profiles, pgbouncer, postgres-tuning, ulimits, mimir, speaches, mock-litellm, preflight, tdd-config]
requires:
  - 08-01  # OPENWHISPR_DISABLE_RATE_LIMIT env switch
  - 08-02  # tools/load-test/scripts/verify-compose.sh harness
  - 08-03  # compose/mock-litellm Fastify app + Dockerfile
  - 08-04  # apps/api/scripts/fd-probe.sh + compose/traefik/fd-probe.sh
provides:
  - docker-compose.load-test.yml overlay (two profiles: load-test-mock, load-test-realistic)
  - compose/postgres/load-test.conf (max_connections=500 tuning overlay)
  - compose/traefik/Dockerfile (thin wrapper baking fd-probe.sh)
  - compose/speaches/.gitkeep (directory tracker for future fixtures)
  - tools/load-test/scripts/profile-lint.test.sh (configuration-level TDD gate, 44 assertions)
  - tools/load-test/scripts/preflight.test.sh (operator-safety test harness, 9 assertions)
  - tools/load-test/scripts/preflight.sh (operator safety gate)
affects:
  - default docker-compose profile (unchanged at runtime; verified via T1/T4/T10/T11(default))
tech-stack:
  added: []
  patterns:
    - docker-compose overlay file with profile-additive merge (compose appends profile arrays across -f files)
    - inline PgBouncer 4-instance duplication (avoids YAML-anchor fragility documented in plan 08-05 pitfall A6)
    - Python + PyYAML as portable yq substitute for shell-level YAML assertions (no yq dependency)
    - PATH-isolated stub harness for testing operator-safety scripts (env -i + tempdir)
key-files:
  created:
    - docker-compose.load-test.yml
    - compose/postgres/load-test.conf
    - compose/speaches/.gitkeep
    - compose/traefik/Dockerfile
    - tools/load-test/scripts/profile-lint.test.sh
    - tools/load-test/scripts/preflight.test.sh
    - tools/load-test/scripts/preflight.sh
  modified: []
decisions:
  - "Overlay file (docker-compose.load-test.yml) instead of profile-conditional anchors in docker-compose.yml — keeps default profile byte-identical at runtime; explicitly resolves the design tension noted in the plan's <interfaces> block."
  - "Inline duplication for pgbouncer-1..4 instead of YAML anchor + <<: merge — anchor merge behaviour is fragile across docker-compose v2.x versions when combined with profile gating (pitfall A6)."
  - "Python + PyYAML in profile-lint.test.sh instead of yq — yq is not installed on the developer host nor pinned in CI; python3 + PyYAML ships with the existing toolchain."
  - "Speaches CPU image (ghcr.io/speaches-ai/speaches:latest-cpu) instead of CUDA — Docker Desktop on macOS cannot expose nvidia-container-runtime; CPU is the only viable local image."
  - "Traefik thin Dockerfile + entrypoint override (not command-only override) — guarantees fd-probe.sh exists at a known absolute path inside the image, so the entrypoint shim cannot be silently disabled by a future PR that strips the bind mount."
metrics:
  duration: "~10 minutes wall-clock"
  completed: 2026-05-12T14:36Z
  tasks_completed: 3
  task_attempts: 3  # each task GREEN on first attempt after RED
---

# Phase 08 Plan 05: Compose Load-Test Profiles Summary

Wired all Wave-0 deliverables (rate-limit env switch, mock-litellm Fastify upstream, fd-probe entrypoint shim) into a net-new docker-compose overlay (`docker-compose.load-test.yml`) under two profiles (`load-test-mock`, `load-test-realistic`); scaled PgBouncer to 4 instances on shared network alias `pgbouncer`; raised Postgres `max_connections` to 500 via `compose/postgres/load-test.conf`; set `api` + `traefik` `ulimits.nofile` to soft=hard=65535; exposed Mimir 9009 on host for k6 prometheus-rw; added Speaches CPU service under `load-test-realistic`; shipped `tools/load-test/scripts/preflight.sh` as the operator safety gate.

## Tasks Executed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | RED profile-lint integration test | `7eecdee` | `tools/load-test/scripts/profile-lint.test.sh` |
| 2 | GREEN compose overlay + traefik Dockerfile + postgres tuning | `0765b71` | `docker-compose.load-test.yml`, `compose/postgres/load-test.conf`, `compose/speaches/.gitkeep`, `compose/traefik/Dockerfile` |
| 3a | RED preflight test harness | `ceda876` | `tools/load-test/scripts/preflight.test.sh` |
| 3b | GREEN preflight.sh operator safety gate | `37f93f7` | `tools/load-test/scripts/preflight.sh` |

## Truth Coverage (plan must_haves)

All 11 plan must_haves enforced by `profile-lint.test.sh` (44 individual assertions, all green):

- T1  default compose parses (`docker compose -f docker-compose.yml config --quiet` returns 0)
- T2  `load-test-mock` profile parses
- T3  `load-test-realistic` profile parses
- T4  default profile contains NEITHER `mock-litellm` NOR `speaches` NOR `pgbouncer-1..4`
- T5  load-test-mock service inventory complete; speaches absent
- T6  pgbouncer-1..4 share alias `pgbouncer`; each has `DEFAULT_POOL_SIZE=100`
- T7  postgres command contains `max_connections=500`
- T8  api + traefik `ulimits.nofile.soft=65535`
- T9  traefik runs fd-probe via thin Dockerfile + entrypoint override
- T10 mimir publishes 9009 under load-test profiles; default does not
- T11 `api.environment.OPENWHISPR_DISABLE_RATE_LIMIT=1` under load-test profiles; absent under default
- T12 mock-litellm carries network alias `litellm` on `openwhispr_internal`
- T13 speaches present under realistic with `WHISPER_MODEL` env + `start_period >= 180s`

## Architectural Decisions

### Overlay file over single-file profiles

The plan `<interfaces>` block enumerated four candidate patterns and acknowledged the conflict between "net-new additions to docker-compose.yml" (D-PROF-2 wording) and "default profile must be unaffected" (D-PROF-2 intent). The locked decision was an overlay file:

```bash
docker compose -f docker-compose.yml -f docker-compose.load-test.yml \
    --profile load-test-mock up -d
```

Default `docker compose up` never references the overlay file, so the default profile is byte-identical at runtime — Phase 07.1 e2e remains green without modification.

### Profile additivity vs. service replacement

docker-compose merges `profiles:` arrays across overlay files by concatenation. To make existing default services (api, traefik, postgres, mimir, valkey) appear under load-test profiles, the overlay re-states their profile lists as `[default, load-test-mock, load-test-realistic]`. Compose then sees the merged list `[default, default, load-test-mock, load-test-realistic]` and matches the active profile.

Net-new services (mock-litellm, speaches, pgbouncer-1..4) declare their own profile lists inline. The original single `pgbouncer` service (`profiles: [default, db-only]`) naturally drops out under load-test profiles because its profile list does not intersect.

### Inline pgbouncer duplication

The plan's `<interfaces>` block suggested YAML anchors (`<<: *pgbouncer_template`) for the 4-instance scale-out and noted the known pitfall (A6) that anchor merge behaviour is inconsistent across docker-compose v2.x versions when combined with profile gating. Inline duplication of the four service blocks is verbose but reproducible; the same approach is used elsewhere in the repo (e.g., otel-collector receivers).

### Python + PyYAML over yq

`yq` is not installed on the developer host and is not pinned in CI. Python 3 + PyYAML ships with the existing toolchain (verified: `python3 -c "import yaml; print(yaml.__version__)"` returns 6.0.3). The `yq_py` shim in `profile-lint.test.sh` accepts dotted-path queries and emits leaf values or YAML-encoded subtrees — sufficient for every plan assertion.

### Traefik Dockerfile vs. bind mount

The plan offered two patterns for wiring fd-probe.sh into the Traefik container:

1. Bind-mount `compose/traefik/fd-probe.sh` into the upstream Traefik image and override the entrypoint via compose.
2. Build a thin Dockerfile that COPYs the script into the image at a fixed path.

We picked (2). Reasoning: a future PR that drops the bind mount would silently lose the regression guard. With the script baked into the image, the only way to disable it is to also change the Dockerfile — that change is unambiguously visible in code review.

## Deviations from Plan

None — plan executed exactly as written. Configuration-level TDD pattern (RED before GREEN) followed for both Task 1 and Task 3, with the override file and preflight.sh iterated until their respective test harnesses returned 0.

## Verification

```bash
# profile-lint gate (Task 1 contract)
bash tools/load-test/scripts/profile-lint.test.sh
# -> All profile-lint assertions PASSED. (44/44)

# Direct compose validation
docker compose -f docker-compose.yml config --quiet                           # default OK
docker compose -f docker-compose.yml -f docker-compose.load-test.yml \
    --profile load-test-mock config --quiet                                   # mock OK
docker compose -f docker-compose.yml -f docker-compose.load-test.yml \
    --profile load-test-realistic config --quiet                              # realistic OK

# preflight harness
bash tools/load-test/scripts/preflight.test.sh
# -> All preflight tests PASSED. (9/9)
```

## Open Items for Downstream Plans

- **08-06 (k6 flows + Makefile)**: Will reference `make load-test PROFILE=mock|realistic` which invokes `docker compose -f docker-compose.yml -f docker-compose.load-test.yml --profile load-test-$PROFILE`. Both profiles are now ready.
- **08-07 (live baseline run)**: Will exercise the full stack with k6 ramps; the 4-instance PgBouncer round-robin verification (`docker exec api getent hosts pgbouncer` returning 4 IPs) belongs to that plan since it requires a live `up -d` not just `compose config`.
- **Speaches HF_TOKEN**: The realistic profile passes `HF_TOKEN: ${HF_TOKEN:-}`; operators wanting pyannote diarization must export their Hugging Face token. Default-empty so the container still boots; diarization endpoints will surface a 503 until the token is provided.

## Known Stubs

None.

## Self-Check: PASSED

- `docker-compose.load-test.yml` — FOUND
- `compose/postgres/load-test.conf` — FOUND
- `compose/speaches/.gitkeep` — FOUND
- `compose/traefik/Dockerfile` — FOUND
- `tools/load-test/scripts/profile-lint.test.sh` — FOUND
- `tools/load-test/scripts/preflight.test.sh` — FOUND
- `tools/load-test/scripts/preflight.sh` — FOUND
- commit `7eecdee` — FOUND
- commit `0765b71` — FOUND
- commit `ceda876` — FOUND
- commit `37f93f7` — FOUND
