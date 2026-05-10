# OpenWhispr Server — top-level Makefile (DEVEX-01).
# Phase 0: implements dev/test/lint/format/typecheck/up/down/clean/help.
# Future-phase targets stub-fail with a phase-N pointer.

.PHONY: dev test lint lint-rls format typecheck up down clean clean-stack help \
        contract-test contract-test-deployed load-test seed backup restore \
        migrate migrate-rollback logs ps restart verify-images

help:
	@grep -E '^[a-zA-Z_-]+:' Makefile | awk -F: '{print $$1}' | sort -u

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
contract-test:
	OPENWHISPR_TEST_ROUTES=true docker compose --profile default --profile contract-test up -d --wait
	@OPENWHISPR_TEST_ROUTES=true docker compose --profile default --profile contract-test run --rm seed ; \
	rc=$$? ; \
	if [ $$rc -ne 0 ]; then docker compose down -v ; exit $$rc ; fi ; \
	OPENWHISPR_TEST_ROUTES=true docker compose --profile default --profile contract-test run --rm contract-test-runner ; \
	rc=$$? ; docker compose down -v ; exit $$rc

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
