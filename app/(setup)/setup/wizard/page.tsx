'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StepIndicator } from '@/components/wizard/step-indicator'

const STEP_LABELS = ['Identity', 'Model', 'Platforms', 'Keys', 'Deploy']
const TOTAL_STEPS = 5

type WizardState = {
  // Step 1
  name: string
  persona: string
  tier: string
  // Step 2
  provider: string
  primaryModel: string
  fallbackModel: string
  // Step 3
  mattermostEnabled: boolean
  mattermostUrl: string
  mattermostToken: string
  telegramEnabled: boolean
  telegramToken: string
  signalEnabled: boolean
  signalPhone: string
  googleEnabled: boolean
  githubMcpEnabled: boolean
  browserEnabled: boolean
  // Step 4
  llmKey: string
  githubToken: string
  braveKey: string
}

const INITIAL_STATE: WizardState = {
  name: '',
  persona: '',
  tier: 'individual',
  provider: 'anthropic',
  primaryModel: '',
  fallbackModel: '',
  mattermostEnabled: false,
  mattermostUrl: '',
  mattermostToken: '',
  telegramEnabled: false,
  telegramToken: '',
  signalEnabled: false,
  signalPhone: '',
  googleEnabled: false,
  githubMcpEnabled: false,
  browserEnabled: false,
  llmKey: '',
  githubToken: '',
  braveKey: '',
}

const TIER_OPTIONS = [
  { value: 'individual', label: 'Individual', desc: 'Personal agent' },
  { value: 'team', label: 'Team', desc: 'Shared with your team' },
  { value: 'org', label: 'Org', desc: 'Organization-wide' },
]

const PROVIDER_OPTIONS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'ollama', label: 'Ollama (local)' },
  { value: 'google', label: 'Google' },
  { value: 'bedrock', label: 'AWS Bedrock' },
]

const MODEL_SUGGESTIONS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-6'],
  openrouter: ['anthropic/claude-sonnet-4-6', 'anthropic/claude-opus-4-6', 'openai/gpt-4o'],
  ollama: ['qwen3:8b', 'qwen3:32b', 'llama3.3:70b'],
  google: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  bedrock: ['anthropic.claude-sonnet-4-6-v1', 'anthropic.claude-haiku-4-5-v1'],
}

const PROVIDER_KEY_MAP: Record<string, string | null> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  google: 'GOOGLE_API_KEY',
  bedrock: 'AWS_BEARER_TOKEN_BEDROCK',
  ollama: null,
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-sm font-medium mb-1">{children}</label>
}

function Section({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4">{children}</div>
}

export default function WizardPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [state, setState] = useState<WizardState>(INITIAL_STATE)
  const [deploying, setDeploying] = useState(false)
  const [deployResult, setDeployResult] = useState<{ ok: boolean; error?: string; port?: number; healthy?: boolean } | null>(null)
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null)
  const [dockerChecking, setDockerChecking] = useState(true)

  async function checkDocker() {
    setDockerChecking(true)
    try {
      const res = await fetch('/api/health/docker')
      const data = await res.json()
      setDockerAvailable(data.available === true)
    } catch {
      setDockerAvailable(false)
    } finally {
      setDockerChecking(false)
    }
  }

  useEffect(() => {
    checkDocker()
  }, [])

  function update(partial: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...partial }))
  }

  const slug = slugify(state.name)

  function canAdvance(): boolean {
    switch (step) {
      case 1: return state.name.trim().length > 0 && slug.length > 0
      case 2: return state.provider.length > 0 && state.primaryModel.trim().length > 0
      case 3: return true
      case 4: return true
      default: return false
    }
  }

  async function handleDeploy() {
    setDeploying(true)
    setDeployResult(null)
    try {
      const res = await fetch('/api/setup/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: slug,
          provider: state.provider,
          primaryModel: state.primaryModel,
          fallbackModel: state.fallbackModel || undefined,
          persona: state.persona,
          tier: state.tier,
          mattermostEnabled: state.mattermostEnabled,
          mattermostUrl: state.mattermostUrl,
          mattermostToken: state.mattermostToken,
          telegramEnabled: state.telegramEnabled,
          telegramToken: state.telegramToken,
          signalEnabled: state.signalEnabled,
          signalPhone: state.signalPhone,
          googleEnabled: state.googleEnabled,
          githubMcpEnabled: state.githubMcpEnabled,
          llmKey: state.llmKey || undefined,
          githubToken: state.githubToken || undefined,
          braveKey: state.braveKey || undefined,
        }),
      })
      const data = await res.json()
      if (data.ok) {
        // Mark onboarded
        await fetch('/api/setup/complete', { method: 'POST' })
      }
      setDeployResult(data)
    } catch (err) {
      setDeployResult({ ok: false, error: err instanceof Error ? err.message : 'Network error' })
    } finally {
      setDeploying(false)
    }
  }

  const providerKeyVar = PROVIDER_KEY_MAP[state.provider]
  const suggestions = MODEL_SUGGESTIONS[state.provider] ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <button
          onClick={() => router.push('/setup')}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to setup
        </button>
        <h1 className="text-2xl font-bold tracking-tight">Create Your First Agent</h1>
      </div>

      {/* Step indicator */}
      <StepIndicator currentStep={step} totalSteps={TOTAL_STEPS} labels={STEP_LABELS} />

      {/* Step content */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">

        {/* Docker check gate */}
        {dockerAvailable === false && (
          <div className="space-y-4">
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-4 space-y-2">
              <p className="font-semibold text-destructive">Docker is required but not detected.</p>
              <p className="text-sm text-muted-foreground">
                Install Docker Desktop from{' '}
                <a href="https://docker.com/products/docker-desktop" target="_blank" rel="noopener" className="underline text-[var(--accent)]">
                  docker.com/products/docker-desktop
                </a>{' '}
                and make sure it&apos;s running before continuing.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={checkDocker}
              disabled={dockerChecking}
            >
              {dockerChecking ? 'Checking...' : 'Check again'}
            </Button>
          </div>
        )}

        {dockerChecking && dockerAvailable === null && (
          <div className="flex items-center justify-center py-8">
            <span className="text-sm text-muted-foreground">Checking Docker availability...</span>
          </div>
        )}

        {/* Step 1: Identity */}
        {dockerAvailable && step === 1 && (
          <Section>
            <div>
              <FieldLabel>Agent Name</FieldLabel>
              <Input
                value={state.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="e.g. My Assistant"
                autoFocus
              />
              {slug && (
                <p className="text-xs text-muted-foreground mt-1">
                  Slug: <span className="font-mono">{slug}</span>
                </p>
              )}
            </div>

            <div>
              <FieldLabel>Persona (optional)</FieldLabel>
              <textarea
                value={state.persona}
                onChange={(e) => update({ persona: e.target.value })}
                placeholder="Describe this agent's purpose and personality…"
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div>
              <FieldLabel>Tier</FieldLabel>
              <div className="space-y-2">
                {TIER_OPTIONS.map((t) => (
                  <label
                    key={t.value}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      state.tier === t.value
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                        : 'border-[var(--border)] hover:bg-muted/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="tier"
                      value={t.value}
                      checked={state.tier === t.value}
                      onChange={() => update({ tier: t.value })}
                      className="accent-[var(--accent)]"
                    />
                    <div>
                      <div className="font-medium text-sm">{t.label}</div>
                      <div className="text-xs text-muted-foreground">{t.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </Section>
        )}

        {/* Step 2: Model */}
        {dockerAvailable && step === 2 && (
          <Section>
            <div>
              <FieldLabel>Provider</FieldLabel>
              <select
                value={state.provider}
                onChange={(e) => update({ provider: e.target.value, primaryModel: '' })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {PROVIDER_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <div>
              <FieldLabel>Primary Model</FieldLabel>
              <Input
                value={state.primaryModel}
                onChange={(e) => update({ primaryModel: e.target.value })}
                placeholder={suggestions[0] ?? 'model name'}
              />
              {suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => update({ primaryModel: s })}
                      className="text-xs px-2 py-1 rounded border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors font-mono"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <FieldLabel>Fallback Model (optional)</FieldLabel>
              <Input
                value={state.fallbackModel}
                onChange={(e) => update({ fallbackModel: e.target.value })}
                placeholder="Leave empty to skip"
              />
            </div>
          </Section>
        )}

        {/* Step 3: Platforms */}
        {dockerAvailable && step === 3 && (
          <Section>
            <p className="text-sm text-muted-foreground">
              Connect your agent to messaging platforms. You can skip this and configure later.
            </p>

            {/* Mattermost */}
            <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={state.mattermostEnabled}
                  onChange={(e) => update({ mattermostEnabled: e.target.checked })}
                  className="accent-[var(--accent)]"
                />
                <div>
                  <div className="font-medium text-sm">Mattermost</div>
                  <div className="text-xs text-muted-foreground">Connect to a Mattermost workspace</div>
                </div>
              </label>

              {state.mattermostEnabled && (
                <div className="space-y-2 pl-7">
                  <div>
                    <FieldLabel>Server URL</FieldLabel>
                    <Input
                      value={state.mattermostUrl}
                      onChange={(e) => update({ mattermostUrl: e.target.value })}
                      placeholder="https://mattermost.example.com"
                    />
                  </div>
                  <div>
                    <FieldLabel>Bot Token</FieldLabel>
                    <Input
                      type="password"
                      value={state.mattermostToken}
                      onChange={(e) => update({ mattermostToken: e.target.value })}
                      placeholder="xoxb-..."
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Telegram */}
            <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={state.telegramEnabled}
                  onChange={(e) => update({ telegramEnabled: e.target.checked })}
                  className="accent-[var(--accent)]"
                />
                <div>
                  <div className="font-medium text-sm">Telegram</div>
                  <div className="text-xs text-muted-foreground">Connect via a Telegram bot token</div>
                </div>
              </label>

              {state.telegramEnabled && (
                <div className="pl-7">
                  <FieldLabel>Bot Token</FieldLabel>
                  <Input
                    type="password"
                    value={state.telegramToken}
                    onChange={(e) => update({ telegramToken: e.target.value })}
                    placeholder="123456:ABC-..."
                  />
                </div>
              )}
            </div>

            {/* Signal */}
            <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={state.signalEnabled}
                  onChange={(e) => update({ signalEnabled: e.target.checked })}
                  className="accent-[var(--accent)]"
                />
                <div>
                  <div className="font-medium text-sm">Signal</div>
                  <div className="text-xs text-muted-foreground">Connect via a registered Signal number</div>
                </div>
              </label>

              {state.signalEnabled && (
                <div className="pl-7 space-y-2">
                  <div>
                    <FieldLabel>Phone Number (E.164)</FieldLabel>
                    <Input
                      value={state.signalPhone}
                      onChange={(e) => update({ signalPhone: e.target.value })}
                      placeholder="+15551234567"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The number must be registered with the signal-cli daemon. Use the Signal setup in the harness Surfaces tab to register a new number.
                  </p>
                </div>
              )}
            </div>

            {/* Google Workspace */}
            <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={state.googleEnabled}
                  onChange={(e) => update({ googleEnabled: e.target.checked })}
                  className="accent-[var(--accent)]"
                />
                <div>
                  <div className="font-medium text-sm">Google Workspace</div>
                  <div className="text-xs text-muted-foreground">Calendar, Drive, Gmail via NimbleCo Google MCP (requires OAuth setup)</div>
                </div>
              </label>

              {state.googleEnabled && (
                <div className="pl-7">
                  <p className="text-xs text-muted-foreground">
                    Google Workspace integration uses OAuth for authentication. After deployment,
                    visit the agent&apos;s OAuth callback URL to complete setup.
                    See <a href="https://github.com/NimbleCoAI/google-multiplayer-mcp" target="_blank" rel="noopener" className="underline">NimbleCoAI/google-multiplayer-mcp</a> for setup.
                  </p>
                </div>
              )}
            </div>

            {/* GitHub */}
            <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={state.githubMcpEnabled}
                  onChange={(e) => update({ githubMcpEnabled: e.target.checked })}
                  className="accent-[var(--accent)]"
                />
                <div>
                  <div className="font-medium text-sm">GitHub Tools</div>
                  <div className="text-xs text-muted-foreground">Repos, issues, PRs via official GitHub MCP server (requires GitHub token in Keys step)</div>
                </div>
              </label>

              {state.githubMcpEnabled && !state.githubToken && (
                <div className="pl-7">
                  <p className="text-xs text-amber-500">
                    Add a GitHub token in the Keys step for this to work. Fine-grained PATs are recommended for per-agent scoping.
                  </p>
                </div>
              )}
            </div>

            {/* Browser (Camofox) */}
            <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={state.browserEnabled}
                  onChange={(e) => update({ browserEnabled: e.target.checked })}
                  className="accent-[var(--accent)]"
                />
                <div>
                  <div className="font-medium text-sm">Browser Tools</div>
                  <div className="text-xs text-muted-foreground">Web browsing via Camofox (requires Camofox container running on host)</div>
                </div>
              </label>

              {state.browserEnabled && (
                <div className="pl-7">
                  <p className="text-xs text-muted-foreground">
                    Requires a Camofox browser container on the host. Agent connects via <code className="text-xs">host.docker.internal:9377</code>.
                  </p>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Step 4: Keys */}
        {dockerAvailable && step === 4 && (
          <Section>
            {/* Required key */}
            {providerKeyVar ? (
              <div>
                <FieldLabel>{providerKeyVar} (required for {state.provider})</FieldLabel>
                <Input
                  type="password"
                  value={state.llmKey}
                  onChange={(e) => update({ llmKey: e.target.value })}
                  placeholder="Paste your API key"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Stored in <span className="font-mono">~/.hermes-{slug}/.env</span> — never leaves your machine.
                </p>
              </div>
            ) : (
              <div className="rounded-lg bg-muted/30 border border-[var(--border)] p-4">
                <p className="text-sm font-medium">Ollama runs locally</p>
                <p className="text-sm text-muted-foreground mt-1">
                  No API key needed. Make sure Ollama is running and the model is pulled.
                </p>
              </div>
            )}

            {/* Optional keys */}
            <details className="group">
              <summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors list-none flex items-center gap-2">
                <svg className="w-3.5 h-3.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                Optional integrations
              </summary>
              <div className="mt-3 space-y-3">
                <div>
                  <FieldLabel>GitHub Token (optional)</FieldLabel>
                  <Input
                    type="password"
                    value={state.githubToken}
                    onChange={(e) => update({ githubToken: e.target.value })}
                    placeholder="ghp_..."
                  />
                </div>
                <div>
                  <FieldLabel>Brave Search API Key (optional)</FieldLabel>
                  <Input
                    type="password"
                    value={state.braveKey}
                    onChange={(e) => update({ braveKey: e.target.value })}
                    placeholder="BSA..."
                  />
                </div>
              </div>
            </details>
          </Section>
        )}

        {/* Step 5: Summary + Deploy */}
        {dockerAvailable && step === 5 && !deployResult && (
          <Section>
            <h3 className="font-semibold">Review &amp; Deploy</h3>

            <div className="rounded-lg bg-muted/30 border border-[var(--border)] p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Name</span>
                <span className="font-medium">{state.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Slug</span>
                <span className="font-mono">{slug}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tier</span>
                <span>{state.tier}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Provider</span>
                <span>{state.provider}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Primary model</span>
                <span className="font-mono">{state.primaryModel}</span>
              </div>
              {state.fallbackModel && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fallback model</span>
                  <span className="font-mono">{state.fallbackModel}</span>
                </div>
              )}
              {state.mattermostEnabled && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mattermost</span>
                  <span>{state.mattermostUrl || 'configured'}</span>
                </div>
              )}
              {state.telegramEnabled && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Telegram</span>
                  <span>configured</span>
                </div>
              )}
              {state.signalEnabled && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Signal</span>
                  <span>{state.signalPhone}</span>
                </div>
              )}
              {state.googleEnabled && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Google Workspace</span>
                  <span>enabled (OAuth setup after deploy)</span>
                </div>
              )}
              {state.githubMcpEnabled && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">GitHub Tools</span>
                  <span>{state.githubToken ? 'enabled' : 'enabled (needs token)'}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Data dir</span>
                <span className="font-mono">~/.hermes-{slug}/</span>
              </div>
            </div>

            {state.persona && (
              <div className="rounded-lg border border-[var(--border)] p-3">
                <p className="text-xs text-muted-foreground mb-1">Persona</p>
                <p className="text-sm">{state.persona}</p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              This will pull <span className="font-mono">ghcr.io/nimblecoai/hermes-agent:latest</span>, scaffold{' '}
              <span className="font-mono">~/.hermes-{slug}/</span>, and start the container.
            </p>
          </Section>
        )}

        {/* Deploy success */}
        {dockerAvailable && step === 5 && deployResult?.ok && (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-4">
              <p className="font-semibold text-green-700 dark:text-green-400">Agent deployed!</p>
              <p className="text-sm text-muted-foreground mt-1">
                <span className="font-mono">{slug}</span> is running on port{' '}
                <span className="font-mono">{deployResult.port}</span>.{' '}
                {deployResult.healthy ? 'Health check passed.' : 'Health check timed out — agent may still be starting.'}
              </p>
            </div>
            <Button className="w-full" onClick={() => router.push('/')}>
              Go to Dashboard
            </Button>
          </div>
        )}

        {/* Deploy error */}
        {dockerAvailable && step === 5 && deployResult && !deployResult.ok && (
          <div className="space-y-4">
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-4">
              <p className="font-semibold text-destructive">Deployment failed</p>
              <p className="text-sm text-muted-foreground mt-1 font-mono">{deployResult.error}</p>
            </div>
            <Button variant="outline" className="w-full" onClick={() => setDeployResult(null)}>
              Try Again
            </Button>
          </div>
        )}
      </div>

      {/* Navigation */}
      {!(step === 5 && deployResult?.ok) && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1 || deploying}
          >
            Back
          </Button>

          {step < 5 ? (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance()}
            >
              Continue
            </Button>
          ) : (
            !deployResult && (
              <Button
                onClick={handleDeploy}
                disabled={deploying}
              >
                {deploying ? 'Deploying...' : 'Deploy Agent'}
              </Button>
            )
          )}
        </div>
      )}
    </div>
  )
}
