# OpenWhispr Server — top-level Makefile (DEVEX-01).
# Phase 0: implements dev/test/lint/format/typecheck/up/down/clean/help.
# Future-phase targets stub-fail with a phase-N pointer.

.PHONY: dev test lint format typecheck up down clean help \
        contract-test load-test seed backup restore migrate migrate-rollback \
        logs ps restart

help:
	@grep -E '^[a-zA-Z_-]+:' Makefile | awk -F: '{print $$1}' | sort -u

dev: up
	pnpm -r --parallel dev

test:
	pnpm test

lint:
	pnpm lint
	pnpm lint:english

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

contract-test:
	@echo "contract-test target lands in Phase 2"; exit 1

load-test:
	@echo "load-test target lands in Phase 8"; exit 1

seed:
	@echo "seed target lands in Phase 1"; exit 1

backup:
	@echo "backup target lands in Phase 1"; exit 1

restore:
	@echo "restore target lands in Phase 1"; exit 1

migrate:
	pnpm --filter @openwhispr/data exec tsx src/migrate.ts

migrate-rollback:
	pnpm --filter @openwhispr/data exec drizzle-kit drop --config=drizzle.config.ts
