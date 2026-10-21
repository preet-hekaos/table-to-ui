# Table to UI

A metadata-first platform that turns tables into complete business apps. First industry pack: recruitment agencies.

Status: M0 is merged; M1 (Data and screens) and M2 (Recruiting workflow) are merged; M2.5 (Relationship builder) is merged; M3 (Insights) is merged; M4 (Automation, notifications and guided start) is in review. Requirements are indexed in [docs/prd](docs/prd), decisions in [docs/adr](docs/adr), benchmarks in [docs/benchmarks](docs/benchmarks).

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

On Windows set the variables one per line instead (they last for that window only).
PowerShell (`set` does not work there):
```powershell
$env:DATABASE_URL="postgresql+asyncpg://app:app@localhost:5432/tableui"
$env:ANALYTICS_DATABASE_URL="postgresql+asyncpg://app:app@localhost:5432/tableui_analytics"
$env:ENVIRONMENT="local"; $env:MAIL_BACKEND="log"
```
Command Prompt (`cmd`):
```bat
set DATABASE_URL=postgresql+asyncpg://app:app@localhost:5432/tableui
set ANALYTICS_DATABASE_URL=postgresql+asyncpg://app:app@localhost:5432/tableui_analytics
set ENVIRONMENT=local
set MAIL_BACKEND=log
```

Uploads are stored under `apps/api/var/files`. To scan them with ClamAV instead of the built-in EICAR signature check, run `docker compose --profile scan up -d clamav` and set `CLAMD_HOST=localhost`. CVs are read by the built-in parser; set `CV_PARSER=rchilli` and `RCHILLI_API_KEY` to use RChilli.

Create the first platform operator (password on stdin, prints the authenticator secret):
`printf '<password>\n' | uv run python -m tableui.ops.cli create-operator --email you@example.com --name You --non-interactive`

## Test

| What | Command |
|---|---|
| API lint, types, boundaries, tests, isolation | `make api-lint api-test` |
| Web lint, types, unit and accessibility tests | `cd apps/web && pnpm lint && pnpm typecheck && pnpm test` |
| End-to-end demo script (needs API and web running) | `cd apps/web && pnpm e2e` |
| CEL benchmark / load baseline | `uv run python scripts/bench_cel.py` / `scripts/load_baseline.py` in `apps/api` |
| M1 gates on 50,000 candidates (needs the API running) | `uv run python scripts/bench_m1.py` in `apps/api` |
| M2 gates: board, stage moves, duplicates, merge (needs the API running) | `uv run python scripts/bench_m2.py` in `apps/api` |
| M2.5 gate: Relationships list (needs the API running) | `uv run python scripts/bench_m25.py` in `apps/api` |
| M3 gate: Insights dashboard (needs the API and `ANALYTICS_DATABASE_URL`) | `uv run python scripts/bench_m3.py` in `apps/api` |
| M4 gates: hourly date check and save overhead (needs the API and `DATABASE_URL`) | `uv run python scripts/bench_m4.py` in `apps/api` |
| CV parser accuracy on the synthetic corpus | `uv run python -m tools.parser_accuracy` in `apps/api` |

## Deploy

CI runs on every PR. The dev environment is defined in `infra/terraform/envs/dev` (AWS ap-south-1) and deployed from `main` through GitHub OIDC; applying it needs the owner's AWS account (see `infra/README.md`).
