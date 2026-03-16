#!/usr/bin/env bash
set -euo pipefail

# Dockerized quality gates runner for environments without local Node/npm.
# - Uses node:22 container
# - Mounts repo at /workspace
# - Reads .env if present, and overrides DATABASE_URL to host.docker.internal:5433
# - Runs: npm ci, prisma generate, lint, typecheck, tests, build

REPO_ROOT="$(cd "$(dirname "$0")"/.. && pwd)"
cd "$REPO_ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not installed. Install Docker Desktop and retry." >&2
  exit 1
fi

# Compose DB tip (optional):
echo "Tip: ensure Postgres is running: 'docker compose up -d db' (port 5433)" >&2

# Compute DATABASE_URL for container access to host DB.
# Prefer env if already set; otherwise default to host.docker.internal which works on macOS/Windows.
DEFAULT_DB_URL="postgresql://postgres:postgres@host.docker.internal:5433/allvision?schema=public"
DB_URL="${DATABASE_URL:-$DEFAULT_DB_URL}"

# Load env-file args if .env exists
ENV_ARGS=()
if [[ -f .env ]]; then
  ENV_ARGS+=(--env-file .env)
fi

echo "Running gates inside node:22 container..." >&2
echo "DATABASE_URL=${DB_URL}" >&2

exec docker run --rm -t \
  -v "$REPO_ROOT":/workspace \
  -w /workspace \
  "${ENV_ARGS[@]}" \
  -e DATABASE_URL="$DB_URL" \
  node:22-bullseye bash -lc '
    set -euo pipefail
    npm ci
    npm run prisma:generate
    npm run prisma:migrate:deploy
    npm run lint
    npm run typecheck
    npm run test
    npm run build
  '
