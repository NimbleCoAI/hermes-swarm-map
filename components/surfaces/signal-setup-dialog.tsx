// components/surfaces/signal-setup-dialog.tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import { Phone, ExternalLink, Loader2, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Rocket } from 'lucide-react'
import { toast } from 'sonner'
import { SignalPinField, generateClientPin } from './signal-pin-field'

type Step = 'phone' | 'registering' | 'captcha' | 'verify' | 'profile' | 'done' | 'error'

type Props = {
  open: boolean
  onClose: () => void
  harnessId: string
  harnessName?: string
  onConnected: () => void
}

export function SignalSetupDialog({ open, onClose, harnessId, harnessName, onConnected }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [displayName, setDisplayName] = useState(harnessName || '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [adminUser, setAdminUser] = useState('')
  const [hasExistingNumber, setHasExistingNumber] = useState(false)
  const [daemonHealthy, setDaemonHealthy] = useState<boolean | null>(null)
  const [healthChecking, setHealthChecking] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [pin, setPin] = useState('')

  async function checkDaemonHealth() {
    setHealthChecking(true)
    try {
      const res = await fetch('/api/surfaces/signal')
      const data = await res.json()
      setDaemonHealthy(data.healthy === true)
    } catch {
      setDaemonHealthy(false)
    } finally {
      setHealthChecking(false)
    }
  }

  async function handleDeploy() {
    setDeploying(true)
    try {
      const res = await fetch('/api/surfaces/signal/deploy', { method: 'POST' })
      const data = await res.json()
      if (data.healthy) {
        setDaemonHealthy(true)
        toast.success('Signal daemon started')
      } else if (data.status === 'already_running') {
        setDaemonHealthy(true)
        toast.info('Signal daemon already running')
      } else {
        toast.error('Daemon started but health check failed — it may still be booting')
        // Re-check after a moment
        setTimeout(checkDaemonHealth, 5000)
      }
    } catch {
      toast.error('Failed to deploy Signal daemon')
    } finally {
      setDeploying(false)
    }
  }

  useEffect(() => {
    if (open) {
      dialogRef.current?.showModal()
      checkDaemonHealth()
      setPin(generateClientPin())
    } else {
      dialogRef.current?.close()
      // Reset state on close
      setStep('phone')
      setPhone('')
      setCaptchaToken('')
      setVerifyCode('')
      setDisplayName(harnessName || '')
      setAdminUser('')
      setError('')
      setLoading(false)
      setHasExistingNumber(false)
      setDaemonHealthy(null)
      setDeploying(false)
      setPin('')
    }
  }, [open])

  async function handleRegister(captcha?: string) {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/surfaces/signal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, captcha }),
      })
      const data = await res.json()

      if (data.success) {
        setStep('verify')
      } else if (data.needsCaptcha) {
        // If we already submitted a captcha and it failed, show the error
        // on the captcha step so the user knows to try a new one
        if (captcha) {
          setError(data.error || 'Captcha failed — try a new one')
          setCaptchaToken('')
        }
        setStep('captcha')
      } else {
        setError(data.error || 'Registration failed')
        setStep('error')
      }
    } catch {
      setError('Network error')
      setStep('error')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/surfaces/signal/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: verifyCode, displayName, pin, harnessId }),
      })
      const data = await res.json()

      if (data.success) {
        await connectSurface()
      } else {
        setError(data.error || 'Verification failed')
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  async function connectSurface() {
    const res = await fetch(`/api/harnesses/${harnessId}/surfaces/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'signal',
        config: { phone, url: 'http://host.docker.internal:8080', profileName: displayName || undefined, adminUser: adminUser || undefined },
      }),
    })
    const data = await res.json()

    if (data.success) {
      setStep('done')
      toast.success('Signal connected')
      onConnected()
    } else {
      setError(data.error || 'Failed to save config')
    }
  }

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
          toast.warning(`Registration lock not set: ${pinData.error}`)
        }
      } catch {
        toast.warning('Could not set registration lock PIN')
      }
    }

    await connectSurface()
    setLoading(false)
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="backdrop:bg-black/50 rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 w-full max-w-md shadow-xl"
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Phone className="h-5 w-5 text-[var(--accent)]" />
          <h2 className="text-lg font-semibold">Connect Signal</h2>
        </div>

        {/* DAEMON HEALTH CHECK */}
        {step === 'phone' && daemonHealthy === null && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Checking Signal daemon...</span>
          </div>
        )}

        {step === 'phone' && daemonHealthy === false && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/20">
              <AlertTriangle className="h-5 w-5 text-[var(--warning)] shrink-0 mt-0.5" />
              <div className="space-y-2 text-sm">
                <p className="font-medium">Signal daemon not detected</p>
                <p className="text-muted-foreground">
                  HSM connects to Signal via signal-cli-rest-api running as a Docker container.
                </p>
                <p className="text-muted-foreground">To start it manually:</p>
                <code className="block text-xs bg-[var(--surface)] rounded p-2 font-mono">
                  cd ~/.hermes-swarm && docker compose -f docker-compose.signal.yml up -d
                </code>
                <p className="text-xs text-muted-foreground">
                  If you don&apos;t have the compose file yet, run the setup from <code>infra/signal-cli/</code> in the HSM repository.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-[var(--border)] hover:bg-muted">
                Cancel
              </button>
              <button
                onClick={checkDaemonHealth}
                disabled={healthChecking}
                className="px-3 py-1.5 text-sm rounded-md border border-[var(--border)] hover:bg-muted inline-flex items-center gap-1.5"
              >
                {healthChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Check again
              </button>
              <button
                onClick={handleDeploy}
                disabled={deploying}
                className="px-3 py-1.5 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                Deploy automatically
              </button>
            </div>
          </div>
        )}

        {/* PHONE STEP */}
        {step === 'phone' && daemonHealthy === true && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hasExistingNumber}
                  onChange={(e) => setHasExistingNumber(e.target.checked)}
                  className="rounded"
                />
                I already have a registered Signal number
              </label>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Phone Number (E.164)</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+15551234567"
                className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Admin User (optional)</label>
              <input
                type="text"
                value={adminUser}
                onChange={(e) => setAdminUser(e.target.value)}
                placeholder="+15559876543"
                className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Phone number in E.164 format. If set, only this user can DM the agent.
              </p>
            </div>
            {hasExistingNumber && (
              <>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Bot Display Name</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Signal profile name for this bot"
                    className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Sets the Signal profile name shown to contacts.
                  </p>
                </div>
                <SignalPinField value={pin} onChange={setPin} disabled={loading} />
              </>
            )}
            {!hasExistingNumber && (
              <p className="text-xs text-muted-foreground">
                You'll need to receive an SMS to this number for verification.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-[var(--border)] hover:bg-muted">
                Cancel
              </button>
              <button
                onClick={() => hasExistingNumber ? handleExistingNumber() : handleRegister()}
                disabled={!phone || loading}
                className="px-3 py-1.5 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : hasExistingNumber ? 'Connect' : 'Register'}
              </button>
            </div>
          </div>
        )}

        {/* REGISTERING (loading) */}
        {step === 'registering' && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* CAPTCHA STEP */}
        {step === 'captcha' && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/20 text-sm space-y-2">
              <p className="font-medium">Captcha required</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>
                  <a href="https://signalcaptchas.org/registration/generate.html" target="_blank" rel="noopener"
                    className="text-[var(--accent)] underline inline-flex items-center gap-1">
                    Open captcha page <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Solve the captcha</li>
                <li>Right-click "Open Signal" → Copy link address</li>
                <li>Paste the full URL below</li>
              </ol>
            </div>
            {error && (
              <p className="text-sm text-[var(--danger)] font-medium">{error}</p>
            )}
            <div className="space-y-1">
              <label className="text-sm font-medium">Captcha Token</label>
              <textarea
                value={captchaToken}
                onChange={(e) => setCaptchaToken(e.target.value)}
                placeholder="signalcaptcha://signal-hcaptcha..."
                rows={3}
                className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)] text-xs font-mono"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-[var(--border)] hover:bg-muted">
                Cancel
              </button>
              <button
                onClick={() => {
                  // Strip signalcaptcha:// prefix — signal-cli expects the token without it
                  const token = captchaToken.trim().replace(/^signalcaptcha:\/\//, '')
                  handleRegister(token)
                }}
                disabled={!captchaToken || loading}
                className="px-3 py-1.5 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit'}
              </button>
            </div>
          </div>
        )}

        {/* VERIFY STEP */}
        {step === 'verify' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              A verification code was sent to <strong>{phone}</strong> via SMS.
            </p>
            <div className="space-y-1">
              <label className="text-sm font-medium">Verification Code</label>
              <input
                type="text"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                placeholder="123456"
                maxLength={6}
                className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm font-mono text-center text-lg tracking-widest"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Signal profile name"
                className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm"
              />
            </div>
            <SignalPinField value={pin} onChange={setPin} disabled={loading} />
            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-[var(--border)] hover:bg-muted">
                Cancel
              </button>
              <button
                onClick={handleVerify}
                disabled={verifyCode.length < 6 || loading}
                className="px-3 py-1.5 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
              </button>
            </div>
          </div>
        )}

        {/* DONE STEP */}
        {step === 'done' && (
          <div className="space-y-4 text-center py-4">
            <CheckCircle2 className="h-10 w-10 text-[var(--success)] mx-auto" />
            <p className="font-medium">Signal connected!</p>
            <p className="text-sm text-muted-foreground">{phone} is now linked to this agent.</p>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90"
            >
              Done
            </button>
          </div>
        )}

        {/* ERROR STEP */}
        {step === 'error' && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/20">
              <XCircle className="h-5 w-5 text-[var(--danger)] shrink-0 mt-0.5" />
              <p className="text-sm">{error}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-[var(--border)] hover:bg-muted">
                Cancel
              </button>
              <button
                onClick={() => setStep('phone')}
                className="px-3 py-1.5 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  )
}
