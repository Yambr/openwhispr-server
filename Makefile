# OpenWhispr Server — top-level Makefile (DEVEX-01).
# Phase 0: implements dev/test/lint/format/typecheck/up/down/clean/help.
# Future-phase targets stub-fail with a phase-N pointer.

.PHONY: dev test lint lint-rls lint-compose-resources lint\:lockers install-gitleaks lint\:gitleaks format typecheck up down clean clean-stack tls-trust help \
        contract-test contract-test-deployed contract-test-missing-keys e2e-test e2e-test-live \
        e2e-hermetic e2e-test-phase6 e2e-cjm e2e-cjm-teardown smoke \
        load-test load-smoke seed backup restore migrate migrate-rollback logs ps restart \
        verify-images verify release-gate \
        up-with-observability up-with-storage up-with-ingress up-with-pgbouncer up-with-dev-tools up-full

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

# Phase 20 / Plan 01 / SR-20.1 + SR-20.2 — compose resource-governance gate.
# Asserts every long-running service in docker-compose.yml + compose/*.yml
# declares `deploy.resources.limits.memory` (>= ROADMAP floor) and the
# SR-20.2 services declare `restart: unless-stopped`. Wired into CI via
# the compose-lint job (.github/workflows/ci.yml, Phase 20-03).
lint-compose-resources:
	pnpm exec tsx tools/lint-compose-resources.ts

# Phase 31 / Plan 07 / LOCKER-08 — aggregate lockers gate.
# Runs all six locker binaries in sequence under one Make target so
# lefthook + ci.yml + nightly.yml + Makefile share one source of truth.
# The aggregate runs `pnpm lint:lockers` which chains the per-locker
# package.json scripts (LOCKER-01..06 in landing order). The script
# preserves each binary's --warn-only flag where set (Phase 31 ships
# LOCKER-04/05/06 WARN-only; the flip lands in 31-08 / 37 / 36.a).
lint\:lockers:
	pnpm lint:lockers

# Phase 260516-kya / Plan 01 — secret-leak hard gate.
# install-gitleaks: idempotent installer (brew on macOS, curl-tarball
# on Linux); no-op when gitleaks >= v8.x already on PATH.
# lint:gitleaks: scans the working tree against .gitleaks.toml (the
# single source of truth shared by lefthook L1+L2 and CI L3).
install-gitleaks:
	bash tools/install-gitleaks.sh

lint\:gitleaks:
	pnpm lint:gitleaks

format:
	pnpm format

typecheck:
	pnpm typecheck

# Phase 14 / Plan 14-03 — slim-core + opt-in overlays.
#
# `up` brings the bare 6-service slim-core stack (api, web, worker,
# postgres, valkey, litellm + the migrate one-shot). Layer overlays via
# the per-overlay `up-with-*` targets, or `up-full` to layer them all
# (observability + storage + ingress + pgbouncer + dev-tools).
#
# `--wait` makes the target block until every long-running service is
# healthy — the OSS quickstart contract per CONTEXT.md.
up:
	docker compose up -d --wait

up-with-observability:
	docker compose -f docker-compose.yml -f compose/docker-compose.observability.yml up -d --wait

up-with-storage:
	docker compose -f docker-compose.yml -f compose/docker-compose.storage.yml up -d --wait

up-with-ingress:
	docker compose -f docker-compose.yml -f compose/docker-compose.ingress.yml up -d --wait

up-with-pgbouncer:
	docker compose -f docker-compose.yml -f compose/docker-compose.pgbouncer.yml up -d --wait

up-with-dev-tools:
	docker compose -f docker-compose.yml -f compose/docker-compose.dev-tools.yml up -d --wait

# `up-full` chains every NON-contract-test overlay in order:
# observability -> storage -> ingress -> pgbouncer -> dev-tools.
up-full:
	docker compose \
		-f docker-compose.yml \
		-f compose/docker-compose.observability.yml \
		-f compose/docker-compose.storage.yml \
		-f compose/docker-compose.ingress.yml \
		-f compose/docker-compose.pgbouncer.yml \
		-f compose/docker-compose.dev-tools.yml \
		up -d --wait

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

# Phase 17 / Plan 17-01 — TLS-01 / TLS-02-dev / TLS-04.
#
# `make tls-trust` installs a locally-trusted dev CA via mkcert (one-time per
# machine) and mints a single SAN cert at compose/traefik/certs/local.{crt,key}
# covering EXACTLY 5 hosts: api.localhost, web.localhost, app.localhost,
# grafana.localhost, mailpit.localhost. No wildcards (PITFALLS §13 — list each
# host explicitly).
#
# Idempotency: regen ONLY if the cert is missing OR expiring in <30 days OR
# missing the explicit-host SAN list OR still carrying a `*.localhost`
# wildcard left over from the openssl bootstrap path. Otherwise prints a
# skip message and exits 0.
#
# mkcert MUST be installed by the operator (no sudo, no --auto-install per
# CONTEXT Q1-B3). On absence we exit 2 with a platform-specific install hint
# and a forward-reference to docs/operations.md#air-gap-mkcert (authored in
# 17-02).
tls-trust:
	@command -v mkcert >/dev/null 2>&1 || { \
	  echo "mkcert not found in PATH."; \
	  case "$$(uname -s)" in \
	    Darwin) echo "  Install: brew install mkcert nss";; \
	    Linux)  echo "  Install: apt install mkcert  (or see docs/operations.md#air-gap-mkcert)";; \
	    *)      echo "  See docs/operations.md#air-gap-mkcert";; \
	  esac; exit 2; }
	@mkcert -install
	@mkdir -p compose/traefik/certs
	@# Idempotency: skip if local.crt valid >=30 days AND covers the canonical
	@# 10-host list AND no *.localhost wildcard. WR-02 review fix: the host
	@# list now matches `tools/bootstrap.sh` byte-for-byte (10 hosts incl.
	@# `auth.localhost`, `minio-console.localhost`, `api.example.test`,
	@# `auth.example.test`, plain `localhost`); the idempotency predicate
	@# checks 3 representative hosts spanning both .localhost and
	@# .example.test suffixes so a SAN downgrade between this Makefile and
	@# bootstrap.sh is detectable on re-run.
	@# WR-04 review fix (2026-05-15): `set -e` at the top of the multi-line
	@# shell command makes the else-branch's mkcert/cp/chmod chain fail-fast.
	@# Previously the chain used `\`-continuations + `;` separators with no
	@# `&&` between commands, so a non-zero exit from `mkcert -cert-file …`
	@# would NOT abort the recipe — subsequent `cp` and `chmod` invocations
	@# still ran and the final `fi` could exit 0 even after a partial regen.
	@set -e; \
	if openssl x509 -checkend $$((86400*30)) -noout -in compose/traefik/certs/local.crt >/dev/null 2>&1 \
	   && openssl x509 -in compose/traefik/certs/local.crt -noout -text | grep -q 'DNS:api.localhost' \
	   && openssl x509 -in compose/traefik/certs/local.crt -noout -text | grep -q 'DNS:auth.localhost' \
	   && openssl x509 -in compose/traefik/certs/local.crt -noout -text | grep -q 'DNS:api.example.test' \
	   && ! openssl x509 -in compose/traefik/certs/local.crt -noout -text | grep -q 'DNS:\*\.localhost'; then \
	  echo "tls-trust: cert valid + canonical 10-host list — skip"; \
	else \
	  mkcert -cert-file compose/traefik/certs/local.crt \
	         -key-file  compose/traefik/certs/local.key \
	    localhost \
	    api.localhost web.localhost app.localhost auth.localhost \
	    grafana.localhost minio-console.localhost mailpit.localhost \
	    api.example.test auth.example.test \
	    127.0.0.1 ::1; \
	  cp "$$(mkcert -CAROOT)/rootCA.pem" compose/traefik/certs/root-ca.crt; \
	  chmod 644 compose/traefik/certs/local.crt compose/traefik/certs/root-ca.crt; \
	  chmod 600 compose/traefik/certs/local.key; \
	fi

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
#
# Phase 6 / Plan 06-12d — global e2e-test gate now includes the
# Phase 6 suite (e2e-test-phase6) so the project-wide gate exercises
# observability + ops hardening + workers end-to-end. The Phase 6
# suite owns its own testcontainers lifecycle (independent from the
# Phase 04 hermetic stack); each runs sequentially so tear-down
# leaves no stale state for the next.
e2e-test: e2e-test-phase6
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
	@echo "Phase 6 e2e — serial mode (Plan 51-25). Each test gets a clean compose lifecycle + a volume/network prune between runs so litellm boot + observability stack don't compete for Mac host resources."
	@set -e ; \
	  rc=0 ; \
	  for f in \
	    tests/e2e/probes-dependency.test.ts \
	    tests/e2e/audit-log-write.test.ts \
	    tests/e2e/horizontal-scale.test.ts \
	    tests/e2e/ssrf-block.test.ts \
	    tests/e2e/rate-limit-layered.test.ts \
	    tests/e2e/reconciliation-drift.test.ts \
	    tests/e2e/log-scrub-sentinel.test.ts \
	    tests/e2e/otel-trace-propagation.test.ts ; \
	  do \
	    echo "" ; \
	    echo "================================================" ; \
	    echo "Phase 6 e2e — running $$f" ; \
	    echo "================================================" ; \
	    pass=0 ; \
	    for attempt in 1 2 ; do \
	      if E2E=1 LITELLM_CONFIG_FILE=litellm_config.contract.yaml \
	        OPENWHISPR_TEST_ROUTES=true MOCK_DIARIZATION=true \
	        NODE_TLS_REJECT_UNAUTHORIZED=0 \
	        TESTCONTAINERS_RYUK_DISABLED=true \
	        OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317 \
	        pnpm exec vitest run --config tests/e2e/vitest.e2e.config.ts $$f ; \
	      then \
	        pass=1 ; break ; \
	      fi ; \
	      echo "Phase 6 e2e — attempt $$attempt failed for $$f; tearing down + retry" ; \
	      docker compose -p openwhispr down -v --remove-orphans >/dev/null 2>&1 || true ; \
	      docker volume prune -f >/dev/null 2>&1 || true ; \
	      sleep 10 ; \
	    done ; \
	    if [ "$$pass" != "1" ]; then \
	      echo "FAIL: $$f" ; \
	      rc=1 ; \
	    fi ; \
	    docker compose -p openwhispr down -v --remove-orphans >/dev/null 2>&1 || true ; \
	    docker volume prune -f >/dev/null 2>&1 || true ; \
	  done ; \
	  exit $$rc

# Run the conformance suite against an arbitrary deployed backend.
# `make contract-test-deployed BACKEND_URL=https://api.customer.com AUTH_URL=...`
contract-test-deployed:
	@test "$$NODE_TLS_REJECT_UNAUTHORIZED" != "0" || (echo "refusing to run with TLS verification disabled (NODE_TLS_REJECT_UNAUTHORIZED=0)" && exit 1)
	@test -n "$(BACKEND_URL)" || (echo "set BACKEND_URL=https://api.customer.com" && exit 1)
	BACKEND_URL=$(BACKEND_URL) AUTH_URL=$(AUTH_URL) \
	  pnpm -F @openwhispr/contract-tests test --run

# Phase 08 / Plan 06 — k6 load-test entrypoint.
#
# `make load-test PROFILE=mock` (default) runs against mock-litellm —
# isolates api+pooler+postgres+valkey latency from external LLM upstream.
# `make load-test PROFILE=realistic` boots Speaches + Whisper-large-v3
# and pre-warms the model before k6 starts so cold-start is invisible.
# The orchestrator (tools/load-test/scripts/run.sh) handles preflight,
# stack-up, k6 invocation, run-output capture, and teardown.
load-test:
	@bash tools/load-test/scripts/run.sh $(or $(PROFILE),mock)

# Phase 44 / Plan 44-01 / L3 — PR-time k6 mock load smoke (≤ 2 min).
# Per memory feedback_loadtest_cost_discipline: PROFILE=mock ONLY; paid
# providers gated behind OPENWHISPR_LOADTEST_ALLOW_PAID=1. Refuses to
# run when ALLOW_PAID is set so a PR cannot accidentally bill upstream.
# Wall-clock target: < 120 s. Full realistic-profile plateau remains
# nightly-only.
load-smoke:
	@if [ "$$OPENWHISPR_LOADTEST_ALLOW_PAID" = "1" ]; then \
		echo "load-smoke: REFUSING to run with OPENWHISPR_LOADTEST_ALLOW_PAID=1 — mock-only on PR"; \
		exit 1; \
	fi
	@PROFILE=mock BASELINE_VUS=$${BASELINE_VUS:-5} BASELINE_DURATION_SUSTAIN=$${BASELINE_DURATION_SUSTAIN:-60s} \
		bash tools/load-test/scripts/run.sh mock

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

# ─── Phase 13 / Plan 01 / Task 13-01-08 — CJM ships-first gate ────────────
# Boots a hermetic compose project (`-p e2e-cjm`) using the base file +
# embedded-litellm overlay, waits for /api/health migrations_completed=true,
# runs the playwright-bdd suite, and ALWAYS tears down via a trap. If the
# contributor was running their own `openwhispr` project, it is `stop`'d
# before boot and `start`'d again in the teardown. Retry-on-flake is BANNED
# (D-12). Gated by E2E_CJM=1.
# Phase 22 / Plan 22-01 / SR-22.1 — synthetic-transaction smoke layer.
#
# Runs five HTTP probes (`tests/smoke/*.smoke.test.ts`) against the live
# stack to prove functional readiness AFTER `docker compose up --wait`
# and BEFORE the heavier `make e2e-cjm` cycle. Wall-clock target: < 5 s.
# Per memory `feedback_smoke_before_full_e2e` + `feedback_check_loki_after_tests`.
smoke:
	@echo "smoke: probing live stack at https://api.localhost + https://web.localhost"
	@pnpm exec vitest run --config vitest.smoke.config.ts

e2e-cjm:
	@if [ "$$E2E_CJM" != "1" ]; then \
		echo "e2e-cjm: refusing to run — set E2E_CJM=1 (this target boots a hermetic compose project and stops/restarts your local stack)"; \
		exit 1; \
	fi
	@# Phase 13 / Plan 02 / Task 13-02-04: gate the pipeline on the
	@# CJM-doc + .feature cross-ref lint BEFORE incurring docker compose
	@# costs. Mode 2 (--features) + Mode 3 (--check-expected-red) together
	@# enforce the D-10 "doc before features" invariant and the
	@# `@expected-red ↔ @after-phase-N` pairing rule.
	@pnpm tsx tools/lint-cjm-doc.ts --features tests/e2e-cjm/features --check-expected-red
	@if docker compose -p openwhispr ps -q 2>/dev/null | head -1 | grep -q . ; then \
		echo "e2e-cjm: stopping user 'openwhispr' project (will restart on teardown)"; \
		echo "1" > .e2e-cjm-user-was-running; \
		docker compose -p openwhispr stop; \
	else \
		echo "0" > .e2e-cjm-user-was-running; \
	fi
	@set -e; \
	trap '$(MAKE) -s e2e-cjm-teardown' EXIT INT TERM; \
	docker compose -p e2e-cjm \
		-f docker-compose.yml -f compose/docker-compose.embedded-litellm.yml \
		-f compose/docker-compose.storage.yml \
		-f compose/docker-compose.ingress.yml \
		-f tests/e2e-cjm/compose-overrides.yml \
		--profile default up -d --build --wait; \
	pnpm tsx tests/e2e-cjm/support/wait-for-readiness.ts; \
	if [ -n "$$SCENARIO" ]; then \
		pnpm exec playwright test --grep "$$SCENARIO" --config tests/e2e-cjm/playwright.config.ts; \
	else \
		pnpm exec playwright test --grep-invert "@expected-red" --config tests/e2e-cjm/playwright.config.ts; \
	fi

e2e-cjm-teardown:
	-@docker compose -p e2e-cjm \
		-f docker-compose.yml -f compose/docker-compose.embedded-litellm.yml \
		-f compose/docker-compose.storage.yml \
		-f tests/e2e-cjm/compose-overrides.yml \
		down -v --remove-orphans
	@if [ -f .e2e-cjm-user-was-running ] && [ "$$(cat .e2e-cjm-user-was-running)" = "1" ]; then \
		echo "e2e-cjm-teardown: restarting user 'openwhispr' project"; \
		docker compose -p openwhispr start; \
	fi
	-@rm -f .e2e-cjm-user-was-running

# ---------------------------------------------------------------------------
# Phase 51 / Plan 51-aux — release sweep entrypoints
# ---------------------------------------------------------------------------
#
# Two canonical aggregate targets — one for the dev/PR loop, one for the
# pre-tag gate. Both fail-fast (the cheaper steps run first); both echo
# a "STAGE n/N" banner before each step so the operator can tell at a
# glance where a run died.
#
#   make verify        — no docker, no network. ~3–5 min on M-class. The
#                        canonical "I'm about to push a branch" loop.
#                        Runs:  lockers → biome → typecheck → unit +
#                        integration tests (testcontainers do spin up
#                        Postgres, so docker daemon must be reachable,
#                        but no docker-compose stack is touched).
#
#   make release-gate  — everything `verify` does + the full live-stack
#                        suite (contract → compose up → smoke → e2e-cjm →
#                        load-smoke). Tear-down is guaranteed via the
#                        e2e-cjm teardown helper. ~30–45 min on M-class.
#                        Run this before tagging a release or merging a
#                        PR that touches compose/, charts/, or the wire
#                        surface.
#
# Both targets honour `-k`/`--keep-going` so partial failures still print
# every red signal in one pass (useful in CI). For local "fix until
# green" loops, run the failing stage in isolation (e.g. `make e2e-cjm`).

# `verify` — fast feedback. No live stack required.
verify:
	@echo
	@echo "==[ STAGE 1/4 ]== lint:lockers (constitutional gates)"
	@$(MAKE) -s lint:lockers
	@echo
	@echo "==[ STAGE 2/4 ]== lint (biome + english-only)"
	@$(MAKE) -s lint
	@echo
	@echo "==[ STAGE 3/4 ]== typecheck (tsc -b across all workspaces)"
	@$(MAKE) -s typecheck
	@echo
	@echo "==[ STAGE 4/4 ]== test (unit + integration via testcontainers)"
	@$(MAKE) -s test
	@echo
	@echo "verify: OK"

# `release-gate` — full pre-tag sweep. Boots a real compose stack.
#
# Step ordering rationale:
#   1–4  verify (fast)            — bail before paying docker cost.
#   5    contract-test            — wire-surface sanity (mock-LiteLLM,
#                                    no full stack yet).
#   6    compose down -v + up     — clean slate; --wait blocks until
#                                    every service is healthy or migrate
#                                    has exited 0.
#   7    smoke                    — vitest smoke probe against
#                                    https://api.localhost + web.localhost.
#                                    Fails fast on TLS / DNS / nginx-
#                                    label / startup-probe regressions.
#   8    e2e-cjm                  — Playwright + Cucumber against the
#                                    booted stack. Tears down its own
#                                    project on EXIT.
#   9    load-smoke               — ≤5 VU × ≤60 s k6 plateau (Speaches +
#                                    mock-LiteLLM only; paid providers
#                                    gated by OPENWHISPR_LOADTEST_ALLOW_PAID).
#  10    down -v                  — best-effort teardown.
release-gate:
	@echo
	@echo "==[ release-gate 1/10 ]== verify (lockers + lint + typecheck + tests)"
	@$(MAKE) -s verify
	@echo
	@echo "==[ release-gate 2/10 ]== contract-test"
	@$(MAKE) -s contract-test
	@echo
	@echo "==[ release-gate 3/10 ]== docker compose down -v (clean slate)"
	-@docker compose -p openwhispr down -v --remove-orphans 2>/dev/null
	@echo
	@echo "==[ release-gate 4/10 ]== docker compose build (multi-arch images)"
	@docker compose build
	@echo
	@echo "==[ release-gate 5/10 ]== docker compose up -d --wait (full slim+overlays)"
	@docker compose -f docker-compose.yml \
		-f compose/docker-compose.storage.yml \
		-f compose/docker-compose.ingress.yml \
		up -d --wait --wait-timeout 300
	@echo
	@echo "==[ release-gate 6/10 ]== smoke (vitest live-stack probes)"
	@$(MAKE) -s smoke
	@echo
	@echo "==[ release-gate 7/10 ]== e2e-cjm (Playwright + Cucumber)"
	@E2E_CJM=1 $(MAKE) -s e2e-cjm
	@echo
	@echo "==[ release-gate 8/10 ]== load-smoke (≤5 VU × ≤60 s plateau)"
	@$(MAKE) -s load-smoke
	@echo
	@echo "==[ release-gate 9/10 ]== verify-images (image-digest pin check)"
	@$(MAKE) -s verify-images
	@echo
	@echo "==[ release-gate 10/10 ]== docker compose down -v (teardown)"
	-@docker compose -p openwhispr down -v --remove-orphans 2>/dev/null
	@echo
	@echo "release-gate: OK — repository is ready to tag."
