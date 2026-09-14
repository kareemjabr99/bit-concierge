#!/usr/bin/env bash
# Verifies the repository the way CI sees it: from a clean clone, with none of
# the state a developer machine accumulates.
#
# Two Phase 0 bugs were invisible locally and caught only by the documented
# path — a Postgres volume mount that only mattered with a fresh volume, and a
# lockfile that only failed policy without a cached verdict. Both were "state on
# my machine that is not in the repo". This script removes that class of gap
# rather than the two instances of it. Run it at every gate.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/bitc-verify-clean.XXXXXX")"
PORT="${VERIFY_CLEAN_PORT:-55433}"
CONTAINER="bitc-pg-verify-clean"

cleanup() {
  docker rm -f -v "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "→ clean clone into $WORK"
git clone --quiet "$ROOT" "$WORK/repo"
cd "$WORK/repo"

# Docker Desktop keeps its socket under the real HOME (~/.docker/run/) and the
# CLI finds it through the user's context. Resolve the endpoint before HOME
# changes, or the CLI falls back to /var/run/docker.sock and finds nothing.
if [ -z "${DOCKER_HOST:-}" ]; then
  DOCKER_HOST="$(docker context inspect --format '{{(index .Endpoints "docker").Host}}' 2>/dev/null || true)"
  [ -n "$DOCKER_HOST" ] && export DOCKER_HOST
fi

echo "→ fresh HOME: fresh pnpm store, fresh verification cache, no cached verdicts"
# pnpm caches "this lockfile passed policy" under ~/Library/Caches (macOS) or
# ~/.cache (Linux) and reuses it on every install. No install flag bypasses
# it; a fresh HOME does. corepack re-downloads pnpm into it, which is the point.
export HOME="$WORK/home"
mkdir -p "$HOME"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
pnpm install --frozen-lockfile

echo "→ release-age margin on pinned dependencies"
node "$ROOT/scripts/release-age.mjs"

echo "→ fresh Postgres on port $PORT (throwaway volume)"
docker rm -f -v "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bitconcierge \
  -p "$PORT:5432" pgvector/pgvector:pg18 >/dev/null
for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U postgres -d bitconcierge >/dev/null 2>&1 && break
  sleep 1
done

export DATABASE_URL_MIGRATOR="postgres://postgres:postgres@localhost:$PORT/bitconcierge"
export DATABASE_URL="postgres://bitc_app_local:localdev@localhost:$PORT/bitconcierge"
# The suite owns its own database and reads only these.
export TEST_DATABASE_URL_MIGRATOR="postgres://postgres:postgres@localhost:$PORT/bitconcierge_test"
export TEST_DATABASE_URL="postgres://bitc_app_local:localdev@localhost:$PORT/bitconcierge_test"

echo "→ the README sequence"
pnpm db:migrate
docker exec -i "$CONTAINER" psql -U postgres -d bitconcierge -q -v ON_ERROR_STOP=1 \
  < packages/db/scripts/bootstrap-local.sql
pnpm verify

echo "✓ clean verification passed"

# The other half of the parity problem, and the one that stayed invisible for
# three days: a clean local run says nothing about whether the pipeline is
# green. Reported here because this is the command someone actually runs before
# a gate. Non-fatal — a red pipeline is the gate's decision to make, not this
# script's — but it is no longer silent.
echo
bash "$ROOT/scripts/gate-check.sh" --report
