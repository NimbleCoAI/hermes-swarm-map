# Signal Registration Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect Signal bot accounts from number hijacking by enabling registration lock (PIN) via signal-cli, with storage in HSM's key store, UI management, and bulk retrofit for existing accounts.

**Architecture:** HSM-native approach. PIN lifecycle (set/remove/reveal/detect-expiry) lives entirely in HSM. signal-cli daemon keepalives maintain the lock automatically. PINs are stored encrypted in the existing key store (`keys.json`) as `signal-pin` provider keys. New API endpoints handle PIN operations via JSON-RPC to signal-cli. The setup dialog gains a PIN field on the verify step.

**Tech Stack:** Next.js API routes (TypeScript), signal-cli JSON-RPC, HSM KeysService (encrypted file store), React (Lucide icons, Sonner toasts, existing component patterns)

**Spec:** `docs/superpowers/specs/2026-06-02-signal-registration-lock-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/services/signal-pin.ts` | Create | PIN lifecycle: set, remove, get, bulk-set, status check via signal-cli JSON-RPC + key store |
| `lib/services/__tests__/signal-pin.test.ts` | Create | Tests for SignalPinService (key store operations, mock RPC) |
| `lib/services/index.ts` | Modify | Wire SignalPinService into `services` singleton |
| `app/api/surfaces/signal/pin/route.ts` | Create | POST (set PIN), DELETE (remove PIN), GET (reveal PIN by ?phone= query) |
| `app/api/surfaces/signal/pin/bulk-set/route.ts` | Create | POST to set PINs on all unprotected accounts |
| `app/api/surfaces/signal/verify/route.ts` | Modify | Accept `pin` param, call setPin after verification |
| `app/api/surfaces/signal/route.ts` | Modify | Extend health check with PIN status cross-reference |
| `components/surfaces/signal-pin-field.tsx` | Create | PIN input with auto-generate button, reused in setup dialog and management UI |
| `components/surfaces/signal-setup-dialog.tsx` | Modify | Add PIN field to verify step and existing-number flow |
| `components/surfaces/signal-pin-manager.tsx` | Create | PIN status badge + reveal/change/remove actions for harness detail page |
| `app/(dashboard)/settings/page.tsx` | Modify | Add Signal Security section with bulk lock action |

---

### Task 1: SignalPinService — Core Logic

**Files:**
- Create: `lib/services/signal-pin.ts`
- Create: `lib/services/__tests__/signal-pin.test.ts`

This service handles all PIN operations: calling signal-cli JSON-RPC and managing PIN storage in the key store.

- [ ] **Step 1: Write the failing tests**

Create `lib/services/__tests__/signal-pin.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SignalPinService } from '../signal-pin'
import { KeysService } from '../keys'
import { Storage } from '../storage'
import { AuditService } from '../audit'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Mock global fetch for signal-cli JSON-RPC calls
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('SignalPinService', () => {
  let tmpDir: string
  let keys: KeysService
  let pinService: SignalPinService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-pin-'))
    const storage = new Storage(tmpDir)
    const audit = new AuditService(storage)
    keys = new KeysService(storage, audit)
    pinService = new SignalPinService(keys, 'http://localhost:8080')
    mockFetch.mockReset()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('setPin', () => {
    it('calls signal-cli setPin RPC and stores PIN in key store', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: null, id: 1 }),
      })

      const result = await pinService.setPin('+15551234567', '12345678', 'h_personal')

      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledOnce()
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.method).toBe('setPin')
      expect(body.params.registrationLockPin).toBe('12345678')

      // PIN should be stored in key store
      const allKeys = keys.list([])
      const pinKey = allKeys.find(k => k.provider === 'signal-pin')
      expect(pinKey).toBeDefined()
      expect(pinKey!.name).toBe('Signal PIN (+15551234567)')
      expect(pinKey!.assignedTo).toEqual(['h_personal'])
    })

    it('updates existing PIN key if one exists for the same phone', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: null, id: 1 }),
      })

      await pinService.setPin('+15551234567', '11111111', 'h_personal')
      await pinService.setPin('+15551234567', '22222222', 'h_personal')

      const allKeys = keys.list([])
      const pinKeys = allKeys.filter(k => k.provider === 'signal-pin')
      expect(pinKeys).toHaveLength(1)
    })

    it('returns error when RPC fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'RPC error' } }),
      })

      const result = await pinService.setPin('+15551234567', '12345678', 'h_personal')
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('removePin', () => {
    it('calls signal-cli removePin RPC and removes PIN from key store', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: null, id: 1 }),
      })

      await pinService.setPin('+15551234567', '12345678', 'h_personal')
      const result = await pinService.removePin('+15551234567')

      expect(result.success).toBe(true)
      // Check removePin RPC was called
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
      const body = JSON.parse(lastCall[1].body)
      expect(body.method).toBe('removePin')

      const allKeys = keys.list([])
      expect(allKeys.find(k => k.provider === 'signal-pin')).toBeUndefined()
    })
  })

  describe('getPin', () => {
    it('returns decrypted PIN for a phone number', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: null, id: 1 }),
      })

      await pinService.setPin('+15551234567', '12345678', 'h_personal')
      const result = pinService.getPin('+15551234567')

      expect(result).not.toBeNull()
      expect(result!.pin).toBe('12345678')
      expect(result!.phone).toBe('+15551234567')
      expect(result!.health).toBe('good')
    })

    it('returns null for unknown phone', () => {
      expect(pinService.getPin('+19999999999')).toBeNull()
    })
  })

  describe('getPinStatus', () => {
    it('returns locked for accounts with PIN', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: null, id: 1 }),
      })

      await pinService.setPin('+15551234567', '12345678', 'h_personal')
      const status = pinService.getPinStatus('+15551234567')
      expect(status).toBe('locked')
    })

    it('returns not-set for accounts without PIN', () => {
      const status = pinService.getPinStatus('+19999999999')
      expect(status).toBe('not-set')
    })
  })

  describe('generatePin', () => {
    it('generates an 8-digit numeric PIN', () => {
      const pin = SignalPinService.generatePin()
      expect(pin).toMatch(/^\d{8}$/)
    })

    it('generates different PINs on successive calls', () => {
      const pins = new Set(Array.from({ length: 10 }, () => SignalPinService.generatePin()))
      expect(pins.size).toBeGreaterThan(1)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map && npx vitest run lib/services/__tests__/signal-pin.test.ts`

Expected: FAIL — `Cannot find module '../signal-pin'`

- [ ] **Step 3: Write the SignalPinService implementation**

Create `lib/services/signal-pin.ts`:

```typescript
import crypto from 'crypto'
import type { KeysService } from './keys'

type PinResult = { success: true } | { success: false; error: string }

type PinInfo = {
  phone: string
  pin: string
  health: 'good' | 'expired'
}

type BulkSetResult = {
  locked: string[]
  alreadyLocked: string[]
  failed: Array<{ phone: string; error: string }>
}

export class SignalPinService {
  constructor(
    private keys: KeysService,
    private signalApiUrl: string,
  ) {}

  /** Generate a cryptographically random 8-digit numeric PIN. */
  static generatePin(): string {
    return String(crypto.randomInt(10000000, 100000000))
  }

  /** Call signal-cli JSON-RPC. */
  private async rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const res = await fetch(`${this.signalApiUrl}/api/v1/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`Signal RPC ${method} failed: ${res.status}`)
    const data = await res.json()
    if (data.error) throw new Error(data.error.message || 'RPC error')
    return data.result
  }

  /**
   * Find the stored signal-pin key for a phone number.
   * Searches by the name field which contains the phone: "Signal PIN (+15551234567)"
   */
  private findPinKey(phone: string) {
    const allKeys = this.keys.list([])
    return allKeys.find(
      k => k.provider === 'signal-pin' && k.name === `Signal PIN (${phone})`
    )
  }

  /** Set registration lock PIN on a Signal account. */
  async setPin(phone: string, pin: string, harnessId: string): Promise<PinResult> {
    try {
      await this.rpc('setPin', { registrationLockPin: pin })
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }

    // Store or update in key store
    const existing = this.findPinKey(phone)
    if (existing) {
      // Remove old key, add new one (rotateValue changes fingerprint)
      this.keys.remove(existing.id)
    }
    this.keys.add({
      provider: 'signal-pin',
      name: `Signal PIN (${phone})`,
      value: pin,
      assignedTo: [harnessId],
    })

    return { success: true }
  }

  /** Remove registration lock PIN from a Signal account. */
  async removePin(phone: string): Promise<PinResult> {
    try {
      await this.rpc('removePin')
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }

    const existing = this.findPinKey(phone)
    if (existing) {
      this.keys.remove(existing.id)
    }

    return { success: true }
  }

  /** Get decrypted PIN for a phone number. Returns null if not found. */
  getPin(phone: string): PinInfo | null {
    const key = this.findPinKey(phone)
    if (!key) return null

    const pin = this.keys.getDecryptedValue(key.id)
    if (!pin) return null

    return { phone, pin, health: key.health as 'good' | 'expired' }
  }

  /** Get PIN status for a phone number. */
  getPinStatus(phone: string): 'locked' | 'expired' | 'not-set' {
    const key = this.findPinKey(phone)
    if (!key) return 'not-set'
    if (key.health === 'expired') return 'expired'
    return 'locked'
  }

  /**
   * Check registered accounts against stored PINs.
   * Marks PIN keys as expired if their account is missing from signal-cli.
   * Returns extended status per account.
   */
  async checkPinHealth(
    registeredAccounts: string[],
    harnessAccounts: Array<{ phone: string; harnessId: string }>
  ): Promise<Record<string, 'locked' | 'expired' | 'not-set'>> {
    const status: Record<string, 'locked' | 'expired' | 'not-set'> = {}

    for (const { phone } of harnessAccounts) {
      const key = this.findPinKey(phone)
      if (!key) {
        status[phone] = 'not-set'
        continue
      }

      if (!registeredAccounts.includes(phone)) {
        // Account missing from signal-cli — registration was lost
        this.keys.update(key.id, { health: 'expired' })
        status[phone] = 'expired'
      } else {
        // Account present and PIN exists — healthy
        if (key.health === 'expired') {
          this.keys.update(key.id, { health: 'good' })
        }
        status[phone] = 'locked'
      }
    }

    return status
  }

  /**
   * Bulk-set PINs on all registered accounts that don't have one.
   * Requires list of registered accounts from signal-cli listAccounts
   * and mapping of phone→harnessId.
   */
  async bulkSet(
    registeredAccounts: string[],
    phoneToHarness: Record<string, string>
  ): Promise<BulkSetResult> {
    const result: BulkSetResult = { locked: [], alreadyLocked: [], failed: [] }

    for (const phone of registeredAccounts) {
      const existing = this.findPinKey(phone)
      if (existing) {
        result.alreadyLocked.push(phone)
        continue
      }

      const pin = SignalPinService.generatePin()
      const harnessId = phoneToHarness[phone] || 'unknown'
      const setResult = await this.setPin(phone, pin, harnessId)

      if (setResult.success) {
        result.locked.push(phone)
      } else {
        result.failed.push({ phone, error: (setResult as { error: string }).error })
      }
    }

    return result
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map && npx vitest run lib/services/__tests__/signal-pin.test.ts`

Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map
git add lib/services/signal-pin.ts lib/services/__tests__/signal-pin.test.ts
git commit -m "feat: add SignalPinService for registration lock lifecycle"
```

---

### Task 2: Wire SignalPinService Into Services Singleton

**Files:**
- Modify: `lib/services/index.ts`

- [ ] **Step 1: Write the change**

In `lib/services/index.ts`, add the import and service initialization:

Add import at top:
```typescript
import { SignalPinService } from './signal-pin'
```

Add to the `services` object (after the `keys` line):
```typescript
signalPin: new SignalPinService(
  new KeysService(storage, audit, DATA_DIR),
  process.env.SIGNAL_API_URL || 'http://localhost:8080'
),
```

Wait — the `keys` instance is already created inline. Reuse it by extracting:

```typescript
const keysService = new KeysService(storage, audit, DATA_DIR)
```

Then update:
```typescript
export const services = {
  storage,
  docker,
  audit,
  config,
  harness,
  keys: keysService,
  tools,
  memory: new MemoryService(storage),
  signalPin: new SignalPinService(keysService, process.env.SIGNAL_API_URL || 'http://localhost:8080'),
}
```

- [ ] **Step 2: Run existing tests to verify no regression**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map && npx vitest run lib/services/__tests__/keys.test.ts`

Expected: All tests PASS (no behavioral change)

- [ ] **Step 3: Commit**

```bash
cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map
git add lib/services/index.ts
git commit -m "chore: wire SignalPinService into services singleton"
```

---

### Task 3: PIN API Routes

**Files:**
- Create: `app/api/surfaces/signal/pin/route.ts`
- Create: `app/api/surfaces/signal/pin/bulk-set/route.ts`

- [ ] **Step 1: Create the PIN route (GET/POST/DELETE)**

Create `app/api/surfaces/signal/pin/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { services } from '@/lib/services'
import { getSignalDaemonUrl } from '@/lib/env-helpers'

const SIGNAL_API = getSignalDaemonUrl()

export async function POST(request: Request) {
  const { phone, pin, harnessId } = await request.json() as {
    phone: string; pin: string; harnessId: string
  }

  if (!phone || !pin || !harnessId) {
    return NextResponse.json(
      { success: false, error: 'phone, pin, and harnessId required' },
      { status: 400 }
    )
  }

  if (pin.length < 4) {
    return NextResponse.json(
      { success: false, error: 'PIN must be at least 4 characters' },
      { status: 400 }
    )
  }

  // Verify account is registered before setting PIN
  try {
    const rpcRes = await fetch(`${SIGNAL_API}/api/v1/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'listAccounts', id: '1' }),
      signal: AbortSignal.timeout(5000),
    })
    const rpcData = await rpcRes.json()
    const registered = Array.isArray(rpcData.result) &&
      rpcData.result.some((a: { number?: string }) => a.number === phone)
    if (!registered) {
      return NextResponse.json(
        { success: false, error: `Account ${phone} not found in signal-cli` },
        { status: 404 }
      )
    }
  } catch {
    return NextResponse.json(
      { success: false, error: 'Cannot reach signal-cli daemon' },
      { status: 503 }
    )
  }

  const result = await services.signalPin.setPin(phone, pin, harnessId)
  if (!result.success) {
    return NextResponse.json(result, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const { phone } = await request.json() as { phone: string }

  if (!phone) {
    return NextResponse.json(
      { success: false, error: 'phone required' },
      { status: 400 }
    )
  }

  const result = await services.signalPin.removePin(phone)
  if (!result.success) {
    return NextResponse.json(result, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const phone = url.searchParams.get('phone')

  if (!phone) {
    return NextResponse.json(
      { success: false, error: 'phone query param required' },
      { status: 400 }
    )
  }

  const info = services.signalPin.getPin(phone)
  if (!info) {
    return NextResponse.json(
      { success: false, error: 'No PIN found for this number' },
      { status: 404 }
    )
  }

  return NextResponse.json(info)
}
```

- [ ] **Step 2: Create the bulk-set route**

Create `app/api/surfaces/signal/pin/bulk-set/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { services } from '@/lib/services'
import { getSignalDaemonUrl } from '@/lib/env-helpers'

const SIGNAL_API = getSignalDaemonUrl()

export async function POST() {
  // Get all registered accounts from signal-cli
  let accounts: Array<{ number?: string }> = []
  try {
    const rpcRes = await fetch(`${SIGNAL_API}/api/v1/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'listAccounts', id: '1' }),
      signal: AbortSignal.timeout(5000),
    })
    const rpcData = await rpcRes.json()
    if (Array.isArray(rpcData.result)) {
      accounts = rpcData.result
    }
  } catch {
    return NextResponse.json(
      { success: false, error: 'Cannot reach signal-cli daemon' },
      { status: 503 }
    )
  }

  const registeredPhones = accounts
    .map(a => a.number)
    .filter((n): n is string => !!n)

  if (registeredPhones.length === 0) {
    return NextResponse.json({ success: true, locked: [], alreadyLocked: [], failed: [] })
  }

  // Build phone→harnessId mapping from harness list
  const harnesses = services.harness.list()
  const phoneToHarness: Record<string, string> = {}
  for (const h of harnesses) {
    const signalAccount = h.channel // or derive from env
    if (signalAccount && registeredPhones.includes(signalAccount)) {
      phoneToHarness[signalAccount] = h.id
    }
  }

  // Fall back: scan harness env files for SIGNAL_ACCOUNT
  // This handles cases where h.channel isn't set
  if (Object.keys(phoneToHarness).length < registeredPhones.length) {
    for (const phone of registeredPhones) {
      if (!phoneToHarness[phone]) {
        phoneToHarness[phone] = 'unassigned'
      }
    }
  }

  const result = await services.signalPin.bulkSet(registeredPhones, phoneToHarness)
  return NextResponse.json({ success: true, ...result })
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map
git add app/api/surfaces/signal/pin/route.ts app/api/surfaces/signal/pin/bulk-set/route.ts
git commit -m "feat: add PIN management API routes (set/remove/reveal/bulk-set)"
```

---

### Task 4: Modify Verify Route to Set PIN After Registration

**Files:**
- Modify: `app/api/surfaces/signal/verify/route.ts`

- [ ] **Step 1: Add PIN parameter and setPin call**

In `app/api/surfaces/signal/verify/route.ts`, modify the request type to accept `pin` and `harnessId`:

Change the destructuring on line 10:
```typescript
const { phone, code, displayName, pin, harnessId } = await request.json() as {
  phone: string; code: string; displayName?: string; pin?: string; harnessId?: string
}
```

After the profile name update (after line 63, before the final return), add:

```typescript
    // Set registration lock PIN if provided
    if (pin && harnessId) {
      const { services } = await import('@/lib/services')
      const pinResult = await services.signalPin.setPin(phone, pin, harnessId)
      return NextResponse.json({ success: true, pinSet: pinResult.success })
    }

    return NextResponse.json({ success: true, pinSet: false })
```

Also update the existing `return NextResponse.json({ success: true })` on line 65 — replace it with the block above so there's only one success return path.

Full modified file after changes (the try block's success path, starting after the `updateProfile` call):

```typescript
    const profileName = displayName || 'Hermes Agent'
    await execAsync(
      `docker exec ${CONTAINER} signal-cli --config /home/.local/share/signal-cli -a ${phone} updateProfile --given-name '${profileName.replace(/'/g, "'\\''")}'`,
      { timeout: 15000 }
    ).catch(() => {})

    // Set registration lock PIN if provided
    let pinSet = false
    if (pin && harnessId) {
      const { services } = await import('@/lib/services')
      const pinResult = await services.signalPin.setPin(phone, pin, harnessId)
      pinSet = pinResult.success
    }

    return NextResponse.json({ success: true, pinSet })
```

- [ ] **Step 2: Commit**

```bash
cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map
git add app/api/surfaces/signal/verify/route.ts
git commit -m "feat: set registration lock PIN after Signal verification"
```

---

### Task 5: Extend Health Check with PIN Status

**Files:**
- Modify: `app/api/surfaces/signal/route.ts`

- [ ] **Step 1: Add PIN status to health check response**

Replace the full file content of `app/api/surfaces/signal/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getSignalDaemonUrl } from '@/lib/env-helpers'
import { services } from '@/lib/services'

const SIGNAL_API = getSignalDaemonUrl()

export async function GET() {
  try {
    const healthRes = await fetch(`${SIGNAL_API}/api/v1/check`, {
      signal: AbortSignal.timeout(3000),
    })
    const healthy = healthRes.ok

    let accounts: string[] = []
    if (healthy) {
      const rpcRes = await fetch(`${SIGNAL_API}/api/v1/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'listAccounts', id: '1' }),
        signal: AbortSignal.timeout(3000),
      })
      const rpcData = await rpcRes.json()
      if (Array.isArray(rpcData.result)) {
        accounts = rpcData.result.map((a: { number?: string }) => a.number || '')
      }
    }

    // Cross-reference PIN status for each known account
    const pinStatus: Record<string, string> = {}
    const harnesses = services.harness.list()
    const harnessAccounts: Array<{ phone: string; harnessId: string }> = []

    for (const h of harnesses) {
      if (h.platform === 'signal' && h.channel) {
        harnessAccounts.push({ phone: h.channel, harnessId: h.id })
      }
    }

    if (healthy && harnessAccounts.length > 0) {
      const status = await services.signalPin.checkPinHealth(accounts, harnessAccounts)
      Object.assign(pinStatus, status)
    } else {
      // Daemon not healthy — just report stored status
      for (const { phone } of harnessAccounts) {
        pinStatus[phone] = services.signalPin.getPinStatus(phone)
      }
    }

    // Find accounts that are registered but missing from harnesses (untracked)
    const trackedPhones = new Set(harnessAccounts.map(h => h.phone))
    const missing = accounts.filter(a => a && !trackedPhones.has(a))

    return NextResponse.json({ healthy, url: SIGNAL_API, accounts, pinStatus, missing })
  } catch {
    return NextResponse.json({ healthy: false, url: SIGNAL_API, accounts: [], pinStatus: {} })
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map
git add app/api/surfaces/signal/route.ts
git commit -m "feat: extend signal health check with PIN status cross-reference"
```

---

### Task 6: PIN Input Field Component

**Files:**
- Create: `components/surfaces/signal-pin-field.tsx`

- [ ] **Step 1: Create the reusable PIN field component**

Create `components/surfaces/signal-pin-field.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { RefreshCw, Eye, EyeOff, Copy, Check } from 'lucide-react'

type Props = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** Show reveal/copy controls (for management UI, not setup) */
  revealMode?: boolean
}

function generateClientPin(): string {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  // Range: 10000000–99999999 (8 digits)
  return String(10000000 + (arr[0] % 90000000))
}

export function SignalPinField({ value, onChange, disabled, revealMode }: Props) {
  const [visible, setVisible] = useState(!revealMode)
  const [copied, setCopied] = useState(false)

  function handleGenerate() {
    onChange(generateClientPin())
    setVisible(true)
  }

  function handleCopy() {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">Registration Lock PIN</label>
      <div className="flex items-center gap-1.5">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter PIN or generate"
          minLength={4}
          className="flex-1 px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm font-mono tracking-wider"
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="p-2 rounded-md border border-[var(--border)] hover:bg-muted"
          title={visible ? 'Hide' : 'Show'}
          disabled={disabled}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="p-2 rounded-md border border-[var(--border)] hover:bg-muted"
          title="Copy"
          disabled={disabled || !value}
        >
          {copied ? <Check className="h-4 w-4 text-[var(--success)]" /> : <Copy className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          className="p-2 rounded-md border border-[var(--border)] hover:bg-muted"
          title="Generate random PIN"
          disabled={disabled}
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Prevents anyone from re-registering this number on Signal.
        Save a backup — losing this PIN and your HSM data means losing access to this account.
      </p>
    </div>
  )
}

export { generateClientPin }
```

- [ ] **Step 2: Commit**

```bash
cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map
git add components/surfaces/signal-pin-field.tsx
git commit -m "feat: add SignalPinField component with generate/reveal/copy"
```

---

### Task 7: Integrate PIN Field into Signal Setup Dialog

**Files:**
- Modify: `components/surfaces/signal-setup-dialog.tsx`

- [ ] **Step 1: Add PIN state and import**

At the top of `signal-setup-dialog.tsx`, add the import:

```typescript
import { SignalPinField, generateClientPin } from './signal-pin-field'
```

Add state variable alongside the existing state declarations (after line 31):

```typescript
const [pin, setPin] = useState('')
```

- [ ] **Step 2: Initialize PIN on dialog open**

In the `useEffect` that runs on `open` change, add PIN initialization after `checkDaemonHealth()`:

```typescript
setPin(generateClientPin())
```

And in the reset block (when `!open`), add:

```typescript
setPin('')
```

- [ ] **Step 3: Send PIN to verify endpoint**

In the `handleVerify` function, modify the request body (around line 130):

```typescript
body: JSON.stringify({ phone, code: verifyCode, displayName, pin, harnessId }),
```

- [ ] **Step 4: Set PIN on existing number flow**

In the `handleExistingNumber` function (around line 166), add a PIN set call before `connectSurface()`:

```typescript
async function handleExistingNumber() {
  setLoading(true)
  setError('')

  // Set PIN on existing account
  if (pin) {
    try {
      const pinRes = await fetch('/api/surfaces/signal/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, pin, harnessId }),
      })
      const pinData = await pinRes.json()
      if (!pinData.success) {
        // Non-fatal — warn but continue connecting
        toast.warning(`Registration lock not set: ${pinData.error}`)
      }
    } catch {
      toast.warning('Could not set registration lock PIN')
    }
  }

  await connectSurface()
  setLoading(false)
}
```

- [ ] **Step 5: Add PIN field to verify step UI**

In the verify step JSX (the `{step === 'verify' && ...}` block), add the `SignalPinField` component after the Display Name input and before the error display:

```tsx
<SignalPinField value={pin} onChange={setPin} disabled={loading} />
```

- [ ] **Step 6: Add PIN field to existing number flow**

In the phone step, inside the `{hasExistingNumber && ...}` block (after the Display Name input), add:

```tsx
<SignalPinField value={pin} onChange={setPin} disabled={loading} />
```

- [ ] **Step 7: Commit**

```bash
cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map
git add components/surfaces/signal-setup-dialog.tsx
git commit -m "feat: integrate registration lock PIN into Signal setup dialog"
```

---

### Task 8: PIN Manager Component for Harness Detail Page

**Files:**
- Create: `components/surfaces/signal-pin-manager.tsx`

- [ ] **Step 1: Create the PIN manager component**

Create `components/surfaces/signal-pin-manager.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Shield, ShieldAlert, ShieldOff, Eye, EyeOff, Copy, Check, Loader2, Trash2 } from 'lucide-react'
import { SignalPinField } from './signal-pin-field'
import { toast } from 'sonner'

type PinStatus = 'locked' | 'expired' | 'not-set'

type Props = {
  phone: string
  harnessId: string
  status: PinStatus
  onStatusChange?: () => void
}

const STATUS_CONFIG: Record<PinStatus, { icon: typeof Shield; label: string; color: string }> = {
  locked: { icon: Shield, label: 'Locked', color: 'text-[var(--success)]' },
  expired: { icon: ShieldAlert, label: 'Expired', color: 'text-[var(--danger)]' },
  'not-set': { icon: ShieldOff, label: 'Not set', color: 'text-[var(--warning)]' },
}

export function SignalPinManager({ phone, harnessId, status, onStatusChange }: Props) {
  const [revealing, setRevealing] = useState(false)
  const [revealedPin, setRevealedPin] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [changing, setChanging] = useState(false)
  const [newPin, setNewPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const { icon: StatusIcon, label, color } = STATUS_CONFIG[status]

  async function handleReveal() {
    setRevealing(true)
    try {
      const res = await fetch(`/api/surfaces/signal/pin?phone=${encodeURIComponent(phone)}`)
      const data = await res.json()
      if (data.pin) {
        setRevealedPin(data.pin)
        // Auto-hide after 30 seconds
        setTimeout(() => setRevealedPin(null), 30000)
      } else {
        toast.error('No PIN found')
      }
    } catch {
      toast.error('Failed to retrieve PIN')
    } finally {
      setRevealing(false)
    }
  }

  function handleCopy() {
    if (!revealedPin) return
    navigator.clipboard.writeText(revealedPin)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleSetPin() {
    setSaving(true)
    try {
      const res = await fetch('/api/surfaces/signal/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, pin: newPin, harnessId }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Registration lock PIN set')
        setChanging(false)
        setNewPin('')
        onStatusChange?.()
      } else {
        toast.error(data.error || 'Failed to set PIN')
      }
    } catch {
      toast.error('Failed to set PIN')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    setRemoving(true)
    try {
      const res = await fetch('/api/surfaces/signal/pin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Registration lock removed')
        setConfirmRemove(false)
        onStatusChange?.()
      } else {
        toast.error(data.error || 'Failed to remove PIN')
      }
    } catch {
      toast.error('Failed to remove PIN')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusIcon className={`h-4 w-4 ${color}`} />
          <span className="font-medium">Registration Lock</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${color} bg-current/10`}>
            {label}
          </span>
        </div>
      </div>

      {/* Reveal existing PIN */}
      {status === 'locked' && !changing && (
        <div className="flex items-center gap-2">
          {revealedPin ? (
            <>
              <code className="font-mono text-sm bg-muted px-2 py-1 rounded tracking-wider">
                {revealedPin}
              </code>
              <button onClick={handleCopy} className="p-1.5 rounded hover:bg-muted" title="Copy">
                {copied ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              <button onClick={() => setRevealedPin(null)} className="p-1.5 rounded hover:bg-muted" title="Hide">
                <EyeOff className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <button
              onClick={handleReveal}
              disabled={revealing}
              className="text-xs text-[var(--accent)] hover:underline inline-flex items-center gap-1"
            >
              {revealing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
              Reveal PIN
            </button>
          )}
          <button
            onClick={() => setChanging(true)}
            className="text-xs text-muted-foreground hover:underline ml-2"
          >
            Change
          </button>
          <button
            onClick={() => setConfirmRemove(true)}
            className="text-xs text-[var(--danger)] hover:underline ml-1"
          >
            Remove
          </button>
        </div>
      )}

      {/* Set/Change PIN form */}
      {(status !== 'locked' || changing) && !confirmRemove && (
        <div className="space-y-2">
          <SignalPinField value={newPin} onChange={setNewPin} disabled={saving} />
          <div className="flex gap-2">
            <button
              onClick={handleSetPin}
              disabled={!newPin || newPin.length < 4 || saving}
              className="px-3 py-1.5 text-xs rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : status === 'locked' ? 'Update PIN' : 'Set PIN'}
            </button>
            {changing && (
              <button
                onClick={() => { setChanging(false); setNewPin('') }}
                className="px-3 py-1.5 text-xs rounded-md border border-[var(--border)] hover:bg-muted"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {/* Remove confirmation */}
      {confirmRemove && (
        <div className="p-3 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/20 space-y-2">
          <p className="text-xs font-medium text-[var(--danger)]">
            Removing registration lock means anyone with an SMS code for this number can hijack this account.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleRemove}
              disabled={removing}
              className="px-3 py-1.5 text-xs rounded-md bg-[var(--danger)] text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1"
            >
              {removing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Remove lock
            </button>
            <button
              onClick={() => setConfirmRemove(false)}
              className="px-3 py-1.5 text-xs rounded-md border border-[var(--border)] hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Expired state */}
      {status === 'expired' && (
        <p className="text-xs text-[var(--danger)]">
          This Signal account is no longer registered. The number may have been re-registered by someone else.
          Re-register to restore access — the stored PIN will be automatically re-applied.
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map
git add components/surfaces/signal-pin-manager.tsx
git commit -m "feat: add SignalPinManager component for harness detail page"
```

---

### Task 9: Add Signal Security Section to Settings Page

**Files:**
- Modify: `app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Add Signal Security section**

In `app/(dashboard)/settings/page.tsx`, add a new section after the Local API section (before the closing `</div>`). Add required state and imports at the top.

Add imports:
```tsx
import { Shield, Loader2 } from 'lucide-react'
```

Add state inside the component (after existing state declarations):
```tsx
const [bulkLocking, setBulkLocking] = useState(false)
const [signalStatus, setSignalStatus] = useState<{
  accounts: string[]
  pinStatus: Record<string, string>
} | null>(null)
const [signalLoading, setSignalLoading] = useState(false)

async function loadSignalStatus() {
  setSignalLoading(true)
  try {
    const res = await fetch('/api/surfaces/signal')
    const data = await res.json()
    if (data.healthy) {
      setSignalStatus({ accounts: data.accounts || [], pinStatus: data.pinStatus || {} })
    }
  } catch {}
  setSignalLoading(false)
}

async function handleBulkLock() {
  setBulkLocking(true)
  try {
    const res = await fetch('/api/surfaces/signal/pin/bulk-set', { method: 'POST' })
    const data = await res.json()
    if (data.success) {
      const count = data.locked?.length || 0
      const already = data.alreadyLocked?.length || 0
      const failed = data.failed?.length || 0
      toast.success(`Locked ${count} accounts (${already} already locked${failed ? `, ${failed} failed` : ''})`)
      loadSignalStatus()
    } else {
      toast.error(data.error || 'Bulk lock failed')
    }
  } catch {
    toast.error('Failed to set registration locks')
  }
  setBulkLocking(false)
}
```

Add a `useEffect` to load signal status (add `useEffect` to the React import if not already there):
```tsx
useEffect(() => { loadSignalStatus() }, [])
```

Add the JSX section:
```tsx
{/* Signal Security */}
<section>
  <h3 className="text-base font-medium mb-3 flex items-center gap-2">
    <Shield className="h-4 w-4" />
    Signal Security
  </h3>
  {signalLoading && <p className="text-muted-foreground text-sm">Loading...</p>}
  {signalStatus && (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Registered accounts</span>
        <span>{signalStatus.accounts.length}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Locked (PIN set)</span>
        <span className="text-[var(--success)]">
          {Object.values(signalStatus.pinStatus).filter(s => s === 'locked').length}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Unprotected</span>
        <span className={Object.values(signalStatus.pinStatus).filter(s => s === 'not-set').length > 0 ? 'text-[var(--warning)]' : ''}>
          {Object.values(signalStatus.pinStatus).filter(s => s === 'not-set').length}
        </span>
      </div>
      {Object.values(signalStatus.pinStatus).filter(s => s === 'expired').length > 0 && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Expired</span>
          <span className="text-[var(--danger)]">
            {Object.values(signalStatus.pinStatus).filter(s => s === 'expired').length}
          </span>
        </div>
      )}
      {Object.values(signalStatus.pinStatus).some(s => s === 'not-set') && (
        <button
          onClick={handleBulkLock}
          disabled={bulkLocking}
          className="w-full px-3 py-2 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {bulkLocking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
          Lock all unprotected accounts
        </button>
      )}
    </div>
  )}
</section>
```

- [ ] **Step 2: Commit**

```bash
cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map
git add app/\(dashboard\)/settings/page.tsx
git commit -m "feat: add Signal Security section with bulk lock to settings page"
```

---

### Task 10: Run Full Test Suite and Verify

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map && npx vitest run`

Expected: All tests pass, including the new `signal-pin.test.ts`.

- [ ] **Step 2: Run linter**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map && npx eslint app/api/surfaces/signal/ lib/services/signal-pin.ts components/surfaces/signal-pin-field.tsx components/surfaces/signal-pin-manager.tsx`

Expected: No errors (warnings are OK).

- [ ] **Step 3: Verify build**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map && npx next build`

Expected: Build succeeds.

- [ ] **Step 4: Commit any lint/build fixes**

If any fixes are needed:
```bash
cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map
git add -A
git commit -m "fix: lint and build fixes for signal registration lock"
```
