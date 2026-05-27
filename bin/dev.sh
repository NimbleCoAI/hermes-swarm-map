#!/bin/bash
# Smart dev server launcher for Hermes Swarm Map
# - Finds a free port (default 3000, auto-increments)
# - Kills zombie Swarm Map processes on that port (but not unrelated ones)
# - Starts Next.js dev server

set -euo pipefail

# Ensure Docker and node are in PATH
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

PROJECT_NAME="hermes-swarm-map"
DEFAULT_PORT="${PORT:-3000}"
MAX_PORT=$((DEFAULT_PORT + 10))

# In production, pin to the configured port — don't auto-increment.
# Production convention is PORT=3002 (set in .env or environment).
if [ "${NODE_ENV:-}" = "production" ]; then
  if lsof -ti :"$DEFAULT_PORT" >/dev/null 2>&1; then
    echo "ERROR: Port $DEFAULT_PORT is occupied and NODE_ENV=production — refusing to auto-increment." >&2
    echo "Kill the process on port $DEFAULT_PORT or choose a different port." >&2
    exit 1
  fi
  echo "Starting Swarm Map (production) on http://localhost:$DEFAULT_PORT"
  exec npx next start --port "$DEFAULT_PORT" --hostname 0.0.0.0
fi

# Kill only our own zombie processes on a port
kill_own_zombies() {
  local port=$1
  local pids
  pids=$(lsof -ti :"$port" 2>/dev/null || true)

  for pid in $pids; do
    # Check if this is our process (next-server or node running from this dir)
    local cmd
    cmd=$(ps -p "$pid" -o command= 2>/dev/null || true)

    if echo "$cmd" | grep -qE "(next|node).*${PROJECT_NAME}" 2>/dev/null; then
      echo "Killing zombie Swarm Map process on port $port (PID $pid)"
      kill "$pid" 2>/dev/null || true
      sleep 0.5
      # Force kill if still alive
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

# Find a free port, killing our zombies first
find_port() {
  local port=$DEFAULT_PORT

  while [ "$port" -le "$MAX_PORT" ]; do
    # Try to kill our own zombies on this port
    kill_own_zombies "$port"

    # Check if port is now free
    if ! lsof -ti :"$port" >/dev/null 2>&1; then
      echo "$port"
      return 0
    fi

    # Port occupied by something else — skip it
    local occupant
    occupant=$(lsof -i :"$port" -P 2>/dev/null | tail -1 | awk '{print $1}')
    echo "Port $port in use by $occupant — trying next" >&2
    port=$((port + 1))
  done

  echo "No free port found in range $DEFAULT_PORT-$MAX_PORT" >&2
  return 1
}

PORT=$(find_port)
echo "Starting Swarm Map on http://localhost:$PORT"
exec npx next dev --port "$PORT"
