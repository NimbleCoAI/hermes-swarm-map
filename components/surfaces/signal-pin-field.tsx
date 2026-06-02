'use client'

import { useState } from 'react'
import { RefreshCw, Eye, EyeOff, Copy, Check } from 'lucide-react'

type Props = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  revealMode?: boolean
}

function generateClientPin(): string {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
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
    try {
      const textarea = document.createElement('textarea')
      textarea.value = value
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
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
