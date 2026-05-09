# OpenWhispr Server — top-level Makefile (DEVEX-01).
# Phase 0: implements dev/test/lint/format/typecheck/up/down/clean/help.
# Future-phase targets stub-fail with a phase-N pointer.

.PHONY: dev test lint lint-rls format typecheck up down clean help \
        contract-test contract-test-deployed load-test seed backup restore \
        migrate migrate-rollback logs ps restart

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

clean:
	rm -rf node_modules apps/*/node_modules packages/*/node_modules \
	       coverage reports .stryker-tmp dist

# Phase 2 / Plan 06 — CONTRACT-01 conformance suite, locally.
#
# Brings the docker-compose stack to healthy (default profile + the
# Plan 06 contract-test profile that adds fixture-idp), seeds the
# conformance fixture users (Better Auth signUpEmail + email_verified
# patches), runs the conformance suite against http://api.localhost,
# tears down regardless of pass/fail. Operators target their own
# deployment via `make contract-test-deployed BACKEND_URL=...`.
contract-test:
	docker compose --profile default --profile contract-test up -d --wait
	@SMTP_HOST= pnpm -F @openwhispr/data run seed:conformance ; \
	BACKEND_URL=http://api.localhost AUTH_URL=http://auth.localhost \
	  pnpm -F @openwhispr/contract-tests test --run ; \
	rc=$$? ; docker compose down -v ; exit $$rc

# Run the conformance suite against an arbitrary deployed backend.
# `make contract-test-deployed BACKEND_URL=https://api.customer.com AUTH_URL=...`
contract-test-deployed:
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
