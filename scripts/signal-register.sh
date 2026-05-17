#!/usr/bin/env bash
set -euo pipefail

# signal-register.sh — Register a phone number with Signal via signal-cli JSON-RPC daemon
#
# Usage: ./signal-register.sh +15551234567
#
# Environment:
#   SIGNAL_CLI_URL  — Base URL of signal-cli REST API (default: http://localhost:8080)
#
# This script handles:
#   1. Registration request (with captcha retry if challenged)
#   2. SMS verification code entry
#   3. Profile name setup
#   4. Summary output with env vars for agent configuration
#
# Fallback note: If register/verify are not available via JSON-RPC on your
# signal-cli version, you can use docker exec instead:
#   docker exec signal-cli signal-cli -u "$PHONE" register
#   docker exec signal-cli signal-cli -u "$PHONE" verify "$CODE"
# The JSON-RPC approach is preferred and implemented below.

SIGNAL_CLI_URL="${SIGNAL_CLI_URL:-http://localhost:8080}"
RPC_ENDPOINT="${SIGNAL_CLI_URL}/api/v1/rpc"
REQUEST_ID=1

# --- Helpers ---

usage() {
  echo "Usage: $0 <phone_number>"
  echo "  phone_number: E.164 format (e.g., +15551234567)"
  echo ""
  echo "Environment:"
  echo "  SIGNAL_CLI_URL  Base URL of signal-cli REST API (default: http://localhost:8080)"
  exit 1
}

# Send a JSON-RPC request and return the response
rpc_call() {
  local method="$1"
  local params="$2"
  local response

  response=$(curl -s -X POST "$RPC_ENDPOINT" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"$method\",\"params\":$params,\"id\":$REQUEST_ID}")
  REQUEST_ID=$((REQUEST_ID + 1))

  echo "$response"
}

# Check if response contains an error
has_error() {
  local response="$1"
  echo "$response" | grep -q '"error"'
}

# Check if response indicates captcha is required
needs_captcha() {
  local response="$1"
  echo "$response" | grep -qi "captcha\|challenge\|rate.limit"
}

# Extract error message from response
get_error_message() {
  local response="$1"
  # Try to extract the message field from the error object
  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if 'error' in data:
        err = data['error']
        if isinstance(err, dict):
            print(err.get('message', str(err)))
        else:
            print(str(err))
    else:
        print('')
except:
    print('unknown error')
" 2>/dev/null || echo "unknown error"
}

# --- Validation ---

if [[ $# -lt 1 ]]; then
  usage
fi

PHONE="$1"

# Validate E.164 format
if [[ ! "$PHONE" =~ ^\+[1-9][0-9]{6,14}$ ]]; then
  echo "Error: Phone number must be in E.164 format (e.g., +15551234567)"
  exit 1
fi

echo "=== Signal Registration ==="
echo "Phone:    $PHONE"
echo "Endpoint: $RPC_ENDPOINT"
echo ""

# --- Step 1: Registration ---

echo "[1/4] Requesting registration..."

REGISTER_PARAMS="{\"account\":\"$PHONE\"}"
RESPONSE=$(rpc_call "register" "$REGISTER_PARAMS")

echo "Response: $RESPONSE"
echo ""

# Check if captcha is required
if needs_captcha "$RESPONSE"; then
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  CAPTCHA REQUIRED                                          ║"
  echo "╠══════════════════════════════════════════════════════════════╣"
  echo "║  1. Open in your browser:                                  ║"
  echo "║     https://signalcaptchas.org/registration/generate.html  ║"
  echo "║                                                            ║"
  echo "║  2. Solve the captcha                                      ║"
  echo "║                                                            ║"
  echo "║  3. Copy the signalcaptcha://... token from the page       ║"
  echo "║                                                            ║"
  echo "║  4. Paste it below                                         ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  read -rp "Paste captcha token: " CAPTCHA_TOKEN

  # Strip the signalcaptcha:// prefix if present
  CAPTCHA_TOKEN="${CAPTCHA_TOKEN#signalcaptcha://}"

  if [[ -z "$CAPTCHA_TOKEN" ]]; then
    echo "Error: No captcha token provided."
    exit 1
  fi

  echo ""
  echo "[1/4] Retrying registration with captcha..."

  REGISTER_PARAMS="{\"account\":\"$PHONE\",\"captcha\":\"$CAPTCHA_TOKEN\"}"
  RESPONSE=$(rpc_call "register" "$REGISTER_PARAMS")

  echo "Response: $RESPONSE"
  echo ""

  if has_error "$RESPONSE" && ! needs_captcha "$RESPONSE"; then
    ERROR_MSG=$(get_error_message "$RESPONSE")
    echo "Error: Registration failed after captcha: $ERROR_MSG"
    exit 1
  fi
elif has_error "$RESPONSE"; then
  ERROR_MSG=$(get_error_message "$RESPONSE")
  echo "Error: Registration failed: $ERROR_MSG"
  exit 1
fi

echo "Registration request sent. Waiting for SMS verification code..."
echo ""

# --- Step 2: Verification ---

echo "[2/4] Enter verification code"
echo "  Check your SMS Pool dashboard for the 6-digit code."
echo ""
read -rp "Verification code (6 digits): " VERIFY_CODE

# Strip any spaces or dashes the user might have added
VERIFY_CODE="${VERIFY_CODE//[- ]/}"

if [[ ! "$VERIFY_CODE" =~ ^[0-9]{6}$ ]]; then
  echo "Error: Verification code must be exactly 6 digits."
  exit 1
fi

echo ""
echo "[3/4] Verifying code..."

VERIFY_PARAMS="{\"account\":\"$PHONE\",\"verificationCode\":\"$VERIFY_CODE\"}"
RESPONSE=$(rpc_call "verify" "$VERIFY_PARAMS")

echo "Response: $RESPONSE"
echo ""

if has_error "$RESPONSE"; then
  ERROR_MSG=$(get_error_message "$RESPONSE")
  echo "Error: Verification failed: $ERROR_MSG"
  exit 1
fi

echo "Verification successful!"
echo ""

# --- Step 3: Set Display Name ---

echo "[4/4] Set display name for this Signal account"
read -rp "Display name (e.g., 'Hermes Agent'): " DISPLAY_NAME

if [[ -n "$DISPLAY_NAME" ]]; then
  PROFILE_PARAMS="{\"account\":\"$PHONE\",\"name\":\"$DISPLAY_NAME\"}"
  RESPONSE=$(rpc_call "updateProfile" "$PROFILE_PARAMS")

  if has_error "$RESPONSE"; then
    echo "Warning: Could not set display name (non-fatal): $(get_error_message "$RESPONSE")"
  else
    echo "Display name set to: $DISPLAY_NAME"
  fi
else
  echo "Skipping display name."
fi

echo ""

# --- Summary ---

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  REGISTRATION COMPLETE                                     ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Add these to your agent's .env file:                      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  SIGNAL_PHONE=$PHONE"
echo "  SIGNAL_CLI_URL=$SIGNAL_CLI_URL"
if [[ -n "${DISPLAY_NAME:-}" ]]; then
  echo "  SIGNAL_DISPLAY_NAME=$DISPLAY_NAME"
fi
echo ""
echo "Done. This number is now registered and ready to send/receive."
