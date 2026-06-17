import { NextResponse } from 'next/server'
import { services } from '@/lib/services'
import { installBaselineTemplates } from '@/lib/services/templates'
import { defaultEnabledPlugins } from '@/lib/services/artifacts-manifest'
import { generateDefaultConfig, type McpServerConfig } from '@/lib/templates/config-yaml'
import { generateEnvContent, generateAgentCompose } from '@/lib/services/agent-deploy-templates'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'

const BASE_PORT = 8642
const PORT_STEP = 10

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function expandPath(p: string): string {
  return p.replace(/^~/, os.homedir())
}

function nextAvailablePort(): number {
  const usedPorts = new Set<number>()

  // Query Docker directly for all ports in use
  try {
    const output = execSync(
      `docker ps --format '{{.Ports}}'`,
      { stdio: 'pipe', timeout: 5000 }
    ).toString()
    // Parse port mappings like "0.0.0.0:8642->8642/tcp"
    const portMatches = output.matchAll(/0\.0\.0\.0:(\d+)/g)
    for (const m of portMatches) {
      usedPorts.add(parseInt(m[1]))
    }
  } catch {}

  // Find next available in the hermes range (8642+, step 10)
  let port = BASE_PORT
  while (usedPorts.has(port)) {
    port += PORT_STEP
  }
  return port
}

function generateConfigYaml(provider: string, primaryModel: string, fallbackModel?: string, browserEnabled?: boolean, mcpServers?: Record<string, McpServerConfig>): string {
  return generateDefaultConfig({ provider, primaryModel, fallbackModel, browserEnabled, mcpServers, enabledPlugins: defaultEnabledPlugins() })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, provider, primaryModel, fallbackModel, persona, tier,
      mattermostEnabled, mattermostUrl, mattermostToken,
      telegramEnabled, telegramToken, signalEnabled, signalPhone,
      githubToken, braveKey, existingKeyId, saveKeyToRegistry } = body
    const bundledOllama = body.bundledOllama === true

    if (!name || !provider || !primaryModel) {
      return NextResponse.json({ ok: false, error: 'name, provider, and primaryModel are required' }, { status: 400 })
    }

    const slug = slugify(name)
    if (!slug) {
      return NextResponse.json({ ok: false, error: 'Invalid name — could not slugify' }, { status: 400 })
    }

    // Resolve the LLM credential. An `existingKeyId` selects a key already in the
    // registry — its value is resolved server-side so the secret never crosses the
    // API boundary. Otherwise the pasted `llmKey` (if any) is used verbatim.
    let llmKey: string | undefined = body.llmKey || undefined
    if (existingKeyId) {
      const resolved = services.keys.getDecryptedValue(existingKeyId)
      if (!resolved) {
        return NextResponse.json({ ok: false, error: `Selected key "${existingKeyId}" not found in the registry.` }, { status: 400 })
      }
      llmKey = resolved
    }

    // Check Docker is available
    if (!services.docker.isAvailable()) {
      return NextResponse.json({ ok: false, error: 'Docker is not available' }, { status: 500 })
    }

    // Load settings early — needed for image/build decision and directory resolution
    const settings = services.config.getSettings()

    // Determine whether to build from local source or use a pre-built image
    let imageOrBuild: { image: string } | { build: string }

    if (settings.useLocalBuild && settings.hermesDir) {
      const resolvedHermesDir = expandPath(settings.hermesDir)
      const dockerfilePath = path.join(resolvedHermesDir, 'Dockerfile')
      if (fs.existsSync(dockerfilePath)) {
        imageOrBuild = { build: resolvedHermesDir }
      } else {
        return NextResponse.json({ ok: false, error: `useLocalBuild enabled but no Dockerfile found at ${resolvedHermesDir}` }, { status: 400 })
      }
    } else {
      // Try pulling from Docker Hub first; if that fails (auth, network), check for local builds
      let hermesImage = settings.defaultImage || 'ghcr.io/nimblecoai/hermes-agent-mt:latest'
      const pullResult = services.docker.pullImage(hermesImage)
      if (!pullResult.ok) {
        // Fallback: look for locally-built hermes images (from hermes-swarm build)
        // Prefer the most generic one (hermes-personal is the base build)
        try {
          const localOutput = execSync(
            'docker images --format "{{.Repository}}:{{.Tag}}" 2>/dev/null',
            { stdio: 'pipe', timeout: 5000 }
          ).toString()
          const hermesImages = localOutput.split('\n').filter(l => l.includes('hermes') && !l.includes('vertex') && !l.includes('litellm'))
          // Prefer images with "personal" (base build) or just any hermes image
          const preferred = hermesImages.find(i => i.includes('personal')) || hermesImages[0]
          if (preferred) {
            hermesImage = preferred.trim()
          } else {
            return NextResponse.json({ ok: false, error: `No Hermes image available. Pull failed: ${pullResult.error}` }, { status: 500 })
          }
        } catch {
          return NextResponse.json({ ok: false, error: `Image pull failed: ${pullResult.error}` }, { status: 500 })
        }
      }
      imageOrBuild = { image: hermesImage }
    }

    // Determine directories
    const swarmMapDataDir = settings.dataDir
      ? expandPath(settings.dataDir)
      : path.join(os.homedir(), '.hermes-swarm-map')
    const composeBaseDir = path.join(swarmMapDataDir, 'compose')

    const port = nextAvailablePort()

    const agentDataDir = path.join(os.homedir(), `.hermes-${slug}`)

    // Guard against clobbering an existing agent. Deploy is a CREATE-new flow and
    // every write below (.env with API keys, config.yaml, SOUL.md, BOOT.md) is
    // unconditional — re-deploying onto an existing slug would destroy its identity,
    // credentials, and config. Refuse instead (mirrors importFromDir). Manage an
    // existing agent from the dashboard.
    if (fs.existsSync(agentDataDir)) {
      return NextResponse.json(
        {
          error: `Agent "${slug}" already exists (${agentDataDir}). Pick a different name, or manage the existing agent from the dashboard.`,
        },
        { status: 409 },
      )
    }

    // Scaffold agent directory
    fs.mkdirSync(agentDataDir, { recursive: true })

    // Write .env
    const envContent = generateEnvContent({
      name: slug,
      port,
      provider,
      primaryModel,
      fallbackModel,
      llmKey,
      bundledOllama,
      mattermostUrl: mattermostEnabled ? mattermostUrl : undefined,
      mattermostToken: mattermostEnabled ? mattermostToken : undefined,
      telegramToken: telegramEnabled ? telegramToken : undefined,
      signalPhone: signalEnabled ? signalPhone : undefined,
      githubToken,
      braveKey,
      browserEnabled: body.browserEnabled === true,
    })
    fs.writeFileSync(path.join(agentDataDir, '.env'), envContent, { mode: 0o600 })

    // Git auth is provisioned by the agent runtime at container boot (a
    // cont-init hook reads this .env). HSM no longer writes the credential
    // files — single source of truth in the runtime.

    // Resolve Google MCP dir early (needed for both config.yaml and compose)
    const googleEnabled = body.googleEnabled === true
    const googleMcpCandidateDir = expandPath(process.env.GOOGLE_MCP_DIR || '~/Documents/GitHub/google-multiplayer-mcp')
    const googleMcpDir = googleEnabled && fs.existsSync(googleMcpCandidateDir) ? googleMcpCandidateDir : undefined

    // Build MCP servers config based on enabled integrations
    const githubMcpEnabled = body.githubMcpEnabled === true && !!githubToken
    const mcpServers: Record<string, McpServerConfig> = {}

    if (githubMcpEnabled) {
      mcpServers.github = {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}' },
      }
    }

    if (googleMcpDir) {
      mcpServers.google = {
        command: 'node',
        args: ['/opt/google-multiplayer-mcp/dist/index.js', '--config', '/opt/google/config.yaml'],
      }
    }

    // Write config.yaml
    const configContent = generateConfigYaml(provider, primaryModel, fallbackModel, body.browserEnabled === true, Object.keys(mcpServers).length > 0 ? mcpServers : undefined)
    fs.writeFileSync(path.join(agentDataDir, 'config.yaml'), configContent, 'utf-8')

    // Write SOUL.md
    const personalitySection = persona
      ? `## Personality\n\n${persona}`
      : `## Personality\n\nCustomize this section to give ${name} a distinct voice, tone, and purpose.\nWhat kind of assistant should ${name} be? Formal? Casual? Technical? Creative?`
    const soulContent = `# ${name}

You are **${name}**, a Hermes agent in a multi-tenant deployment managed by Hermes Swarm Map.

## How You Work

**Multi-platform:** You serve users across Signal, Telegram, Mattermost, and other platforms simultaneously. Each platform connection is independent.

**Memory isolation:** Your memory is scoped per-context. What you learn in one group chat stays in that group. You maintain separate context for each conversation thread. If someone asks "what did we talk about last time?" — you recall only what happened in THAT specific chat.

**Session lifecycle:** Your conversations reset after 24 hours of inactivity or at 4 AM daily. This keeps you fast and prevents runaway costs. Important context is preserved in your per-context memory.

**Skills are global:** Skills you learn or create are available across all your conversations. A skill learned in one group benefits everyone.

**Group approval:** You only respond in groups that your admin has approved. If you're added to a new group, you'll check with HSM before engaging.

## Behavioral Defaults

- Be helpful, direct, and honest
- When you don't know something, say so clearly
- Never reference or leak information between different conversations
- You can share that you run on Hermes if asked about your system
- Use \\\`/model\\\` to check or switch your AI model
- Use \\\`/memory\\\` to review what you remember about this conversation
- If you're unsure whether something is appropriate to share across contexts, don't

## Your Admin

Your admin manages you through HSM. They can:
- Approve/deny groups you can participate in
- Monitor your usage and costs
- Update your configuration and model
- Manage your API keys and budget

${personalitySection}
`
    fs.writeFileSync(path.join(agentDataDir, 'SOUL.md'), soulContent, 'utf-8')

    // Write BOOT.md
    const bootContent = `# Boot Checklist

On startup, verify your operational readiness:

1. **Check HSM connection** — Can you reach your management server? If not, note it but continue.
2. **Review your memory** — Check if you have any persistent memories from previous sessions.
3. **Verify skills** — Run a quick skills check. Note any skills that failed to load.
4. **Status report** — If everything is nominal, reply with [SILENT]. Only report if something needs attention.

If this is your very first startup ever, introduce yourself briefly in your home channel (if configured).
`
    fs.writeFileSync(path.join(agentDataDir, 'BOOT.md'), bootContent, 'utf-8')

    // Create memories directory
    fs.mkdirSync(path.join(agentDataDir, 'memories'), { recursive: true })

    // Install baseline plugins and hooks from templates
    await installBaselineTemplates(agentDataDir)

    // Generate standalone compose
    const agentComposeDir = path.join(composeBaseDir, slug)
    fs.mkdirSync(agentComposeDir, { recursive: true })
    const composePath = path.join(agentComposeDir, 'docker-compose.yml')
    fs.writeFileSync(composePath, generateAgentCompose(slug, port, agentDataDir, imageOrBuild, { googleMcpDir, githubMcpEnabled, bundledOllama }), 'utf-8')

    // Start the container
    try {
      execSync(`docker compose -f ${composePath} up -d`, { stdio: 'pipe', timeout: 60000 })
    } catch (err) {
      return NextResponse.json({
        ok: false,
        error: `Failed to start container: ${err instanceof Error ? err.message : String(err)}`,
      }, { status: 500 })
    }

    // Health check
    const healthy = services.docker.healthCheck(`http://localhost:${port}/health`, 30000)

    // Register overlay via harness service
    const overlay = await services.harness.createOverlay({
      name: slug,
      tier: tier ?? 'individual',
      platform: telegramEnabled ? 'telegram' : mattermostEnabled ? 'mattermost' : 'hermes',
      channel: `:${port}`,
      models: fallbackModel ? [primaryModel, fallbackModel] : [primaryModel],
    })

    // Key registry bookkeeping (best-effort — never fail an already-running deploy).
    // The agent's .env already carries the resolved value; this only records the
    // assignment / persists a freshly-pasted key for reuse by the next wizard run.
    try {
      const harnessId: string | undefined = overlay.id
      if (harnessId && existingKeyId) {
        const key = services.keys.list().find((k) => k.id === existingKeyId)
        const assignedTo = Array.from(new Set<string>([...(key?.assignedTo ?? []), harnessId]))
        services.keys.update(existingKeyId, { assignedTo })
      } else if (harnessId && saveKeyToRegistry && llmKey) {
        const value: string = llmKey
        services.keys.add({ provider, value, assignedTo: [harnessId] })
      }
    } catch (e) {
      console.error('key registry bookkeeping failed (agent is running):', e)
    }

    return NextResponse.json({
      ok: true,
      harnessId: overlay.id,
      port,
      healthy,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
