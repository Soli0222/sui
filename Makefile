.PHONY: help test-db-up test-db-down typecheck test-unit test-integration test-e2e build \
	act-typecheck act-test-unit act-test-integration act-test-e2e act-build act-all

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Local test targets
# ---------------------------------------------------------------------------

test-db-up: ## Start test DB (compose_db.yaml)
	docker compose -f compose_db.yaml up -d --wait

test-db-down: ## Stop test DB
	docker compose -f compose_db.yaml down

typecheck: ## Run typecheck
	pnpm --filter @sui/backend prisma:generate
	pnpm typecheck

test-unit: ## Run unit tests
	pnpm test

test-integration: test-db-up ## Run integration tests (starts test DB)
	pnpm --filter @sui/backend prisma:generate
	pnpm --filter @sui/backend test:db:migrate
	pnpm --filter @sui/backend test:integration

test-e2e: test-db-up ## Run E2E tests (starts test DB)
	pnpm --filter @sui/backend prisma:generate
	pnpm --filter @sui/backend test:db:migrate
	pnpm test:e2e

build: ## Run production build
	pnpm build

# ---------------------------------------------------------------------------
# act targets (GitHub Actions local runner)
# ---------------------------------------------------------------------------

act-typecheck: ## Run typecheck job via act
	act -j typecheck

act-test-unit: ## Run test-unit job via act
	act -j test-unit

act-test-integration: test-db-down ## Run test-integration job via act (stops local DB first)
	act -j test-integration

act-test-e2e: test-db-down ## Run test-e2e job via act (stops local DB first)
	act -j test-e2e

act-build: ## Run build job via act
	act -j test-build

act-all: ## Run all act jobs sequentially (stops local DB first)
	$(MAKE) test-db-down
	act -j typecheck
	act -j test-unit
	act -j test-build
	act -j test-integration
	act -j test-e2e
