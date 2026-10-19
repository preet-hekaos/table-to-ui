.PHONY: up down api-test api-lint web-install web-test check
up:           ## Start dependencies and the app
	docker compose --profile app up -d --build --wait
down:
	docker compose --profile app down
api-lint:
	cd apps/api && uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run lint-imports
api-test:
	cd apps/api && uv run pytest
web-install:
	cd apps/web && pnpm install
web-test:
	cd apps/web && pnpm test
check: api-lint api-test
