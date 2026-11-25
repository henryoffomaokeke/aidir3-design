#!/usr/bin/env bash
# Run the Go backend inside WSL.
#
# On the owner's Windows PC, Application Control blocks the Go toolchain
# (asm.exe), so `npm run dev:backend` cannot compile natively. Postgres also
# runs in the same WSL distro, so the backend reaches it on 127.0.0.1 and
# Windows reaches the backend on localhost:<port> through WSL's port forwarding.
#
#   wsl -d Ubuntu -u root -- bash ".../scripts/aidir3/run-backend-wsl.sh" [mode] [extra-env-file]
#
# Modes:
#   (none)  API only, for use with `next dev` on another port.
#   serve   The whole app on one port, the way it runs in production: the Go
#           server also serves the exported frontend (frontend/out, made by
#           `npm run build:dist -w frontend`). Open http://localhost:<port>.
#
# extra-env-file (optional, a path as WSL sees it): KEY=VALUE lines loaded
# after the root .env, overriding it. Used to run a second instance with other
# settings, e.g. PORT=8006 plus the single sign-on variables.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Load an env file without `source`: values may hold characters the shell
# would expand, and the file may have Windows line endings.
load_env() {
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in '' | \#*) continue ;; esac
    key="${line%%=*}"
    val="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [[ "$val" =~ ^\"(.*)\"$ ]]; then
      val="${BASH_REMATCH[1]}"
    elif [[ "$val" =~ ^\'(.*)\'$ ]]; then
      val="${BASH_REMATCH[1]}"
    fi
    export "$key=$val"
  done < "$1"
}

load_env "$ROOT/.env"
if [ -n "${2:-}" ]; then
  [ -f "$2" ] || { echo "extra env file not found: $2" >&2; exit 1; }
  load_env "$2"
fi

export PORT="${PORT:-8005}"
export GOFLAGS="-buildvcs=false"
export GOCACHE="${GOCACHE:-$HOME/.cache/aidir3-design-go}"
# One binary per port, so rebuilding for a second instance never overwrites
# the executable of one that is running.
BIN="$HOME/aidir3-design-api-$PORT"

cd "$ROOT/backend"
go build -o "$BIN" ./cmd/api

case "${1:-}" in
  serve)
    [ -f "$ROOT/frontend/out/index.html" ] || { echo "frontend/out is missing: run 'npm run build:dist -w frontend' first" >&2; exit 1; }
    export PUBLIC_DIR="$ROOT/frontend/out"
    export FRONTEND_URL="http://localhost:$PORT"
    export APP_URL="http://localhost:$PORT"
    ;;
  *)
    export PUBLIC_DIR=
    ;;
esac
exec "$BIN"
