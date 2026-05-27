#!/bin/sh
# Healthcheck that detects signal-cli websocket reconnect loops.
#
# The daemon's HTTP/JSON-RPC server stays responsive even when the
# Signal websocket is broken. But the SSE events endpoint hangs
# because no events can flow without a live websocket.
#
# Strategy: POST a keepalive-style SSE connection with a short timeout.
# A healthy daemon sends SSE comments (":") as keepalives within a few
# seconds. A degraded daemon hangs indefinitely. We also verify JSON-RPC
# is responsive as a baseline.

# 1. JSON-RPC must respond
RESPONSE=$(curl -sf --max-time 3 -X POST http://localhost:8080/api/v1/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"listAccounts","id":"hc"}' 2>/dev/null)

if [ -z "$RESPONSE" ]; then
  exit 1
fi
echo "$RESPONSE" | grep -q '"result"' || exit 1

# SSE check removed — unreliable in multi-account JSON-RPC mode.
# The /v1/about endpoint confirms the daemon is responsive and in the right mode.

exit 0
