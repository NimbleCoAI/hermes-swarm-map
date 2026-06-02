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
    try {
      // Fallback for non-HTTPS contexts (e.g. LAN access)
      const textarea = document.createElement('textarea')
      textarea.value = revealedPin
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Last resort: select the text so user can Cmd+C
      const code = document.querySelector('[data-pin-display]')
      if (code) {
        const range = document.createRange()
        range.selectNodeContents(code)
        window.getSelection()?.removeAllRanges()
        window.getSelection()?.addRange(range)
      }
    }
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
              <code data-pin-display className="font-mono text-sm bg-muted px-2 py-1 rounded tracking-wider">
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
