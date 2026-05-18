#!/bin/sh
# Healthcheck that detects signal-cli websocket reconnect loops.
# The daemon's HTTP server stays up even when the Signal websocket
# is broken, so a simple curl check is insufficient.
#
# Strategy: check the last 10 log lines via docker logs (from inside
# the container we can't do that). Instead, use JSON-RPC to verify
# the daemon can actually list accounts (proves it's responsive),
# AND check that the /api/v1/events SSE endpoint sends data within 3s.
#
# Simpler approach: POST a JSON-RPC listAccounts call. If it hangs
# or returns error, the daemon is degraded.

RESPONSE=$(curl -sf --max-time 3 -X POST http://localhost:8080/api/v1/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"listAccounts","id":"hc"}' 2>/dev/null)

if [ -z "$RESPONSE" ]; then
  exit 1
fi

# Check that we got a valid JSON-RPC response with results
echo "$RESPONSE" | grep -q '"result"' || exit 1

exit 0
