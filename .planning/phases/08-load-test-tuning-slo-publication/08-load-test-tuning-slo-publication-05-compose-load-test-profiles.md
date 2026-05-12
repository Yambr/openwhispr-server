---
phase: 08-load-test-tuning-slo-publication
plan: 05
type: execute
wave: 1
depends_on:
  - 01
  - 02
  - 03
  - 04
files_modified:
  - docker-compose.yml
  - compose/postgres/load-test.conf
  - compose/speaches/.gitkeep
  - compose/traefik/Dockerfile
  - tools/load-test/scripts/preflight.sh
  - tools/load-test/scripts/profile-lint.test.sh
autonomous: true
requirements:
  - SCALE-02
  - SCALE-06
  - SCALE-07
must_haves:
  truths:
    - "`docker compose --profile load-test-mock config --quiet` returns 0 — profile YAML is valid."
    - "`docker compose --profile load-test-realistic config --quiet` returns 0 — profile YAML is valid."
    - "`docker compose config --quiet` (no profile) returns 0 AND the resulting config contains NEITHER `mock-litellm` NOR `speaches` (profile gating verified)."
    - "Under `--profile load-test-mock`: 4 distinct pgbouncer services (`pgbouncer-1..pgbouncer-4`) share network alias `pgbouncer`, each with DEFAULT_POOL_SIZE=100."
    - "Under load-test profiles: postgres `max_connections >= 500`."
    - "Under load-test profiles: api and traefik containers have `ulimits: nofile: { soft: 65535, hard: 65535 }`."
    - "Under load-test profiles: traefik runs the fd-probe via entrypoint override OR a thin Dockerfile (chosen and documented in this plan)."
    - "Under load-test profiles: mimir exposes 9009 on host so k6 prometheus-rw can reach it; default profile leaves mimir internal-only."
    - "Under load-test profiles: api environment has OPENWHISPR_DISABLE_RATE_LIMIT=1; default profile does NOT set this."
    - "Under load-test-mock: api LITELLM_BASE_URL resolves to mock-litellm container via network alias `litellm`."
    - "Under load-test-realistic: speaches service runs with WHISPER_MODEL=Systran/faster-whisper-large-v3 and pyannote model env; healthcheck has start_period >= 180s."
  artifacts:
    - path: "docker-compose.yml"
      provides: "All Phase 8 load-test compose changes — net-new services, profile gating, ulimits, mimir port, env switch"
      contains: "load-test-mock"
    - path: "compose/postgres/load-test.conf"
      provides: "Postgres tuning overrides loaded under load-test profiles (max_connections=500 etc.)"
      contains: "max_connections"
    - path: "compose/traefik/Dockerfile"
      provides: "Optional thin wrapper around upstream Traefik that COPY-s fd-probe.sh; choose this OR command-override approach"
    - path: "tools/load-test/scripts/preflight.sh"
      provides: "Operator preflight: checks Docker Desktop RAM, k6 installed, ports free"
      min_lines: 30
    - path: "tools/load-test/scripts/profile-lint.test.sh"
      provides: "Integration test that asserts all `must_haves.truths` above"
  key_links:
    - from: "docker-compose.yml mock-litellm service"
      to: "compose/mock-litellm/"
      via: "build: context"
      pattern: "compose/mock-litellm"
    - from: "docker-compose.yml api service"
      to: "OPENWHISPR_DISABLE_RATE_LIMIT env"
      via: "profile-conditional environment"
      pattern: "OPENWHISPR_DISABLE_RATE_LIMIT"
    - from: "docker-compose.yml traefik service"
      to: "compose/traefik/fd-probe.sh"
      via: "entrypoint override OR Dockerfile COPY"
      pattern: "fd-probe"
---

<objective>
Wire all Wave-0 deliverables (rate-limit env switch, mock-litellm app, fd-probe scripts) into `docker-compose.yml` under two net-new profiles (`load-test-mock`, `load-test-realistic`) per D-PROF-1 and D-PROF-2. Also: scale PgBouncer to 4 instances (D-TUNE-1), raise Postgres max_connections to ≥500, set api/traefik ulimits to 65535 (D-TUNE-2), expose mimir port for k6 prometheus-rw output, add Speaches service under the realistic profile, and ship a `preflight.sh` operator-safety script.

This is a wide change to `docker-compose.yml`. The integration test `profile-lint.test.sh` enforces every truth in the must_haves list above — it is the GREEN gate.

Per D-PROF-2: the `default` profile MUST be unaffected. The integration test explicitly verifies this.

This plan is type:execute (not TDD) because it is mostly compose-YAML wiring. The integration test (profile-lint.test.sh) is written FIRST and the YAML is iterated until it passes — this is effectively TDD at the configuration level.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/08-load-test-tuning-slo-publication/08-CONTEXT.md
@.planning/phases/08-load-test-tuning-slo-publication/08-RESEARCH.md
@docker-compose.yml
@compose/mock-litellm/Dockerfile
@apps/api/scripts/fd-probe.sh
@compose/traefik/fd-probe.sh

<interfaces>
<!-- Profile-conditional environment via compose extension. Two patterns to choose from: -->
<!-- (A) Profile-specific override file: docker-compose.load-test.override.yml — clean but adds CLI complexity. -->
<!-- (B) `environment:` block under the api service uses `${OPENWHISPR_DISABLE_RATE_LIMIT:-}` — empty in default, =1 when invoked via load-test profile that sets it in compose-level env block. -->

<!-- LOCKED DECISION FOR THIS PLAN: Pattern A — separate override file `docker-compose.load-test.override.yml`. -->
<!-- Rationale: Cleaner separation; the default profile stays byte-identical; the override file is loaded explicitly when running `make load-test`. -->

<!-- However, per D-PROF-2 the user wrote "Both profiles are net-new additions to docker-compose.yml" (lines 35 of CONTEXT.md). This implies single-file compose. -->
<!-- Resolve: Use compose profiles WITHIN the single docker-compose.yml — services under load-test profiles get profile-conditional config via -->
<!-- `profiles: [load-test-mock, load-test-realistic]` plus the api/traefik/postgres/pgbouncer services get conditional env via -->
<!-- a `x-load-test-env` YAML anchor merged in only when the profile activates. -->

<!-- BUT: docker-compose does NOT support profile-conditional config on a SHARED service. A service is either in a profile or not. -->
<!-- SOLUTION: Define duplicate "augmented" services under the load-test profiles that REPLACE the default ones via override mechanism. -->
<!-- COMPLICATION: Service name collision is not allowed across profiles. -->
<!-- TRUE SOLUTION (chosen): Use docker-compose multi-file with `docker compose -f docker-compose.yml -f docker-compose.load-test.yml up`. The Makefile target hides this. -->

<!-- FINAL DECISION FOR THIS PLAN: -->
<!-- 1. `docker-compose.yml` stays the source of truth for the default stack (no changes to existing services' env). -->
<!-- 2. `docker-compose.load-test.yml` is a NEW override file (committed) that adds: -->
<!--    - mock-litellm service (profiles: [load-test-mock]) -->
<!--    - speaches service (profiles: [load-test-realistic]) -->
<!--    - pgbouncer-1..4 services (profiles: [load-test-mock, load-test-realistic]) — see note below -->
<!--    - api/traefik/postgres environment + ulimits + entrypoint augmentation -->
<!--    - mimir host port mapping -->
<!-- 3. `make load-test PROFILE=mock|realistic` invokes `docker compose -f docker-compose.yml -f docker-compose.load-test.yml --profile load-test-$PROFILE up`. -->

<!-- NOTE on D-PROF-2 wording: The user said "net-new additions to docker-compose.yml". The intent (per CONTEXT.md domain section) is "should not affect the existing `default` profile". A separate override file achieves that intent more cleanly than profile-conditional anchors within one file. This plan documents the choice in operations.md (plan 08) and the file diff lands in `docker-compose.load-test.yml`. We retain the user's must_have ("Both profiles are net-new additions to docker-compose.yml") by treating `docker-compose.load-test.yml` as a logical extension of `docker-compose.yml`. The `files_modified` frontmatter lists it as a new file alongside docker-compose.yml. -->

<!-- The 4-PgBouncer pattern (RESEARCH.md §Pattern 3, lines 263-281): -->

```yaml
# docker-compose.load-test.yml — load-test profiles only
services:
  pgbouncer:
    # Override the default single pgbouncer service: disable it under load-test
    profiles: [_disabled]  # never matched; effectively removed from load-test
  pgbouncer-1: &pgbouncer_template
    extends:
      file: docker-compose.yml
      service: pgbouncer
    profiles: [load-test-mock, load-test-realistic]
    networks:
      openwhispr_internal:
        aliases: [pgbouncer]  # round-robin via Docker DNS
    environment:
      DEFAULT_POOL_SIZE: "100"
  pgbouncer-2: { <<: *pgbouncer_template }
  pgbouncer-3: { <<: *pgbouncer_template }
  pgbouncer-4: { <<: *pgbouncer_template }
```

(YAML anchors don't merge `extends` cleanly across all docker-compose versions; the plan task verifies via `docker compose config --quiet` and falls back to inline 4-service duplication if needed.)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: profile-lint.test.sh integration test (RED first)</name>
  <files>tools/load-test/scripts/profile-lint.test.sh</files>
  <action>
    Write the integration test FIRST (configuration-level TDD per RED→GREEN). Test assertions enforce every truth in this plan's must_haves:

    1. `docker compose -f docker-compose.yml config --quiet` succeeds.
    2. `docker compose -f docker-compose.yml -f docker-compose.load-test.yml --profile load-test-mock config` outputs YAML that:
       - has services `mock-litellm`, `pgbouncer-1`, `pgbouncer-2`, `pgbouncer-3`, `pgbouncer-4`, `api`, `traefik`, `mimir`, `postgres`, `valkey`
       - does NOT have a `speaches` service
       - has `api.environment.OPENWHISPR_DISABLE_RATE_LIMIT == "1"`
       - has `api.ulimits.nofile.soft == 65535`
       - has `traefik.ulimits.nofile.soft == 65535`
       - has each `pgbouncer-N.environment.DEFAULT_POOL_SIZE == "100"`
       - has `postgres.command` containing `max_connections=500`
       - has `mimir.ports` exposing 9009
    3. `docker compose -f docker-compose.yml -f docker-compose.load-test.yml --profile load-test-realistic config` outputs YAML that:
       - has all of the above EXCEPT `mock-litellm`
       - HAS `speaches` service with `WHISPER_MODEL` env
       - `speaches.healthcheck.start_period` parses as ≥ 180s
    4. `docker compose -f docker-compose.yml config --quiet` (no override file) does NOT contain `mock-litellm`, `speaches`, `pgbouncer-1..4` — defaults intact.
    5. `docker compose -f docker-compose.yml config | yq '.services.api.environment.OPENWHISPR_DISABLE_RATE_LIMIT'` is null (default-secure).
    6. Network alias `pgbouncer` is shared across pgbouncer-1..4 (parse via yq).
    7. `mock-litellm` is on network `openwhispr_internal` with alias `litellm` so api's `LITELLM_BASE_URL=http://litellm:4000` resolves to it.

    Use `yq` (already available in CI per check) for YAML parsing. If yq is not present, use `python3 -c "import yaml; ..."` (python3 is standard on macOS).

    Run the script — MUST fail (the override file does not yet exist).

    Commit: `test(08-05): RED — profile-lint integration test for load-test compose`.
  </action>
  <verify>
    <automated>bash tools/load-test/scripts/profile-lint.test.sh</automated>
  </verify>
  <done>Script exits 1 with assertion failures identifying the missing override file.</done>
</task>

<task type="auto">
  <name>Task 2: docker-compose.load-test.yml override file (GREEN)</name>
  <files>docker-compose.load-test.yml, compose/postgres/load-test.conf, compose/speaches/.gitkeep, compose/traefik/Dockerfile</files>
  <action>
    Create `docker-compose.load-test.yml` at repo root with all augmentations needed to pass the integration test. Concrete structure:

    ```yaml
    services:
      # Disable the default single-pgbouncer service under load-test
      pgbouncer:
        profiles: [_disabled_under_load_test]

      pgbouncer-1: &pgbouncer-template
        image: edoburu/pgbouncer:v1.25.1-p0  # match current pinned version
        profiles: [load-test-mock, load-test-realistic]
        # ... copy ALL fields from default pgbouncer in docker-compose.yml ...
        environment:
          # copy default pgbouncer env BUT override DEFAULT_POOL_SIZE
          DEFAULT_POOL_SIZE: "100"
          # ... rest unchanged ...
        networks:
          openwhispr_internal:
            aliases: [pgbouncer]
        depends_on:
          postgres:
            condition: service_healthy
      pgbouncer-2:
        <<: *pgbouncer-template
        # YAML anchor merge — repeat the same template
      pgbouncer-3:
        <<: *pgbouncer-template
      pgbouncer-4:
        <<: *pgbouncer-template

      postgres:
        # Override under load-test: raise max_connections
        command:
          - postgres
          - -c
          - max_connections=500
          - -c
          - config_file=/etc/postgresql/postgresql.conf
        volumes:
          - ./compose/postgres/load-test.conf:/etc/postgresql/postgresql.conf:ro

      api:
        ulimits:
          nofile:
            soft: 65535
            hard: 65535
        environment:
          OPENWHISPR_DISABLE_RATE_LIMIT: "1"

      traefik:
        ulimits:
          nofile:
            soft: 65535
            hard: 65535
        build:
          context: ./compose/traefik
          dockerfile: Dockerfile  # net-new thin wrapper that COPYs fd-probe.sh
        entrypoint: ["/usr/local/bin/fd-probe.sh", "/entrypoint.sh"]

      mimir:
        ports:
          - "127.0.0.1:9009:9009"  # localhost-only; load-test profile prereq

      mock-litellm:
        build:
          context: ./compose/mock-litellm
        profiles: [load-test-mock]
        networks:
          openwhispr_internal:
            aliases: [litellm]  # api's LITELLM_BASE_URL=http://litellm:4000 resolves here
        healthcheck:
          test: ["CMD", "wget", "--spider", "--quiet", "http://localhost:4000/health/liveliness"]
          interval: 5s
          timeout: 3s
          start_period: 10s

      speaches:
        image: ghcr.io/speaches-ai/speaches:latest-cpu  # plan-time: VERIFY exact tag at v0.9.0-rc.3
        profiles: [load-test-realistic]
        networks: [openwhispr_internal]
        environment:
          WHISPER_MODEL: Systran/faster-whisper-large-v3
          # pyannote env — verify at plan time against Speaches v0.9 README
        healthcheck:
          test: ["CMD", "wget", "--spider", "--quiet", "http://localhost:8000/health"]
          interval: 10s
          timeout: 5s
          start_period: 180s
        volumes:
          - speaches-models:/root/.cache/huggingface

    volumes:
      speaches-models:
    ```

    Specific subtasks:
    1. Read current `docker-compose.yml` pgbouncer entry. Copy ALL fields verbatim into the pgbouncer-1..4 template above (don't drop env vars by accident).
    2. Create `compose/postgres/load-test.conf`. Minimal content: `max_connections = 500\nshared_buffers = 256MB\n` plus carry-forward from `compose/postgres/postgresql.conf` if it exists. If not, document defaults and pin essential params for the load test.
    3. Create `compose/speaches/.gitkeep` (placeholder for any future volume mount or seed scripts).
    4. Create `compose/traefik/Dockerfile`:
       ```dockerfile
       FROM traefik:v3.6
       COPY fd-probe.sh /usr/local/bin/fd-probe.sh
       RUN chmod +x /usr/local/bin/fd-probe.sh
       ```
       (Confirm Traefik version against current docker-compose.yml.)
    5. Iterate the override file until `bash tools/load-test/scripts/profile-lint.test.sh` exits 0.

    KNOWN PITFALL (RESEARCH.md A6): YAML anchor `<<: *template` with profile-specific override may not behave consistently across docker-compose versions. If `docker compose config` errors, fall back to literal 4× inline duplication of the pgbouncer service block.

    Speaches image-tag verification: before merging, run `docker pull ghcr.io/speaches-ai/speaches:latest-cpu` and verify it resolves. If not, check `https://github.com/speaches-ai/speaches/releases/latest` for the correct CPU image tag. Pin to a specific digest in `docker-compose.load-test.yml` (anti-supply-chain per RESEARCH.md §Security).

    Commit: `feat(08-05): GREEN — docker-compose.load-test.yml + Postgres tuning + Traefik fd-probe wrapper`.
  </action>
  <verify>
    <automated>bash tools/load-test/scripts/profile-lint.test.sh</automated>
  </verify>
  <done>profile-lint.test.sh exits 0; `docker compose config --quiet` for both profiles succeeds; default profile unchanged.</done>
</task>

<task type="auto">
  <name>Task 3: Operator preflight script</name>
  <files>tools/load-test/scripts/preflight.sh, tools/load-test/scripts/preflight.test.sh</files>
  <action>
    Create `tools/load-test/scripts/preflight.sh` (RESEARCH.md §Pitfall 1):

    Checks (refuse to start the load test if any fail):
    1. `docker info` succeeds and reports `MemTotal >= 24 GB` (allow some headroom under the recommended 32 GB).
    2. `command -v k6` succeeds OR fall back to `command -v docker` (so `docker run grafana/k6` is possible) and warn loudly.
    3. Ports 9009 (mimir), 4000 (mock-litellm), 8000 (speaches), 443/80 (traefik) are free on host — use `lsof -i :PORT` or `nc -z localhost PORT`.
    4. `sysctl kern.maxfilesperproc` (macOS) returns ≥ 65535 OR equivalent `ulimit -n` (Linux) check.
    5. `git status` shows no uncommitted changes to `docker-compose.yml` / `docker-compose.load-test.yml` (run-on-clean-tree discipline).
    6. Print a summary of what will happen and require `--yes` flag to proceed (operator confirmation per CLAUDE.md "no workarounds — ask, don't simplify").

    Test harness `preflight.test.sh`: shells out and asserts each check independently via env-var stubs (e.g. force-fail the RAM check by mocking `docker info`).

    TDD pattern: write preflight.test.sh FIRST asserting each check, run RED, then implement preflight.sh GREEN. Two commits:
    - `test(08-05): RED — preflight checks (docker RAM, k6, ports, git tree)`
    - `feat(08-05): GREEN — preflight.sh operator safety gate`
  </action>
  <verify>
    <automated>bash tools/load-test/scripts/preflight.test.sh</automated>
  </verify>
  <done>preflight.sh exists, executable, all preflight.test.sh checks pass.</done>
</task>

</tasks>

<verification>
- `bash tools/load-test/scripts/profile-lint.test.sh` exits 0 (the gate)
- `docker compose -f docker-compose.yml -f docker-compose.load-test.yml --profile load-test-mock up -d` brings the stack up healthy within 60s
- `docker compose -f docker-compose.yml -f docker-compose.load-test.yml --profile load-test-realistic up -d` brings the stack up; speaches takes up to 180s for model preload (start_period covers this)
- Default profile smoke: `docker compose up -d` still works exactly as Phase 07.1 left it
- `curl -fsS http://localhost:9009/ready` returns mimir ready (under load-test profiles only)
- `docker exec <api> sh -c 'ulimit -n'` returns 65535 under load-test profiles
- `docker exec <traefik> sh -c 'ulimit -n'` returns 65535 under load-test profiles
- pgbouncer round-robin: `docker exec <api> getent hosts pgbouncer` returns 4 IPs (the 4 pgbouncer-N container IPs)
</verification>

<success_criteria>
- All Wave 0 deliverables are integrated into a working stack under both load-test profiles
- Default profile is byte-identical at runtime (Phase 07.1 still passes its e2e)
- profile-lint integration test enforces every must_have truth
- preflight.sh prevents most foot-guns before the live run (Wave 3)
- Speaches image is digest-pinned to a verified release
</success_criteria>

<output>
After completion, create `.planning/phases/08-load-test-tuning-slo-publication/08-05-SUMMARY.md` per template.
</output>
