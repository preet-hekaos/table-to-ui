FROM python:3.13-slim AS base
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/api/src ./src
COPY packs /packs
RUN uv sync --frozen --no-dev
ENV PACK_DIR=/packs/recruitment PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "tableui.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
