# Signal Registration Lock — Design Spec

**Date**: 2026-06-02
**Author**: Juniper + Claude
**Project**: hermes-swarm-map
**Status**: Draft

---

## Problem

HSM's Signal agents are registered with SMSPool one-time numbers. These numbers are recycled by SMSPool and reassigned to other buyers. Anyone who receives the same number can re-register it on Signal, hijacking the bot's identity, group memberships, and access to PII (especially high-risk on agents like `personal`).

## Solution

Enable Signal's Registration Lock on all registered accounts. Registration Lock requires both an SMS verification code AND a PIN to re-register a number. Without the PIN, the attacker sees "Account locked" and the account is protected for 7 days.

HSM manages the full PIN lifecycle: generation, storage, application via signal-cli JSON-RPC, health monitoring, and recovery.

## Approach

HSM-native (Approach A from brainstorming). PIN lifecycle lives entirely in HSM. No Hermes agent changes. signal-cli daemon keepalives maintain the lock automatically as long as the container runs (already ensured by autoheal).

---

## 1. PIN Storage

PINs stored in the existing HSM encrypted key store (`~/.hermes-swarm-map/keys.json`).

**Provider type**: `signal-pin`

**Key record**:
```typescript
{
  id: "k_<sha1-fingerprint>",
  provider: "signal-pin",
  name: "Signal PIN (+15551234567)",
  maskedValue: "12••••56",        // first2 + masked + last2
  encryptedValue: "<aes-256>",    // encrypted full PIN
  assignedTo: ["h_personal"],     // harness owning this number
  health: "good" | "expired",
  manuallyAdded: false
}
```

No new storage infrastructure. Reuses existing encryption service, fingerprinting, and harness association.

## 2. PIN Generation

**Default**: Cryptographically random 8-digit numeric PIN via `crypto.randomInt(10000000, 100000000)`. Not LLM-generated.

**Custom override**: User can type a custom PIN in the setup dialog. Minimum 4 digits (Signal's minimum). No maximum enforced beyond Signal's own limits.

**UI default**: Auto-generate button pre-fills a random PIN. User can clear and type their own. Field is visible so user can copy it before proceeding.

## 3. Registration Flow Changes

### Modified verify step (`app/api/surfaces/signal/verify/route.ts`)

After existing verification succeeds (SMS code accepted, daemon restarted, account appears in `listAccounts`):

1. **Receive PIN** from request body (`pin` field — either user-provided or frontend-generated)
2. **Call `setPin`** via JSON-RPC to signal-cli daemon:
   ```json
   {"jsonrpc":"2.0","method":"setPin","params":{"registrationLockPin":"<PIN>"},"id":1}
   ```
3. **Store PIN** in key store as `signal-pin` provider key, assigned to the target harness
4. **Return** `{ success: true, pinSet: true }` (or `pinSet: false` if setPin call failed — non-fatal, surface warning)

### Modified setup dialog (`components/surfaces/signal-setup-dialog.tsx`)

In the verification step (where user enters 6-digit SMS code + display name):

- New field: **"Registration Lock PIN"**
  - Pre-filled with a random 8-digit PIN (generated client-side via `crypto.getRandomValues`)
  - Editable — user can replace with custom PIN
  - "Regenerate" button to get a new random one
  - Info text: "This PIN prevents anyone from re-registering your number. Store a backup — losing this PIN and your HSM data means losing access to this Signal account."
- PIN sent to verify endpoint in request body

### Existing number flow

When connecting an already-registered number (skipping registration/verification):

- Show the PIN field with the same UX
- Call a new `POST /api/surfaces/signal/pin` endpoint to set PIN on the existing account
- Store in key store

## 4. New API Endpoints

### `POST /api/surfaces/signal/pin`

Set or update PIN on a single account.

**Request**:
```json
{
  "phone": "+15551234567",
  "pin": "12345678",
  "harnessId": "h_personal"
}
```

**Flow**:
1. Validate phone is in `listAccounts`
2. Call `setPin` via JSON-RPC: `{"method":"setPin","params":{"registrationLockPin":"12345678"}}`
3. Upsert `signal-pin` key in store (update if exists for this phone, create if not)
4. Return `{ success: true }`

### `DELETE /api/surfaces/signal/pin`

Remove PIN / disable registration lock.

**Request**:
```json
{
  "phone": "+15551234567"
}
```

**Flow**:
1. Call `removePin` via JSON-RPC
2. Remove `signal-pin` key from store
3. Return `{ success: true }`

**UI**: Requires confirmation dialog — "Removing registration lock means anyone with an SMS code for this number can hijack this account."

### `POST /api/surfaces/signal/pin/bulk-set`

Set PINs on all registered accounts that don't have one.

**Request**: `{}` (no body needed)

**Flow**:
1. Call `listAccounts` to get all registered numbers
2. For each account:
   - Check if a `signal-pin` key exists in the store for this phone
   - If not: generate random 8-digit PIN, call `setPin`, store in key store
   - If yes: skip (already locked)
3. Return summary:
   ```json
   {
     "locked": ["+15551234567", "+15559876543"],
     "alreadyLocked": ["+15550001111"],
     "failed": []
   }
   ```

### `GET /api/surfaces/signal/pin?phone=<phone>`

Retrieve (decrypt) PIN for display. Phone passed as query param (URL-encoded, e.g. `%2B15551234567`).

**Response**:
```json
{
  "phone": "+15551234567",
  "pin": "12345678",
  "health": "good"
}
```

Used by click-to-reveal UI. Decrypts from key store on demand.

## 5. Expiry Detection

### How it works

signal-cli daemon sends keepalive messages to Signal servers automatically while running. This refreshes the 7-day registration lock timer. If the daemon is down for 7+ consecutive days, the lock expires silently.

### Detection mechanism

Extend the existing signal health check (`GET /api/surfaces/signal`):

1. Call `listAccounts` via JSON-RPC
2. Cross-reference against all harnesses that have `SIGNAL_ACCOUNT` set in their `.env`
3. For each harness account NOT in the `listAccounts` response:
   - Account was re-registered by someone else (lock expired or was never set)
   - Update the associated `signal-pin` key health to `"expired"`
4. Return extended health response:
   ```json
   {
     "healthy": true,
     "accounts": ["+15551234567"],
     "missing": ["+15559876543"],
     "pinStatus": {
       "+15551234567": "locked",
       "+15559876543": "expired"
     }
   }
   ```

### Where it surfaces

- **Harness card**: Warning badge if Signal account missing or PIN expired
- **Signal surface status**: Red "Registration Lost" instead of green "Connected"
- **Settings page**: Alert banner if any accounts are unprotected

## 6. PIN Management UI

On harness detail page, in the Surfaces section where Signal connection is shown:

### PIN status indicator

- **Locked** (green badge) — PIN set, account present in `listAccounts`
- **Not set** (yellow badge) — No `signal-pin` key exists for this account
- **Expired** (red badge) — Account missing from `listAccounts`

### Actions

- **Reveal PIN**: Click-to-reveal button, calls `GET /api/surfaces/signal/pin/:phone`, shows PIN in monospace with copy button. Auto-hides after 30 seconds.
- **Change PIN**: Opens inline form — same auto-generate + custom input as setup dialog. Calls `POST /api/surfaces/signal/pin`.
- **Remove PIN**: Confirmation dialog, then `DELETE /api/surfaces/signal/pin`. Shows security warning.
- **Set PIN** (when not set): Same as Change PIN flow.

### Bulk action

On the global Settings page, a "Signal Security" section:

- Shows count of locked/unlocked/expired accounts
- "Lock all unprotected accounts" button → calls `POST /api/surfaces/signal/pin/bulk-set`
- Results displayed inline after completion

## 7. Re-registration Flow

When expiry is detected (account gone from `listAccounts`):

1. Harness card shows alert: "Signal registration lost — this number may have been re-registered by someone else"
2. "Re-register" button opens signal setup dialog pre-filled with:
   - Phone number (from harness `.env`)
   - PIN (from key store — auto-filled, user doesn't need to re-enter)
3. User completes SMS verification with a new code
4. After verify succeeds, stored PIN is automatically re-applied via `setPin`
5. Key health updated back to `"good"`

This means recovery requires only a new SMS code, not remembering or re-entering the PIN.

## 8. Security Considerations

### PIN strength

8-digit random numeric PINs provide 10^8 = 100M combinations. Signal's SVR2 rate-limits to 10 attempts before lockout, making brute force infeasible. Custom PINs must be minimum 4 digits.

### PIN visibility

PINs are encrypted at rest in `keys.json`. Decrypted only on explicit user action (reveal button). Not logged, not included in health check responses, not sent to Hermes agents.

### Backup responsibility

Users are advised to copy their PINs to a password manager. The info text in the setup dialog and the reveal UI both emphasize this. HSM does not provide external backup — that's the user's responsibility.

### 7-day keepalive dependency

Registration lock expires after 7 days without keepalive. The signal-cli daemon must stay running. Current mitigations:
- Docker `unless-stopped` restart policy
- autoheal container monitors and restarts unhealthy signal-cli
- HSM health check detects daemon downtime

If the entire machine is offline for 7+ days, locks will expire. This is a known limitation of Signal's protocol — there is no workaround.

## 9. Files Modified

| File | Change |
|------|--------|
| `app/api/surfaces/signal/verify/route.ts` | Add PIN param, call setPin after verify, store in key store |
| `app/api/surfaces/signal/pin/route.ts` | New — set/remove PIN on individual account |
| `app/api/surfaces/signal/pin/bulk-set/route.ts` | New — bulk-set PINs on all unprotected accounts |
| `app/api/surfaces/signal/pin/route.ts` | Also handles GET with `?phone=` query for PIN retrieval |
| `app/api/surfaces/signal/route.ts` | Extend health check with PIN status cross-reference |
| `components/surfaces/signal-setup-dialog.tsx` | Add PIN field to verify step + existing number flow |
| `components/surfaces/signal-pin-manager.tsx` | New — PIN status badge, reveal, change, remove UI |
| `app/(dashboard)/settings/page.tsx` | Add Signal Security section with bulk lock action |
| `lib/services/keys.ts` | Add `signal-pin` to PROVIDER_PATTERNS |
| `lib/resolvers/signal.ts` | Add `setPin` / `removePin` RPC helper functions |

## 10. Out of Scope

- Hermes agent changes (agents don't need to know about PINs)
- Automatic re-registration without user action (requires new SMS code, can't be automated)
- PIN sync to external backup systems
- Multi-device Signal linking (separate concern)
- signal-cli version upgrades (current version supports setPin)
