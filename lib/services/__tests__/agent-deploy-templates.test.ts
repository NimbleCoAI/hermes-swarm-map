import { describe, it, expect } from 'vitest'
import { generateEnvContent, generateAgentCompose } from '../agent-deploy-templates'

describe('generateEnvContent', () => {
  const base = { name: 'matilde', port: 8642, provider: 'anthropic', primaryModel: 'claude-opus-4-6' }

  it('writes a standard anthropic api key to ANTHROPIC_API_KEY', () => {
    const env = generateEnvContent({ ...base, llmKey: 'sk-ant-api-abc123' })
    expect(env).toContain('ANTHROPIC_API_KEY=sk-ant-api-abc123')
    expect(env).not.toContain('ANTHROPIC_TOKEN=')
  })

  it('routes a bearer-style anthropic credential to ANTHROPIC_TOKEN', () => {
    const env = generateEnvContent({ ...base, llmKey: 'sk-ant-oat-xyz' })
    expect(env).toContain('ANTHROPIC_TOKEN=sk-ant-oat-xyz')
    expect(env).not.toContain('ANTHROPIC_API_KEY=sk-ant-oat-xyz')
  })

  it('host ollama mode points OLLAMA_BASE_URL at host.docker.internal', () => {
    const env = generateEnvContent({ name: 'x', port: 8642, provider: 'ollama', primaryModel: 'qwen3:8b' })
    expect(env).toContain('OLLAMA_BASE_URL=http://host.docker.internal:11434/v1')
  })

  it('bundled ollama mode points OLLAMA_BASE_URL at the sidecar service', () => {
    const env = generateEnvContent({ name: 'sci', port: 8642, provider: 'ollama', primaryModel: 'qwen2.5:0.5b', bundledOllama: true })
    expect(env).toContain('OLLAMA_BASE_URL=http://ollama-sci:11434/v1')
    expect(env).not.toContain('host.docker.internal:11434')
  })

  it('writes signal env when a phone is provided', () => {
    const env = generateEnvContent({ ...base, signalPhone: '+15551234567' })
    expect(env).toContain('SIGNAL_ACCOUNT=+15551234567')
    expect(env).toContain('SIGNAL_HTTP_URL=http://host.docker.internal:8080')
  })

  it('adds CAMOFOX_URL only when browser enabled', () => {
    expect(generateEnvContent({ ...base, browserEnabled: true })).toContain('CAMOFOX_URL=')
    expect(generateEnvContent({ ...base })).not.toContain('CAMOFOX_URL=')
  })

  it('writes discord env + secure policy defaults when a bot token is provided', () => {
    const env = generateEnvContent({ ...base, discordToken: 'discord.bot.token' })
    expect(env).toContain('DISCORD_BOT_TOKEN=discord.bot.token')
    expect(env).toContain('DISCORD_ALLOWED_USERS=')
    expect(env).toContain('DISCORD_ALLOWED_CHANNELS=')
    // Mention-gating defaults on (mirrors the adapter's own default).
    expect(env).toContain('DISCORD_REQUIRE_MENTION=true')
  })

  it('leaves discord vars commented out when no token is provided', () => {
    const env = generateEnvContent({ ...base })
    expect(env).toContain('# DISCORD_BOT_TOKEN=')
    expect(env).not.toMatch(/^DISCORD_BOT_TOKEN=/m)
  })
})

describe('generateAgentCompose', () => {
  const args = { slug: 'sci', port: 8642, agentDataDir: '/home/u/.hermes-sci', imageOrBuild: { image: 'ghcr.io/x:latest' } as const }

  it('omits the ollama sidecar by default', () => {
    const c = generateAgentCompose(args.slug, args.port, args.agentDataDir, args.imageOrBuild)
    expect(c).not.toContain('ollama-sci:')
    expect(c).toContain('hermes-sci:')
  })

  it('emits a healthy-gated ollama sidecar when bundledOllama is set', () => {
    const c = generateAgentCompose(args.slug, args.port, args.agentDataDir, args.imageOrBuild, { bundledOllama: true })
    expect(c).toContain('ollama-sci:')
    expect(c).toContain('image: ollama/ollama')
    expect(c).toContain('qwen2.5:0.5b')
    expect(c).toContain('/home/u/.hermes-sci/.ollama:/root/.ollama')
    // hermes waits for the sidecar
    expect(c).toMatch(/depends_on:\s*\n\s*ollama-sci:\s*\n\s*condition: service_healthy/)
  })

  it('still injects the github env when githubMcpEnabled', () => {
    const c = generateAgentCompose(args.slug, args.port, args.agentDataDir, args.imageOrBuild, { githubMcpEnabled: true })
    expect(c).toContain('GITHUB_PERSONAL_ACCESS_TOKEN=${GITHUB_TOKEN}')
  })

  it('still mounts the google mcp volume when a dir is given', () => {
    const c = generateAgentCompose(args.slug, args.port, args.agentDataDir, args.imageOrBuild, { googleMcpDir: '/opt/gmcp' })
    expect(c).toContain('/opt/gmcp:/opt/google-multiplayer-mcp:ro')
  })

  it('mounts /run as exec so s6-overlay can boot under the read-only rootfs', () => {
    const c = generateAgentCompose(args.slug, args.port, args.agentDataDir, args.imageOrBuild)
    // We harden the container with a read-only rootfs...
    expect(c).toContain('read_only: true')
    // ...but s6-overlay execs /run/s6/basedir/bin/init. A bare `tmpfs: - /run`
    // is mounted noexec, so init fails with EACCES (exit 126) and the agent
    // restart-loops. /run must therefore be mounted exec.
    expect(c).toMatch(/-\s*\/run:exec\b/)
    expect(c).not.toMatch(/^\s*-\s*\/run\s*$/m)
  })
})
