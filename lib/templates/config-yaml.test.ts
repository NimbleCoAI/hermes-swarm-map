import { describe, it, expect } from 'vitest'
import { generateDefaultConfig } from './config-yaml'

describe('generateDefaultConfig', () => {
  const baseParams = { provider: 'anthropic', primaryModel: 'claude-sonnet-4-5' }

  it('interpolates provider and primaryModel', () => {
    const result = generateDefaultConfig(baseParams)
    expect(result).toContain('provider: anthropic')
    expect(result).toContain('default: claude-sonnet-4-5')
  })

  it('includes fallbackModel when provided', () => {
    const result = generateDefaultConfig({ ...baseParams, fallbackModel: 'claude-haiku-3' })
    expect(result).toContain('fallback: claude-haiku-3')
    expect(result).not.toContain('# fallback: <model>')
  })

  it('omits fallbackModel line when not provided', () => {
    const result = generateDefaultConfig(baseParams)
    expect(result).toContain('# fallback: <model>')
    expect(result).not.toMatch(/^\s*fallback: \w/m)
  })

  it('contains compression section', () => {
    const result = generateDefaultConfig(baseParams)
    expect(result).toContain('compression:')
    expect(result).toContain('enabled: true')
    expect(result).toContain('threshold: 0.50')
    expect(result).toContain('target_ratio: 0.20')
    expect(result).toContain('protect_last_n: 20')
    expect(result).toContain('summary_model:')
  })

  it('contains memory section', () => {
    const result = generateDefaultConfig(baseParams)
    expect(result).toContain('memory:')
    expect(result).toContain('memory_enabled: true')
    expect(result).toContain('user_profile_enabled: true')
    expect(result).toContain('memory_char_limit: 2200')
    expect(result).toContain('nudge_interval: 10')
  })

  it('contains session_reset section', () => {
    const result = generateDefaultConfig(baseParams)
    expect(result).toContain('session_reset:')
    expect(result).toContain('mode: both')
    expect(result).toContain('idle_minutes: 1440')
    expect(result).toContain('at_hour: 4')
    expect(result).toContain('group_sessions_per_user: true')
  })

  it('contains agent section', () => {
    const result = generateDefaultConfig(baseParams)
    expect(result).toContain('agent:')
    expect(result).toContain('max_turns: 60')
    expect(result).toContain('reasoning_effort: "medium"')
  })

  it('contains stt section', () => {
    const result = generateDefaultConfig(baseParams)
    expect(result).toContain('stt:')
    expect(result).toContain('model: "base"')
  })

  it('contains tts section', () => {
    const result = generateDefaultConfig(baseParams)
    expect(result).toContain('tts:')
    expect(result).toContain('default_provider: "edge"')
    expect(result).toContain('voice: "en-US-AriaNeural"')
  })

  it('contains terminal section', () => {
    const result = generateDefaultConfig(baseParams)
    expect(result).toContain('terminal:')
    expect(result).toContain('backend: "local"')
    expect(result).toContain('timeout: 180')
  })

  it('contains skills section', () => {
    const result = generateDefaultConfig(baseParams)
    expect(result).toContain('skills:')
    expect(result).toContain('creation_nudge_interval: 15')
  })

  it('contains display section', () => {
    const result = generateDefaultConfig(baseParams)
    expect(result).toContain('display:')
    expect(result).toContain('compact: false')
    expect(result).toContain('tool_progress: all')
    expect(result).toContain('streaming: true')
  })

  it('contains platform_toolsets section', () => {
    const result = generateDefaultConfig(baseParams)
    expect(result).toContain('platform_toolsets:')
    expect(result).toContain('cli: [hermes-cli]')
    expect(result).toContain('telegram: [hermes-telegram]')
    expect(result).toContain('signal: [hermes-signal]')
  })

  it('adds base_url for ollama provider', () => {
    const result = generateDefaultConfig({ provider: 'ollama', primaryModel: 'llama3' })
    expect(result).toContain('provider: custom')
    expect(result).toContain('base_url: "http://host.docker.internal:11434/v1"')
  })

  it('adds base_url for custom provider', () => {
    const result = generateDefaultConfig({ provider: 'custom', primaryModel: 'my-model' })
    expect(result).toContain('provider: custom')
    expect(result).toContain('base_url: "http://host.docker.internal:11434/v1"')
  })

  it('does not add base_url for non-ollama providers', () => {
    const result = generateDefaultConfig(baseParams)
    expect(result).not.toContain('base_url:')
  })

  // --- MCP Servers ---

  it('generates config without mcp_servers when none provided', () => {
    const config = generateDefaultConfig(baseParams)
    expect(config).not.toContain('mcp_servers:')
  })

  it('generates github mcp_servers section when github is enabled', () => {
    const config = generateDefaultConfig({
      ...baseParams,
      mcpServers: {
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}' },
        },
      },
    })
    expect(config).toContain('mcp_servers:')
    expect(config).toContain('  github:')
    expect(config).toContain('    command: npx')
    expect(config).toContain('      - "-y"')
    expect(config).toContain('      - "@modelcontextprotocol/server-github"')
    expect(config).toContain('    env:')
    expect(config).toContain('      GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}"')
  })

  it('generates google mcp_servers section when google is enabled', () => {
    const config = generateDefaultConfig({
      ...baseParams,
      mcpServers: {
        google: {
          command: 'node',
          args: ['/opt/google-mcp/dist/index.js', '--config', '/opt/google/config.yaml'],
        },
      },
    })
    expect(config).toContain('mcp_servers:')
    expect(config).toContain('  google:')
    expect(config).toContain('    command: node')
  })

  it('generates both mcp_servers when both enabled', () => {
    const config = generateDefaultConfig({
      ...baseParams,
      mcpServers: {
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}' },
        },
        google: {
          command: 'node',
          args: ['/opt/google-mcp/dist/index.js', '--config', '/opt/google/config.yaml'],
        },
      },
    })
    expect(config).toContain('  github:')
    expect(config).toContain('  google:')
  })

  it('does not include env key when server has no env vars', () => {
    const config = generateDefaultConfig({
      ...baseParams,
      mcpServers: {
        google: {
          command: 'node',
          args: ['/opt/google-mcp/dist/index.js', '--config', '/opt/google/config.yaml'],
        },
      },
    })
    const googleSection = config.split('google:')[1]?.split('\n\n')[0] ?? ''
    expect(googleSection).not.toContain('env:')
  })

  it('generates url-based mcp server config', () => {
    const config = generateDefaultConfig({
      ...baseParams,
      mcpServers: {
        notion: {
          url: 'https://mcp.notion.com/mcp',
        },
      },
    })
    expect(config).toContain('mcp_servers:')
    expect(config).toContain('  notion:')
    expect(config).toContain('    url: https://mcp.notion.com/mcp')
    expect(config).not.toContain('    command:')
  })

  it('produces valid YAML structure (no syntax errors)', () => {
    const result = generateDefaultConfig(baseParams)
    // Basic structural checks: no tabs, proper indentation, all colons have values or nested blocks
    expect(result).not.toMatch(/\t/)
    // Every non-comment, non-blank line should be key: value or key: (block)
    const lines = result.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))
    for (const line of lines) {
      // Each line is either a top-level key or indented key: value
      expect(line).toMatch(/^(\s*[\w_]+:\s*.*|$)/)
    }
  })
})
