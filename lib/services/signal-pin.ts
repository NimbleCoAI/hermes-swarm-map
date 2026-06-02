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

  static generatePin(): string {
    return String(crypto.randomInt(10000000, 100000000))
  }

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

  private findPinKey(phone: string) {
    const allKeys = this.keys.list([])
    return allKeys.find(
      k => k.provider === 'signal-pin' && k.name === `Signal PIN (${phone})`
    )
  }

  async setPin(phone: string, pin: string, harnessId: string): Promise<PinResult> {
    try {
      await this.rpc('setPin', { account: phone, pin })
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }

    const existing = this.findPinKey(phone)
    if (existing) {
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

  async removePin(phone: string): Promise<PinResult> {
    try {
      await this.rpc('removePin', { account: phone })
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }

    const existing = this.findPinKey(phone)
    if (existing) {
      this.keys.remove(existing.id)
    }

    return { success: true }
  }

  getPin(phone: string): PinInfo | null {
    const key = this.findPinKey(phone)
    if (!key) return null

    const pin = this.keys.getDecryptedValue(key.id)
    if (!pin) return null

    return { phone, pin, health: key.health as 'good' | 'expired' }
  }

  getPinStatus(phone: string): 'locked' | 'expired' | 'not-set' {
    const key = this.findPinKey(phone)
    if (!key) return 'not-set'
    if (key.health === 'expired') return 'expired'
    return 'locked'
  }

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
        this.keys.update(key.id, { health: 'expired' })
        status[phone] = 'expired'
      } else {
        if (key.health === 'expired') {
          this.keys.update(key.id, { health: 'good' })
        }
        status[phone] = 'locked'
      }
    }

    return status
  }

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
