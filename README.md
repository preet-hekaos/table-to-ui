# Table to UI

A metadata-first platform that turns tables into complete business apps. First industry pack: recruitment agencies.

Status: M0 (Foundation and thin slice) is in review. Requirements are indexed in [docs/prd](docs/prd), decisions in [docs/adr](docs/adr), benchmarks in [docs/benchmarks](docs/benchmarks).

## Run it locally (about 5 minutes)

Needs Docker, [uv](https://docs.astral.sh/uv/), Node 22 and pnpm 10.

```bash
docker compose up -d postgres mailpit          # dependencies
cd apps/api && uv sync
export DATABASE_URL=postgresql+asyncpg://app:app@localhost:5432/tableui \
       ANALYTICS_DATABASE_URL=postgresql+asyncpg://app:app@localhost:5432/tableui_analytics \
       ENVIRONMENT=local MAIL_BACKEND=log
uv run python -c "import asyncio,os; from tableui.platform.migrate import upgrade_control; asyncio.run(upgrade_control(os.environ['DATABASE_URL']))"
uv run uvicorn tableui.main:create_app --factory --port 8000
# second terminal
cd apps/web && pnpm install && pnpm dev        # http://localhost:5173
```

Create the first platform operator (password on stdin, prints the authenticator secret):
`printf '<password>\n' | uv run python -m tableui.ops.cli create-operator --email you@example.com --name You --non-interactive`

## Test

| What | Command |
|---|---|
| API lint, types, boundaries, tests, isolation | `make api-lint api-test` |
| Web lint, types, unit and accessibility tests | `cd apps/web && pnpm lint && pnpm typecheck && pnpm test` |
| End-to-end demo script (needs API and web running) | `cd apps/web && pnpm e2e` |
| CEL benchmark / load baseline | `uv run python scripts/bench_cel.py` / `scripts/load_baseline.py` in `apps/api` |

## Deploy

CI runs on every PR. The dev environment is defined in `infra/terraform/envs/dev` (AWS ap-south-1) and deployed from `main` through GitHub OIDC; applying it needs the owner's AWS account (see `infra/README.md`).
