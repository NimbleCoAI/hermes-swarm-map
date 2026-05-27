'use client'

import { useState, useRef, useEffect } from 'react'
import { MessageSquare, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

type Step = 'input' | 'verifying' | 'verified' | 'connecting' | 'done'

type Props = {
  open: boolean
  onClose: () => void
  harnessId: string
  onConnected: () => void
}

export function TelegramSetupDialog({ open, onClose, harnessId, onConnected }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [token, setToken] = useState('')
  const [adminUser, setAdminUser] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState<Step>('input')
  const [botUsername, setBotUsername] = useState('')

  useEffect(() => {
    if (open) {
      dialogRef.current?.showModal()
    } else {
      dialogRef.current?.close()
      setToken('')
      setAdminUser('')
      setError('')
      setStep('input')
      setLoading(false)
      setBotUsername('')
    }
  }, [open])

  const tokenValid = /^\d+:[A-Za-z0-9_-]+$/.test(token.trim())

  async function handleVerify() {
    setLoading(true)
    setError('')
    setStep('verifying')
    try {
      const res = await fetch(`https://api.telegram.org/bot${token.trim()}/getMe`)
      const data = await res.json()
      if (data.ok) {
        setBotUsername(data.result.username || data.result.first_name || 'Bot')
        setStep('verified')
      } else {
        setError(data.description || 'Invalid bot token')
        setStep('input')
      }
    } catch {
      setError('Failed to reach Telegram API — check your network')
      setStep('input')
    } finally {
      setLoading(false)
    }
  }

  async function handleConnect() {
    setLoading(true)
    setError('')
    setStep('connecting')
    try {
      const res = await fetch(`/api/harnesses/${harnessId}/surfaces/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'telegram',
          config: {
            token: token.trim(),
            ...(adminUser.trim() ? { adminUser: adminUser.trim() } : {}),
          },
        }),
      })
      const data = await res.json()

      if (data.success) {
        setStep('done')
        toast.success('Telegram connected')
        onConnected()
      } else {
        setError(data.error || 'Failed to connect')
        setStep('verified')
      }
    } catch {
      setError('Network error')
      setStep('verified')
    } finally {
      setLoading(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="backdrop:bg-black/50 rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 w-full max-w-md shadow-xl"
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-[var(--accent)]" />
          <h2 className="text-lg font-semibold">Connect Telegram</h2>
        </div>

        {step !== 'done' ? (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-2">
              <p className="font-medium">Setup instructions:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Open Telegram and message <strong>@BotFather</strong></li>
                <li>Send <code>/newbot</code> and follow the prompts</li>
                <li>Copy the bot token (looks like <code>123456:ABC-DEF...</code>)</li>
              </ol>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Bot Token</label>
              <input
                type="text"
                value={token}
                onChange={(e) => { setToken(e.target.value); if (step === 'verified') setStep('input') }}
                placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm font-mono"
                disabled={step === 'verifying' || step === 'connecting'}
              />
              {token && !tokenValid && (
                <p className="text-xs text-[var(--danger)]">Invalid token format (expected: number:alphanumeric)</p>
              )}
            </div>

            {step === 'verified' && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-[var(--success)]/10 border border-[var(--success)]/20">
                <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                <span className="text-sm">Verified: <strong>@{botUsername}</strong></span>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-sm font-medium">Admin (optional)</label>
              <input
                type="text"
                value={adminUser}
                onChange={(e) => setAdminUser(e.target.value)}
                placeholder="Your Telegram user ID or @username"
                className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm"
                disabled={step === 'verifying' || step === 'connecting'}
              />
              <p className="text-xs text-muted-foreground">
                Who can manage this bot. Numeric user ID or @username.
              </p>
            </div>

            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-[var(--border)] hover:bg-muted">
                Cancel
              </button>
              {step === 'input' || step === 'verifying' ? (
                <button
                  onClick={handleVerify}
                  disabled={!tokenValid || loading}
                  className="px-3 py-1.5 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
                </button>
              ) : (
                <button
                  onClick={handleConnect}
                  disabled={loading}
                  className="px-3 py-1.5 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connect'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-center py-4">
            <CheckCircle2 className="h-10 w-10 text-[var(--success)] mx-auto" />
            <p className="font-medium">Telegram connected!</p>
            {botUsername && <p className="text-sm text-muted-foreground">Bot: @{botUsername}</p>}
            <p className="text-sm text-muted-foreground">Restart the agent to activate.</p>
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90">
              Done
            </button>
          </div>
        )}
      </div>
    </dialog>
  )
}
