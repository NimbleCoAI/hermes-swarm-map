'use client'

import { useState, useRef, useEffect } from 'react'
import { MessageSquare, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

type Props = {
  open: boolean
  onClose: () => void
  harnessId: string
  onConnected: () => void
}

export function TelegramSetupDialog({ open, onClose, harnessId, onConnected }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (open) {
      dialogRef.current?.showModal()
    } else {
      dialogRef.current?.close()
      setToken('')
      setError('')
      setDone(false)
      setLoading(false)
    }
  }, [open])

  const tokenValid = /^\d+:[A-Za-z0-9_-]+$/.test(token.trim())

  async function handleConnect() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/harnesses/${harnessId}/surfaces/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'telegram', config: { token: token.trim() } }),
      })
      const data = await res.json()

      if (data.success) {
        setDone(true)
        toast.success('Telegram connected')
        onConnected()
      } else {
        setError(data.error || 'Failed to connect')
      }
    } catch {
      setError('Network error')
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

        {!done ? (
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
                onChange={(e) => setToken(e.target.value)}
                placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm font-mono"
              />
              {token && !tokenValid && (
                <p className="text-xs text-[var(--danger)]">Invalid token format (expected: number:alphanumeric)</p>
              )}
            </div>

            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-[var(--border)] hover:bg-muted">
                Cancel
              </button>
              <button
                onClick={handleConnect}
                disabled={!tokenValid || loading}
                className="px-3 py-1.5 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connect'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-center py-4">
            <CheckCircle2 className="h-10 w-10 text-[var(--success)] mx-auto" />
            <p className="font-medium">Telegram connected!</p>
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
