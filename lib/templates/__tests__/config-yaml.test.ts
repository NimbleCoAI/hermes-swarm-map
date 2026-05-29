import { describe, it, expect } from 'vitest'
import { generateDefaultConfig } from '../config-yaml'

describe('generateDefaultConfig', () => {
  const baseParams = {
    provider: 'anthropic',
    primaryModel: 'claude-sonnet-4-6',
  }

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
})
