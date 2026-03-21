.PHONY: help test-db-up test-db-down lint typecheck test-unit test-integration test-e2e build \
	act-lint act-typecheck act-test-unit act-test-integration act-test-e2e act-build act-all

TEST_DATABASE_URL ?= postgresql://sui_test:sui_test@localhost:5555/sui_test

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Local test targets
# ---------------------------------------------------------------------------

test-db-up: ## Start test DB (compose_db.yaml)
	docker compose -f compose_db.yaml up -d --wait

test-db-down: ## Stop test DB
	docker compose -f compose_db.yaml down
	@# Also kill any leftover act service containers using the test DB port
	@docker ps -q --filter "publish=5555" | xargs -r docker rm -f 2>/dev/null || true

lint: ## Run lint
	pnpm lint

typecheck: ## Run typecheck
	pnpm --filter @sui/db db:generate
	pnpm typecheck

test-unit: ## Run unit tests
	pnpm test

test-integration: test-db-down test-db-up ## Run integration tests (restarts test DB)
	pnpm --filter @sui/db db:generate
	DATABASE_URL=$(TEST_DATABASE_URL) pnpm --filter @sui/db prisma:migrate
	pnpm --filter @sui/backend test:integration
	$(MAKE) test-db-down

test-e2e: test-db-down test-db-up ## Run E2E tests (restarts test DB)
	pnpm --filter @sui/db db:generate
	DATABASE_URL=$(TEST_DATABASE_URL) pnpm --filter @sui/db prisma:migrate
	pnpm test:e2e
	$(MAKE) test-db-down

build: ## Run production build
	pnpm build

# ---------------------------------------------------------------------------
# act targets (GitHub Actions local runner)
# ---------------------------------------------------------------------------

act-lint: ## Run lint job via act
	act -j lint

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
	act -j lint
	act -j typecheck
	act -j test-unit
	act -j test-build
	$(MAKE) test-db-down
	act -j test-integration
	$(MAKE) test-db-down
	act -j test-e2e
	$(MAKE) test-db-down
