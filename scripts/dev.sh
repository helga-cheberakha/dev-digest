#!/usr/bin/env bash
#
# DevDigest local bootstrap — bring the whole stack up from zero.
#
#   ./scripts/dev.sh              # full: docker → migrate → seed → server + client
#   ./scripts/dev.sh --no-seed    # skip the demo seed
#   ./scripts/dev.sh --no-client  # run only Postgres + API (no Next.js)
#   ./scripts/dev.sh --db-only    # just Postgres + migrate + seed, then exit
#
# Idempotent: re-running installs only what's missing, migrations and seed
# both upsert. Ctrl-C stops the dev servers and leaves Postgres running.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONTAINER="devdigest-postgres"
RUN_SEED=1
RUN_CLIENT=1
DB_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --no-seed)   RUN_SEED=0 ;;
    --no-client) RUN_CLIENT=0 ;;
    --db-only)   DB_ONLY=1 ;;
    -h|--help)   sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

# --- prerequisites -----------------------------------------------------------
command -v docker >/dev/null || { echo "docker not found"; exit 1; }
command -v pnpm   >/dev/null || { echo "pnpm not found (npm i -g pnpm)"; exit 1; }

# --- env files ---------------------------------------------------------------
for dir in server client; do
  if [ ! -f "$dir/.env" ] && [ -f "$dir/.env.example" ]; then
    cp "$dir/.env.example" "$dir/.env"
    warn "created $dir/.env from .env.example — add your API keys (OPENAI/ANTHROPIC/GITHUB_TOKEN) in server/.env"
  fi
done

# --- Postgres ----------------------------------------------------------------
# The container name is fixed (container_name: devdigest-postgres), so if one is
# already running (possibly under another compose project) we reuse it instead
# of failing on a name conflict. If it exists but is stopped, start it; else
# create it via compose.
state="$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "missing")"
case "$state" in
  running) log "Postgres container already running — reusing it" ;;
  exited|created) log "starting existing Postgres container"; docker start "$CONTAINER" >/dev/null ;;
  *)       log "starting Postgres (docker compose up -d)"; docker compose up -d ;;
esac

log "waiting for Postgres to be healthy"
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "starting")"
  [ "$status" = "healthy" ] && break
  sleep 1
done
[ "${status:-}" = "healthy" ] || { echo "Postgres did not become healthy in time"; exit 1; }
log "Postgres healthy"

# --- install deps (only if missing) ------------------------------------------
install_if_needed() {
  if [ ! -d "$1/node_modules" ]; then
    log "installing deps in $1"
    (cd "$1" && pnpm install)
  fi
}
install_if_needed server
install_if_needed reviewer-core
[ "$DB_ONLY" -eq 0 ] && [ "$RUN_CLIENT" -eq 1 ] && install_if_needed client

# --- migrate + seed ----------------------------------------------------------
log "applying migrations"
(cd server && pnpm db:migrate)

if [ "$RUN_SEED" -eq 1 ]; then
  log "seeding demo data"
  (cd server && pnpm db:seed)
fi

if [ "$DB_ONLY" -eq 1 ]; then
  log "DB ready. Postgres is running; server/client not started (--db-only)."
  exit 0
fi

# --- dev servers -------------------------------------------------------------
# `tsx watch` / `next dev` spawn the real listener as a GRANDCHILD of the
# `pnpm dev` wrapper, so a plain `kill $PID` leaves it orphaned and still
# holding the port — the next run's kill_port then can't find it under the
# wrapper's PID, and the API silently fails to bind. Walk the tree leaves-first
# instead (mirrors scripts/e2e.sh's kill_tree).
kill_tree() {
  local pid="$1" kid
  [ -n "$pid" ] || return 0
  for kid in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$kid"; done
  kill "$pid" 2>/dev/null || true
}

# Free any port held by a stale previous session (tsx/next that survived Ctrl-C).
kill_port() {
  local port="$1" pids pid
  pids="$(lsof -ti :"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    warn "port $port in use (PID $pids) — stopping stale process"
    for pid in $pids; do kill_tree "$pid"; done
    sleep 1
  fi
}

SERVER_PID=""
cleanup() {
  log "shutting down dev servers (Postgres stays up; stop it with: docker compose down)"
  [ -n "$SERVER_PID" ] && kill_tree "$SERVER_PID"
}
trap cleanup EXIT INT TERM

# API_PORT comes from server/.env (defaults to 3001 via .env.example, but a
# dev machine may have it repointed — e.g. to 3101 to match scripts/e2e.sh).
# Hardcoding 3001 here would kill_port the wrong port and never clear a stale
# listener on the real one.
API_PORT="$(grep -m1 '^API_PORT=' server/.env 2>/dev/null | cut -d= -f2)"
API_PORT="${API_PORT:-3001}"

log "starting API on :$API_PORT (server)"
kill_port "$API_PORT"
(cd server && pnpm dev) &
SERVER_PID=$!

if [ "$RUN_CLIENT" -eq 1 ]; then
  # client's dev script hardcodes `next dev -p 3000` — WEB_PORT in client/.env
  # is not read by it, so 3000 is the real port regardless of that setting.
  kill_port 3000
  log "starting web on :3000 (client) — Ctrl-C to stop both"
  (cd client && pnpm dev)
else
  log "API running (PID $SERVER_PID) — Ctrl-C to stop"
  wait "$SERVER_PID"
fi
