# OpenWhispr Server — top-level Makefile (DEVEX-01).
# Phase 0: implements dev/test/lint/format/typecheck/up/down/clean/help.
# Future-phase targets stub-fail with a phase-N pointer.

.PHONY: dev test lint lint-rls format typecheck up down clean clean-stack help \
        contract-test contract-test-deployed contract-test-missing-keys e2e-test e2e-test-live \
        e2e-hermetic e2e-test-phase6 \
        load-test seed backup restore migrate migrate-rollback logs ps restart \
        verify-images

help:
	@grep -E '^[a-zA-Z0-9_-]+:' Makefile | awk -F: '{print $$1}' | sort -u

dev: up
	pnpm -r --parallel dev

test:
	pnpm test

lint:
	pnpm lint
	pnpm lint:english

lint-rls:
	pnpm exec tsx tools/lint-rls.ts

format:
	pnpm format

typecheck:
	pnpm typecheck

up:
	docker compose --profile default up -d

down:
	docker compose down

logs:
	docker compose logs -f

ps:
	docker compose ps

restart:
	$(MAKE) down && $(MAKE) up

verify-images:
	bash scripts/verify-images.sh

clean:
	rm -rf node_modules apps/*/node_modules packages/*/node_modules \
	       coverage reports .stryker-tmp dist

# Phase 02.6 / D-02 — operator-friendly stack reset.
#
# Tears down all containers (default + contract-test profiles), removes
# orphans, and DROPS named volumes. Required after `tools/bootstrap.sh`
# rotates secrets — without this, the `openwhispr_postgres_data` volume
# retains the original init password and migrations fail with
# `password authentication failed for user "openwhispr_owner"`. This was
# the Phase 02.5-04 first-attempt failure mode; this target makes the
# safe path one command.
clean-stack:
	docker compose --profile default --profile contract-test down -v --remove-orphans || true
	docker volume ls -q | grep -E '^openwhispr_' | xargs -r docker volume rm || true
	@echo "Stack volumes cleaned. Run 'tools/bootstrap.sh' to regenerate .env, then 'make build' + 'docker compose --profile default up -d --wait'."

# Phase 2 / Plan 06 — CONTRACT-01 conformance suite, locally.
#
# Brings the docker-compose stack to healthy (default profile + the
# Plan 06 contract-test profile that adds fixture-idp), seeds the
# conformance fixture users (Better Auth signUpEmail + email_verified
# patches), runs the conformance suite against http://api.localhost,
# tears down regardless of pass/fail. Operators target their own
# deployment via `make contract-test-deployed BACKEND_URL=...`.
# Phase 02.14 — runner moved INSIDE openwhispr_internal (Group E closure).
# The host-side runner could not resolve docker-internal DNS (e.g. when
# the api 302'd OAuth flows to http://fixture-idp:9000/...), so Group E
# tests failed with `getaddrinfo ENOTFOUND fixture-idp`. The runner now
# joins the same network the api sees. Two sequential `run --rm` calls:
# seed first (must succeed), then contract-test-runner. Both --rm so no
# stopped containers leak after the run.
# Phase 3 / Plan 02 — D-05A: hermetic contract-test profile picks the
# mock-mode LiteLLM config via LITELLM_CONFIG_FILE. Plan 03-01 wires the
# litellm service in docker-compose.yml to mount
# `./compose/litellm/${LITELLM_CONFIG_FILE:-litellm_config.yaml}`. With the
# override below, `make contract-test` boots LiteLLM with mock_response
# on every chat/audio model — no provider keys, no outbound network.
# Phase 3 / Plan 09 adds `make e2e-test` (separate target) for real-key e2e.
contract-test:
	LITELLM_CONFIG_FILE=litellm_config.contract.yaml OPENWHISPR_TEST_ROUTES=true docker compose --profile default --profile contract-test up -d --wait
	@LITELLM_CONFIG_FILE=litellm_config.contract.yaml OPENWHISPR_TEST_ROUTES=true docker compose --profile default --profile contract-test run --rm seed ; \
	rc=$$? ; \
	if [ $$rc -ne 0 ]; then docker compose down -v ; exit $$rc ; fi ; \
	LITELLM_CONFIG_FILE=litellm_config.contract.yaml OPENWHISPR_TEST_ROUTES=true docker compose --profile default --profile contract-test run --rm contract-test-runner ; \
	rc=$$? ; docker compose down -v ; exit $$rc

# Phase 3 / Plan 10 — Pitfall #8 contract test suite (missing-key → 503 NOT 401).
#
# Boots the standard contract-test stack BUT injects empty provider keys via
# a transient .env.missing-keys overlay so the api's transcribe / reason /
# diarization routes hit the unconfigured-provider 503 path. The contract
# tests in `packages/contract-tests/src/missing-key-503.test.ts` are gated
# by MISSING_KEY_TEST_MODE=1 — that env is set ONLY for the runner here so
# the standard `make contract-test` (which uses fake-but-present keys)
# leaves them skipped. A separate target keeps the assertion target focused:
# the standard suite asserts happy paths, this suite asserts the 503 envelope
# shape on misconfigured operators.
contract-test-missing-keys:
	@printf 'GROQ_API_KEY=\nOPENROUTER_API_KEY=\nPYANNOTE_API_KEY=\n' > .env.missing-keys
	LITELLM_CONFIG_FILE=litellm_config.contract.yaml OPENWHISPR_TEST_ROUTES=true \
	  docker compose --env-file .env --env-file .env.missing-keys \
	  --profile default --profile contract-test up -d --wait
	@LITELLM_CONFIG_FILE=litellm_config.contract.yaml OPENWHISPR_TEST_ROUTES=true \
	  docker compose --env-file .env --env-file .env.missing-keys \
	  --profile default --profile contract-test run --rm seed ; \
	rc=$$? ; \
	if [ $$rc -ne 0 ]; then docker compose down -v ; rm -f .env.missing-keys ; exit $$rc ; fi ; \
	MISSING_KEY_TEST_MODE=1 LITELLM_CONFIG_FILE=litellm_config.contract.yaml \
	  OPENWHISPR_TEST_ROUTES=true \
	  docker compose --env-file .env --env-file .env.missing-keys \
	  --profile default --profile contract-test run --rm \
	  -e MISSING_KEY_TEST_MODE=1 contract-test-runner ; \
	rc=$$? ; docker compose down -v ; rm -f .env.missing-keys ; exit $$rc

# Phase 04 / Plan 09 — `make e2e-test` (hermetic, gated on E2E=1).
#
# Brings up the full docker-compose stack PLUS the Plan 07 e2e overlay
# (mock-realtime + LiteLLM repointed at the e2e-realtime config). Runs
# the Plan 09 e2e tests via the dedicated `tests/e2e/vitest.e2e.config.ts`
# discovery glob:
#
#   * tests/e2e/agent-stream-first-line-latency.test.ts  (WIRE-07 SC#1)
#   * tests/e2e/realtime-soak-hermetic.test.ts           (SCALE-05 5-min)
#
# Hermetic — NO real provider keys required. The litellm container
# loads litellm_config.e2e-realtime.yaml (mock_response on every chat
# entry; realtime upstream pointed at mock-realtime). MOCK_DIARIZATION
# defaults true so /v1/audio/diarization short-circuits without a
# pyannote key. Live realtime against OpenAI is `make e2e-test-live`.
#
# CLAUDE.md mandatory-e2e clause requires `gated on E2E=1` — refuse to
# run without it so accidental `make e2e-test` from a non-e2e shell
# doesn't spin up Docker.
#
# Tear-down is unconditional (regardless of vitest exit code) so a
# failing test never leaves the stack live.
e2e-test:
	@if [ "$$E2E" != "1" ]; then \
	  echo "Refusing to run: E2E=1 required (CLAUDE.md mandatory-e2e gate)." ; \
	  echo "Usage: E2E=1 make e2e-test" ; \
	  exit 1 ; \
	fi
	@test -f .env || (echo "Refusing to run: .env not found at repo root. Run tools/bootstrap.sh first." && exit 1)
	OPENWHISPR_TEST_ROUTES=true MOCK_DIARIZATION=true \
	  docker compose -f docker-compose.yml -f compose/e2e/docker-compose.e2e.yml \
	  --profile default --profile e2e up -d
	@# NO --wait. Rationale (mirrored from tests/e2e/compose-helper.ts):
	@# the observability stack (grafana in particular) is flaky on
	@# cold-cache laptops and occasionally reports unhealthy for a few
	@# seconds before stabilizing. `up --wait` would fail the entire run
	@# on a transient grafana hiccup that the e2e tests don't care
	@# about. The api healthcheck via Traefik is the only readiness
	@# signal these tests actually need; the test files themselves
	@# probe the api before driving any assertion. We poll the api
	@# /api/health endpoint with a 120s deadline before invoking vitest.
	@echo "Waiting for api /api/health via Traefik (120s deadline)..."
	@DEADLINE=$$(( $$(date +%s) + 120 )) ; \
	  until curl -ksSf https://api.localhost/api/health >/dev/null 2>&1 ; do \
	    if [ $$(date +%s) -ge $$DEADLINE ]; then \
	      echo "api /api/health did not become reachable within 120s" ; \
	      docker compose -f docker-compose.yml -f compose/e2e/docker-compose.e2e.yml \
	        --profile default --profile e2e down -v --remove-orphans ; \
	      exit 1 ; \
	    fi ; \
	    sleep 2 ; \
	  done
	@echo "api healthy. Seeding conformance fixtures..."
	@OPENWHISPR_TEST_ROUTES=true MOCK_DIARIZATION=true \
	  docker compose -f docker-compose.yml -f compose/e2e/docker-compose.e2e.yml \
	    --profile default --profile contract-test --profile e2e \
	    run --rm seed ; \
	  rc=$$? ; \
	  if [ $$rc -ne 0 ]; then \
	    docker compose -f docker-compose.yml -f compose/e2e/docker-compose.e2e.yml \
	      --profile default --profile e2e down -v --remove-orphans ; \
	    exit $$rc ; \
	  fi
	@E2E=1 OPENWHISPR_TEST_ROUTES=true MOCK_DIARIZATION=true \
	  NODE_TLS_REJECT_UNAUTHORIZED=0 \
	  pnpm exec vitest run --config tests/e2e/vitest.e2e.config.ts ; \
	  rc=$$? ; \
	  docker compose -f docker-compose.yml -f compose/e2e/docker-compose.e2e.yml \
	    --profile default --profile e2e down -v --remove-orphans ; \
	  exit $$rc

# Phase 3 / Plan 09 — D-05B: E2E contract suite against REAL provider APIs.
# Operator supplies .env.e2e with OPENROUTER_API_KEY + GROQ_API_KEY +
# OPENAI_API_KEY + PYANNOTE_API_KEY (real values, NOT bootstrap-generated).
# Costs real money — runs locally or via scheduled (NOT main) CI.
# Mounts the production litellm_config.yaml (NOT the mock contract config),
# exercises real provider key paths end-to-end. Diarization uses the Fastify
# sync-wrapper against pyannote.ai directly (D-07 REVISED — NOT via LiteLLM).
# .env.e2e is gitignored via the .env.* glob in .gitignore.
#
# Phase 04 / Plan 09 deviation: renamed from `e2e-test` to `e2e-test-live`
# so the new hermetic `e2e-test` target (above) can take the canonical name
# per the plan + CLAUDE.md mandatory-e2e contract. The live-key target is
# operator-only (no .env.e2e on a fresh clone) so this rename does NOT
# break the default contributor path.
e2e-test-live:
	@test -f .env.e2e || (echo "Refusing to run: .env.e2e not found. Create it (see .env.e2e.example) with real OPENROUTER_API_KEY + GROQ_API_KEY + OPENAI_API_KEY + PYANNOTE_API_KEY values." && exit 1)
	@grep -q '^OPENROUTER_API_KEY=' .env.e2e || (echo "OPENROUTER_API_KEY missing in .env.e2e" && exit 1)
	@grep -q '^GROQ_API_KEY=' .env.e2e || (echo "GROQ_API_KEY missing in .env.e2e (D-11 — Whisper-large-v3 STT)" && exit 1)
	@grep -q '^OPENAI_API_KEY=' .env.e2e || (echo "OPENAI_API_KEY missing in .env.e2e (D-12 — Realtime WSS direct)" && exit 1)
	@grep -q '^PYANNOTE_API_KEY=' .env.e2e || (echo "PYANNOTE_API_KEY missing in .env.e2e (D-07 REVISED — diarization sync-wrapper requires it)" && exit 1)
	OPENWHISPR_TEST_ROUTES=true LITELLM_CONFIG_FILE=litellm_config.yaml RUN_E2E=true \
	  docker compose --env-file .env --env-file .env.e2e \
	  --profile default --profile contract-test up -d --wait
	@OPENWHISPR_TEST_ROUTES=true RUN_E2E=true docker compose --env-file .env --env-file .env.e2e \
	  --profile default --profile contract-test run --rm seed ; \
	rc=$$? ; \
	if [ $$rc -ne 0 ]; then docker compose down -v ; exit $$rc ; fi ; \
	OPENWHISPR_TEST_ROUTES=true RUN_E2E=true docker compose --env-file .env --env-file .env.e2e \
	  --profile default --profile contract-test run --rm contract-test-runner ; \
	rc=$$? ; docker compose down -v ; exit $$rc

# DISCIPLINE rule 3 back-fill — host-side e2e suite against the
# hermetic mock-LiteLLM stack. Unlike `make e2e-test` (which requires
# real provider keys in .env.e2e), this target runs from a fresh clone
# with NO real keys: every chat-completions / transcription call short-
# circuits inside LiteLLM via mock_response. Diarization runs in mock
# mode (MOCK_DIARIZATION=true) so PYANNOTE_API_KEY is not required;
# realtime asserts auth gate + proxy hop only (the wider live OpenAI
# Realtime path is `make e2e-test` territory).
#
# The test runner is HOST-SIDE (Node + vitest), dialing
# https://api.localhost through Traefik with the dev self-signed cert.
# Compose stack-up + tear-down is handled by tests/e2e/setup.ts so
# this target is a single-shot `pnpm test:hermetic` invocation.
e2e-hermetic:
	cd tests/e2e && E2E=1 LITELLM_CONFIG_FILE=litellm_config.contract.yaml \
	  OPENWHISPR_TEST_ROUTES=true \
	  MOCK_DIARIZATION=true \
	  node_modules/.bin/vitest run --config vitest.config.ts

# Phase 6 / Plan 06-12a — verification-gate sub-target (initial 2-test subset).
#
# Wave 3 of Phase 6 lands eight e2e tests under tests/e2e/ behind a
# real docker-compose stack via testcontainers DockerComposeEnvironment.
# Plan 06-12a is the FIRST sub-plan (lowest-blast-radius pair —
# probes-dependency + audit-log-write) and seeds this Makefile entry.
# Plan 06-12b / 06-12c add more tests via their own commits; Plan
# 06-12d folds the full suite back into the global `e2e-test`
# target.
#
# Unlike `e2e-test` (which uses a host-side compose-helper with the
# e2e profile + mock-realtime overlay), the Phase 6 gate boots the
# DEFAULT profile via testcontainers and uses `docker pause` /
# direct postgres `psql` exec for its assertions. The vitest config
# (tests/e2e/vitest.e2e.config.ts) carries NO globalSetup so each
# test file owns its compose lifecycle (beforeAll boots, afterAll
# tears down with removeVolumes:true).
#
# Hermetic — NO real provider keys required. The compose stack runs
# with LITELLM_CONFIG_FILE=litellm_config.contract.yaml + MOCK_DIARIZATION=true
# so a fresh clone with empty provider env vars boots the stack
# successfully.
#
# Refuses to run unless E2E=1 per CLAUDE.md mandatory-e2e gate.
e2e-test-phase6:
	@if [ "$$E2E" != "1" ]; then \
	  echo "Refusing to run: E2E=1 required (CLAUDE.md mandatory-e2e gate)." ; \
	  echo "Usage: E2E=1 make e2e-test-phase6" ; \
	  exit 1 ; \
	fi
	@test -f .env || (echo "Refusing to run: .env not found at repo root. Run tools/bootstrap.sh first." && exit 1)
	E2E=1 LITELLM_CONFIG_FILE=litellm_config.contract.yaml \
	  OPENWHISPR_TEST_ROUTES=true MOCK_DIARIZATION=true \
	  NODE_TLS_REJECT_UNAUTHORIZED=0 \
	  pnpm exec vitest run --config tests/e2e/vitest.e2e.config.ts \
	    tests/e2e/probes-dependency.test.ts \
	    tests/e2e/audit-log-write.test.ts

# Run the conformance suite against an arbitrary deployed backend.
# `make contract-test-deployed BACKEND_URL=https://api.customer.com AUTH_URL=...`
contract-test-deployed:
	@test "$$NODE_TLS_REJECT_UNAUTHORIZED" != "0" || (echo "refusing to run with TLS verification disabled (NODE_TLS_REJECT_UNAUTHORIZED=0)" && exit 1)
	@test -n "$(BACKEND_URL)" || (echo "set BACKEND_URL=https://api.customer.com" && exit 1)
	BACKEND_URL=$(BACKEND_URL) AUTH_URL=$(AUTH_URL) \
	  pnpm -F @openwhispr/contract-tests test --run

load-test:
	@echo "load-test target lands in Phase 8"; exit 1

seed:
	@echo "seed target lands in Phase 1"; exit 1

backup:
	bash scripts/backup/make-backup.sh

restore:
	bash scripts/backup/make-restore.sh

migrate:
	pnpm --filter @openwhispr/data exec tsx src/migrate.ts

migrate-rollback:
	pnpm --filter @openwhispr/data exec drizzle-kit drop --config=drizzle.config.ts
