.PHONY: help version-set version-sync version-check test-db-up test-db-down lint typecheck test-unit test-integration test-e2e test-performance build \
	act-lint act-typecheck act-test-unit act-test-integration act-test-e2e act-test-performance act-build act-all

RUNNER := node scripts/run-isolated-test.mjs
PERF_OUTPUT ?= performance-results/head.json
PERF_COMMIT ?= local
VERSION ?=

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Version targets
# ---------------------------------------------------------------------------

version-set: ## Set root and workspace package versions (VERSION=x.y.z)
	@test -n "$(VERSION)" || (echo "VERSION is required" >&2; exit 1)
	./scripts/set-version.sh "$(VERSION)"

version-sync: ## Sync workspace package versions from root package.json
	./scripts/sync-versions.sh

version-check: ## Check workspace package versions are synchronized
	./scripts/check-versions.sh $(VERSION)

# ---------------------------------------------------------------------------
# Local test targets
# ---------------------------------------------------------------------------

test-db-up: ## Start test DB for a fixed slot (requires SUI_TEST_SLOT)
	node scripts/test-isolation/docker-db.mjs up

test-db-down: ## Stop test DB for a fixed slot (requires SUI_TEST_SLOT)
	node scripts/test-isolation/docker-db.mjs down

lint: ## Run lint
	pnpm lint

typecheck: ## Run typecheck
	pnpm --filter @sui/db db:generate
	pnpm typecheck

test-unit: ## Run unit tests
	pnpm test
	node --test scripts/test-isolation/resources.test.mjs scripts/test-isolation/runner.test.mjs

test-integration: ## Run integration tests in an isolated test slot
	$(RUNNER) integration

test-e2e: ## Run E2E tests in an isolated test slot
	$(RUNNER) e2e

test-performance: ## Run performance benchmarks in an isolated test slot
	PERF_OUTPUT=$(PERF_OUTPUT) PERF_COMMIT=$(PERF_COMMIT) $(RUNNER) performance

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

act-test-integration: ## Run test-integration job via act (stops local DB first)
	$(MAKE) test-db-down SUI_TEST_SLOT=0
	act -j test-integration

act-test-e2e: ## Run test-e2e job via act (stops local DB first)
	$(MAKE) test-db-down SUI_TEST_SLOT=0
	act -j test-e2e

act-test-performance: ## Run performance job via act (stops local DB first)
	$(MAKE) test-db-down SUI_TEST_SLOT=0
	act -j performance

act-build: ## Run build job via act
	act -j test-build

act-all: ## Run all act jobs sequentially (stops local DB first)
	$(MAKE) test-db-down SUI_TEST_SLOT=0
	act -j lint
	act -j typecheck
	act -j test-unit
	act -j test-build
	$(MAKE) test-db-down SUI_TEST_SLOT=0
	act -j test-integration
	$(MAKE) test-db-down SUI_TEST_SLOT=0
	act -j test-e2e
	$(MAKE) test-db-down SUI_TEST_SLOT=0
