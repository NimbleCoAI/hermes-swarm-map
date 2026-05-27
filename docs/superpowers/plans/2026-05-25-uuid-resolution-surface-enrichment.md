# UUID Resolution + Surface Enrichment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HSM resolves human-readable identifiers (phone numbers, @usernames) to platform-native IDs on save, stores both, checks against native IDs for auth. Signal surfaces also set profile name on connect and display richer info (profile name, account UUID).

**Architecture:** When an admin saves a phone number or username in the Surfaces tab, HSM calls the platform's resolution API (signal-cli `getUserStatus`, Telegram `getChat`, Mattermost `/api/v4/users/username`) to get the native ID. Stores `{display, nativeId}` pairs. The settings GET response returns native IDs in `allowedUsers` so `is_platform_admin` matches instantly. Signal connect also writes `SIGNAL_PROFILE_NAME` to `.env` and the surface card shows profile name + account UUID.

**Tech Stack:** Next.js API routes, signal-cli REST API (via `SIGNAL_HTTP_URL`), Telegram Bot API (via `TELEGRAM_BOT_TOKEN`), Mattermost REST API

**Repos:**
- `hermes-swarm-map` — all changes here (HSM)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `lib/resolvers/signal.ts` (create) | Resolve phone → UUID via signal-cli RPC |
| `lib/resolvers/telegram.ts` (create) | Resolve @username → numeric ID via Bot API |
| `lib/resolvers/mattermost.ts` (create) | Resolve username → internal ID via REST |
| `lib/resolvers/index.ts` (create) | Unified resolver interface |
| `app/api/harnesses/[id]/settings/route.ts` (modify) | PUT resolves identifiers on save, GET returns native IDs |
| `app/api/harnesses/[id]/surfaces/connect/route.ts` (modify) | Signal connect writes SIGNAL_PROFILE_NAME |
| `app/(dashboard)/harnesses/[id]/page.tsx` (modify) | Surface card shows profile name, resolution feedback |
| `lib/types.ts` (modify) | Add resolved identity types |

---

## Task 1: Signal Resolver

**Files:**
- Create: `/Users/juniperbevensee/Documents/GitHub/hermes-swarm-map/lib/resolvers/signal.ts`

- [ ] **Step 1: Create the signal resolver module**

```typescript
// lib/resolvers/signal.ts
import { readFileSync } from 'fs'
import path from 'path'
import os from 'os'

type ResolvedIdentity = {
  display: string      // what the admin entered (phone number)
  nativeId: string     // UUID resolved from signal-cli
  profileName?: string // Signal profile name if available
}

function getSignalConfig(harnessId: string): { url: string; account: string } | null {
  const name = harnessId.replace(/^h_/, '').replace(/_/g, '-')
  const dataDir = name === 'personal'
    ? path.join(os.homedir(), '.hermes')
    : path.join(os.homedir(), `.hermes-${name}`)
  const envPath = path.join(dataDir, '.env')

  try {
    const content = readFileSync(envPath, 'utf-8')
    const url = content.match(/^SIGNAL_HTTP_URL=(.+)$/m)?.[1]?.trim()
    const account = content.match(/^SIGNAL_ACCOUNT=(.+)$/m)?.[1]?.trim()
    if (url && account) return { url, account }
  } catch {}
  return null
}

/**
 * Resolve a phone number to a Signal UUID via signal-cli getUserStatus RPC.
 * Returns null if resolution fails (user not on Signal, signal-cli unreachable).
 */
export async function resolveSignalPhone(
  harnessId: string,
  phone: string
): Promise<ResolvedIdentity | null> {
  const config = getSignalConfig(harnessId)
  if (!config) return null

  try {
    const res = await fetch(`${config.url}/v1/users/${encodeURIComponent(config.account)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients: [phone] }),
    })
    if (!res.ok) return null
    const data = await res.json() as Array<{ uuid?: string; serviceId?: string; number?: string }>
    const entry = data?.[0]
    const uuid = entry?.uuid || entry?.serviceId
    if (uuid) {
      return { display: phone, nativeId: uuid }
    }
  } catch {}
  return null
}

/**
 * Get the Signal profile name for a given account.
 */
export async function getSignalProfileName(harnessId: string): Promise<string | null> {
  const config = getSignalConfig(harnessId)
  if (!config) return null

  try {
    const res = await fetch(`${config.url}/v1/profiles/${encodeURIComponent(config.account)}`)
    if (!res.ok) return null
    const data = await res.json()
    return data?.name || data?.givenName || null
  } catch {}
  return null
}
```

Note: The signal-cli REST API endpoint format may differ from above. The signal-cli daemon exposes a JSON-RPC API, not REST. Check the actual endpoints by looking at what the gateway uses. The RPC is at the HTTP URL with JSON-RPC 2.0 format. Let me correct:

```typescript
// lib/resolvers/signal.ts

type ResolvedIdentity = {
  display: string
  nativeId: string
  profileName?: string
}

export type { ResolvedIdentity }

function getSignalConfig(harnessId: string): { url: string; account: string } | null {
  const { readFileSync } = require('fs')
  const path = require('path')
  const os = require('os')

  const name = harnessId.replace(/^h_/, '').replace(/_/g, '-')
  const dataDir = name === 'personal'
    ? path.join(os.homedir(), '.hermes')
    : path.join(os.homedir(), `.hermes-${name}`)
  const envPath = path.join(dataDir, '.env')

  try {
    const content = readFileSync(envPath, 'utf-8')
    const url = content.match(/^SIGNAL_HTTP_URL=(.+)$/m)?.[1]?.trim()
    const account = content.match(/^SIGNAL_ACCOUNT=(.+)$/m)?.[1]?.trim()
    if (url && account) return { url, account }
  } catch {}
  return null
}

async function signalRpc(url: string, method: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
  })
  if (!res.ok) throw new Error(`Signal RPC ${method} failed: ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error.message || 'RPC error')
  return data.result
}

export async function resolveSignalPhone(
  harnessId: string,
  phone: string
): Promise<ResolvedIdentity | null> {
  const config = getSignalConfig(harnessId)
  if (!config) return null

  try {
    const result = await signalRpc(config.url, 'getUserStatus', {
      account: config.account,
      recipients: [phone],
    }) as Array<{ uuid?: string; serviceId?: string }>

    if (Array.isArray(result) && result[0]) {
      const uuid = result[0].uuid || result[0].serviceId
      if (uuid) return { display: phone, nativeId: uuid }
    }
  } catch {}
  return null
}

export async function getSignalAccountUuid(harnessId: string): Promise<string | null> {
  const config = getSignalConfig(harnessId)
  if (!config) return null

  try {
    const result = await signalRpc(config.url, 'listAccounts', {}) as Array<{ number?: string; uuid?: string }>
    if (Array.isArray(result)) {
      const acct = result.find(a => a.number === config.account)
      return acct?.uuid || null
    }
  } catch {}
  return null
}
```

- [ ] **Step 2: Commit**

```bash
git -C /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map add lib/resolvers/signal.ts
git -C /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map commit -m "feat(resolvers): add signal phone → UUID resolver via signal-cli RPC"
```

---

## Task 2: Telegram Resolver

**Files:**
- Create: `/Users/juniperbevensee/Documents/GitHub/hermes-swarm-map/lib/resolvers/telegram.ts`

- [ ] **Step 1: Create the telegram resolver**

```typescript
// lib/resolvers/telegram.ts
import type { ResolvedIdentity } from './signal'

function getTelegramToken(harnessId: string): string | null {
  const { readFileSync } = require('fs')
  const path = require('path')
  const os = require('os')

  const name = harnessId.replace(/^h_/, '').replace(/_/g, '-')
  const dataDir = name === 'personal'
    ? path.join(os.homedir(), '.hermes')
    : path.join(os.homedir(), `.hermes-${name}`)
  const envPath = path.join(dataDir, '.env')

  try {
    const content = readFileSync(envPath, 'utf-8')
    return content.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m)?.[1]?.trim() || null
  } catch {}
  return null
}

/**
 * Resolve a Telegram @username to numeric user ID via getChat.
 * Only works for public users/channels/groups.
 * Returns null if user is private or not found.
 */
export async function resolveTelegramUsername(
  harnessId: string,
  username: string
): Promise<ResolvedIdentity | null> {
  const token = getTelegramToken(harnessId)
  if (!token) return null

  // Ensure @ prefix
  const handle = username.startsWith('@') ? username : `@${username}`

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(handle)}`
    )
    if (!res.ok) return null
    const data = await res.json()
    if (data.ok && data.result?.id) {
      return {
        display: handle,
        nativeId: String(data.result.id),
        profileName: data.result.first_name
          ? `${data.result.first_name}${data.result.last_name ? ' ' + data.result.last_name : ''}`
          : undefined,
      }
    }
  } catch {}
  return null
}

/**
 * Resolve a Telegram numeric ID to display name.
 */
export async function getTelegramDisplayName(
  harnessId: string,
  numericId: string
): Promise<string | null> {
  const token = getTelegramToken(harnessId)
  if (!token) return null

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getChat?chat_id=${numericId}`
    )
    if (!res.ok) return null
    const data = await res.json()
    if (data.ok && data.result) {
      const r = data.result
      return r.title || r.first_name || r.username || null
    }
  } catch {}
  return null
}
```

- [ ] **Step 2: Commit**

```bash
git -C /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map add lib/resolvers/telegram.ts
git -C /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map commit -m "feat(resolvers): add telegram @username → numeric ID resolver"
```

---

## Task 3: Mattermost Resolver

**Files:**
- Create: `/Users/juniperbevensee/Documents/GitHub/hermes-swarm-map/lib/resolvers/mattermost.ts`

- [ ] **Step 1: Create the mattermost resolver**

```typescript
// lib/resolvers/mattermost.ts
import type { ResolvedIdentity } from './signal'

function getMattermostConfig(harnessId: string): { url: string; token: string } | null {
  const { readFileSync } = require('fs')
  const path = require('path')
  const os = require('os')

  const name = harnessId.replace(/^h_/, '').replace(/_/g, '-')
  const dataDir = name === 'personal'
    ? path.join(os.homedir(), '.hermes')
    : path.join(os.homedir(), `.hermes-${name}`)
  const envPath = path.join(dataDir, '.env')

  try {
    const content = readFileSync(envPath, 'utf-8')
    const url = content.match(/^MATTERMOST_URL=(.+)$/m)?.[1]?.trim()
    const token = content.match(/^MATTERMOST_TOKEN=(.+)$/m)?.[1]?.trim()
    if (url && token) return { url, token }
  } catch {}
  return null
}

/**
 * Resolve a Mattermost username to internal user ID.
 */
export async function resolveMattermostUsername(
  harnessId: string,
  username: string
): Promise<ResolvedIdentity | null> {
  const config = getMattermostConfig(harnessId)
  if (!config) return null

  // Strip @ if present
  const name = username.startsWith('@') ? username.slice(1) : username

  try {
    const res = await fetch(`${config.url}/api/v4/users/username/${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${config.token}` },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data.id) {
      const displayName = [data.first_name, data.last_name].filter(Boolean).join(' ') || data.username
      return { display: `@${name}`, nativeId: data.id, profileName: displayName }
    }
  } catch {}
  return null
}

/**
 * Resolve a Mattermost channel name to channel ID.
 */
export async function resolveMattermostChannel(
  harnessId: string,
  teamId: string,
  channelName: string
): Promise<{ id: string; displayName: string } | null> {
  const config = getMattermostConfig(harnessId)
  if (!config) return null

  try {
    const res = await fetch(
      `${config.url}/api/v4/teams/${teamId}/channels/name/${encodeURIComponent(channelName)}`,
      { headers: { Authorization: `Bearer ${config.token}` } }
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.id ? { id: data.id, displayName: data.display_name || data.name } : null
  } catch {}
  return null
}
```

- [ ] **Step 2: Commit**

```bash
git -C /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map add lib/resolvers/mattermost.ts
git -C /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map commit -m "feat(resolvers): add mattermost username → ID resolver"
```

---

## Task 4: Unified Resolver Index

**Files:**
- Create: `/Users/juniperbevensee/Documents/GitHub/hermes-swarm-map/lib/resolvers/index.ts`

- [ ] **Step 1: Create the unified resolver**

```typescript
// lib/resolvers/index.ts
export type { ResolvedIdentity } from './signal'
export { resolveSignalPhone, getSignalAccountUuid } from './signal'
export { resolveTelegramUsername, getTelegramDisplayName } from './telegram'
export { resolveMattermostUsername, resolveMattermostChannel } from './mattermost'

import { resolveSignalPhone } from './signal'
import { resolveTelegramUsername } from './telegram'
import { resolveMattermostUsername } from './mattermost'
import type { ResolvedIdentity } from './signal'

/**
 * Resolve an identifier for a given platform.
 * Detects whether the input is already a native ID (UUID, numeric) or needs resolution.
 */
export async function resolveIdentifier(
  harnessId: string,
  platform: string,
  identifier: string
): Promise<ResolvedIdentity | null> {
  switch (platform) {
    case 'signal': {
      // If already a UUID, skip resolution
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(identifier)) {
        return { display: identifier, nativeId: identifier }
      }
      return resolveSignalPhone(harnessId, identifier)
    }
    case 'telegram': {
      // If already numeric, skip resolution
      if (/^-?\d+$/.test(identifier)) {
        return { display: identifier, nativeId: identifier }
      }
      return resolveTelegramUsername(harnessId, identifier)
    }
    case 'mattermost': {
      // If already a 26-char alphanumeric ID, skip
      if (/^[a-z0-9]{26}$/.test(identifier)) {
        return { display: identifier, nativeId: identifier }
      }
      return resolveMattermostUsername(harnessId, identifier)
    }
    default:
      return null
  }
}
```

- [ ] **Step 2: Commit**

```bash
git -C /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map add lib/resolvers/index.ts
git -C /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map commit -m "feat(resolvers): unified resolver index with auto-detection"
```

---

## Task 5: Settings API — Resolve on PUT, Return Native IDs on GET

**Files:**
- Modify: `/Users/juniperbevensee/Documents/GitHub/hermes-swarm-map/app/api/harnesses/[id]/settings/route.ts`

- [ ] **Step 1: Add resolution to PUT handler**

After the PUT writes env vars but before writing the file, resolve each identifier in `allowedUsers` and store the resolved mappings in a sidecar JSON file (`{dataDir}/resolved-identities.json`).

Add after the imports:
```typescript
import { resolveIdentifier } from '@/lib/resolvers'
```

After the env write logic but before `fs.writeFileSync`, add:

```typescript
  // Resolve identifiers to native IDs (best-effort, non-blocking save)
  const resolvedMap: Record<string, Array<{ display: string; nativeId: string }>> = {}
  for (const [platform, settings] of Object.entries(body.surfaces)) {
    if (!settings?.allowedUsers?.length) continue
    const resolved: Array<{ display: string; nativeId: string }> = []
    for (const identifier of settings.allowedUsers) {
      const result = await resolveIdentifier(id, platform, identifier)
      if (result) {
        resolved.push(result)
      } else {
        // Keep unresolved entries with display = nativeId (fallback)
        resolved.push({ display: identifier, nativeId: identifier })
      }
    }
    resolvedMap[platform] = resolved
  }

  // Write resolved identities sidecar
  const resolvedPath = path.join(dataDir, 'resolved-identities.json')
  fs.writeFileSync(resolvedPath, JSON.stringify(resolvedMap, null, 2), { mode: 0o600 })
```

- [ ] **Step 2: Update GET to include resolved identities**

In the GET handler, after building `surfaces`, read the sidecar and enrich:

```typescript
  // Enrich with resolved identities if available
  const resolvedPath = path.join(dataDir, 'resolved-identities.json')
  let resolvedIdentities: Record<string, Array<{ display: string; nativeId: string }>> = {}
  try {
    resolvedIdentities = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'))
  } catch {}

  // Add nativeIds to each surface for fast auth checks
  for (const [platform, surf] of Object.entries(surfaces)) {
    const resolved = resolvedIdentities[platform]
    if (resolved) {
      (surf as any).resolvedUsers = resolved
      // Return native IDs as the primary allowedUsers for auth matching
      const nativeIds = resolved.map(r => r.nativeId).filter(Boolean)
      if (nativeIds.length > 0) {
        (surf as any).allowedUsers = [...new Set([...surf.allowedUsers, ...nativeIds])]
        (surf as any).adminUsers = (surf as any).allowedUsers
      }
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git -C /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map add app/api/harnesses/\[id\]/settings/route.ts
git -C /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map commit -m "feat(settings): resolve identifiers on save, return native IDs for auth"
```

---

## Task 6: Signal Connect — Set Profile Name

**Files:**
- Modify: `/Users/juniperbevensee/Documents/GitHub/hermes-swarm-map/app/api/harnesses/[id]/surfaces/connect/route.ts`
- Modify: `/Users/juniperbevensee/Documents/GitHub/hermes-swarm-map/lib/env-helpers.ts`

- [ ] **Step 1: Add profile name to signal connect config**

In `lib/env-helpers.ts`, update `buildConnectEnvVars` for signal:

```typescript
    case 'signal':
      const vars: Record<string, string> = {
        SIGNAL_HTTP_URL: config.url || 'http://host.docker.internal:8080',
        SIGNAL_ACCOUNT: config.phone,
      }
      if (config.profileName) {
        vars.SIGNAL_PROFILE_NAME = config.profileName
      }
      return vars
```

- [ ] **Step 2: Update signal setup dialog to include profile name field**

The Signal connect dialog in `/Users/juniperbevensee/Documents/GitHub/hermes-swarm-map/components/surfaces/signal-setup-dialog.tsx` needs a "Bot Name" field that maps to `profileName` in the config.

Read the file, find the form fields, and add a text input for profile name. The profile name is what the bot shows as its display name in Signal.

- [ ] **Step 3: Commit**

```bash
git -C /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map add lib/env-helpers.ts components/surfaces/signal-setup-dialog.tsx app/api/harnesses/\[id\]/surfaces/connect/route.ts
git -C /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map commit -m "feat(signal): write SIGNAL_PROFILE_NAME on connect, add to setup dialog"
```

---

## Task 7: Enrich Surface Display Card

**Files:**
- Modify: `/Users/juniperbevensee/Documents/GitHub/hermes-swarm-map/app/(dashboard)/harnesses/[id]/page.tsx`

- [ ] **Step 1: Show profile name and account UUID on Signal surface card**

In the surface card header (around line 653-661), add:

```tsx
                          <div>
                            <p className="font-medium text-sm">{s.name}</p>
                            <p className="text-xs text-muted-foreground capitalize">{s.platform}</p>
                            {s.config.url && (
                              <p className="text-xs font-mono text-muted-foreground">{s.config.url}</p>
                            )}
                            {s.config.phone && (
                              <p className="text-xs font-mono text-muted-foreground">{s.config.phone}</p>
                            )}
                            {s.config.profileName && (
                              <p className="text-xs text-muted-foreground">Profile: {s.config.profileName}</p>
                            )}
                          </div>
```

- [ ] **Step 2: Show resolved identities in the admin list**

In the expanded settings section (around line 692), update the TagInput display to show resolved names alongside the identifiers:

```tsx
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Admins ({labels.users})</label>
                            <TagInput
                              values={surf.allowedUsers}
                              onChange={(v) => updateSurfaceSetting(platform, 'allowedUsers', v)}
                              placeholder={`Add ${labels.users.toLowerCase()}...`}
                              renderTag={(value) => {
                                const resolved = surf.resolvedUsers?.find(
                                  (r: any) => r.display === value || r.nativeId === value
                                )
                                return resolved?.profileName
                                  ? `${value} (${resolved.profileName})`
                                  : value
                              }}
                            />
```

Note: This requires the TagInput component to support a `renderTag` prop. If it doesn't, add it. Check the component and adapt accordingly.

- [ ] **Step 3: Commit**

```bash
git -C /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map add app/\(dashboard\)/harnesses/\[id\]/page.tsx
git -C /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map commit -m "feat(ui): show profile name on surface cards, resolved names in admin list"
```

---

## Task 8: Remove user_id_alt Fallback (Cleanup)

**Files:**
- Modify: `/Users/juniperbevensee/Documents/GitHub/hermes-swarm/gateway/run.py`

Once HSM returns native IDs (UUIDs) in `allowedUsers`, the `user_id_alt` fallback in the early admin resolution is no longer needed. However, keep it as a safety net for now — only remove it after confirming UUID resolution works end-to-end in production.

This task is a future cleanup, not part of the initial implementation. Mark as deferred.

---

## Deployment Order

1. Tasks 1-4: Resolver modules (no behavior change, just new code)
2. Task 5: Settings API changes (backward-compatible — adds sidecar, enriches response)
3. Task 6: Signal connect + profile name
4. Task 7: UI enrichment
5. Task 8: Deferred cleanup after validation

## Notes

- Signal-cli RPC format: The gateway uses `self._rpc(method, params)` which is JSON-RPC 2.0 over HTTP. HSM needs to call the same endpoint. Check whether signal-cli uses SSE (event-stream) or standard request/response for RPC calls. The gateway connects via SSE for events but uses standard POST for RPC commands.
- Telegram `getChat` limitation: Only works for public users. For private users, HSM should show "unresolved" and let the admin enter the numeric ID directly. The UI should support both entry modes.
- Resolution is best-effort: If resolution fails, the identifier is stored as-is. The `user_id_alt` fallback in the gateway handles the mismatch until resolution succeeds.
