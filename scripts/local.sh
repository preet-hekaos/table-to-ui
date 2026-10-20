#!/usr/bin/env bash
# One-command local run. Needs: Docker, uv, Node 22, pnpm.
#   scripts/local.sh up      start Postgres + Mailpit, migrate, start the API and the web app
#   scripts/local.sh ops     create a platform operator (asks for an email and password)
#   scripts/local.sh down    stop everything
set -euo pipefail
cd "$(dirname "$0")/.."
RUN=.local; mkdir -p "$RUN"
export DATABASE_URL=${DATABASE_URL:-postgresql+asyncpg://app:app@localhost:5432/tableui}
export ANALYTICS_DATABASE_URL=${ANALYTICS_DATABASE_URL:-postgresql+asyncpg://app:app@localhost:5432/tableui_analytics}
export ENVIRONMENT=local PACK_DIR="$PWD/packs/recruitment"
export MAIL_BACKEND=${MAIL_BACKEND:-smtp} SMTP_HOST=localhost SMTP_PORT=1025

case "${1:-up}" in
  up)
    docker compose up -d --wait postgres mailpit
    docker compose exec -T postgres psql -U app -d postgres -tc "select 1 from pg_database where datname='tableui_analytics'" | grep -q 1 \
      || docker compose exec -T postgres psql -U app -d postgres -c "create database tableui_analytics"
    (cd apps/api && uv sync -q && uv run python -c "import asyncio,os; from tableui.platform.migrate import upgrade_control; asyncio.run(upgrade_control(os.environ['DATABASE_URL']))")
    (cd apps/api && nohup uv run uvicorn tableui.main:create_app --factory --host 127.0.0.1 --port 8000 > "../../$RUN/api.log" 2>&1 & echo $! > "../../$RUN/api.pid")
    (cd apps/web && pnpm install --silent && API_URL=http://127.0.0.1:8000 nohup pnpm exec vite --host 127.0.0.1 --port 5173 > "../../$RUN/web.log" 2>&1 & echo $! > "../../$RUN/web.pid")
    for _ in $(seq 60); do curl -sf localhost:8000/healthz >/dev/null && curl -sf 127.0.0.1:5173 >/dev/null && break; sleep 1; done
    echo; echo "App:      http://127.0.0.1:5173   (sign up as a new agency)"
    echo "Emails:   http://localhost:8025        (invitations land here)"
    echo "Platform operator console: http://127.0.0.1:5173/ops/sign-in  (run: scripts/local.sh ops)"
    echo "Logs:     $RUN/api.log  $RUN/web.log" ;;
  ops)
    read -rp "Operator email: " E; read -rsp "Password (12+ chars): " P; echo
    (cd apps/api && printf '%s\n' "$P" | uv run python -m tableui.ops.cli create-operator --email "$E" --name "Operator" --non-interactive) ;;
  down)
    for f in api web; do [ -f "$RUN/$f.pid" ] && kill "$(cat "$RUN/$f.pid")" 2>/dev/null || true; done
    pkill -f "vite --host 127.0.0.1" 2>/dev/null || true
    docker compose stop postgres mailpit ;;
  *) echo "usage: $0 up|ops|down"; exit 1 ;;
esac
