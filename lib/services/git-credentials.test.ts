// @vitest-environment node
/**
 * Per-agent git credential provisioning.
 *
 * Agents run as a non-root user with HOME=/opt/data (the mounted data dir).
 * Writing ~/.git-credentials + ~/.gitconfig there gives `git` a working HTTPS
 * token without depending on `gh` (not installed) or SSH keys. The insteadOf
 * rewrites are load-bearing: without them, an agent that uses a git@github.com
 * remote fails with "Host key verification failed" even though the token works.
 * Each agent reads ONLY its own data dir, so tokens never cross-pollinate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import {
  buildGitCredentialsContent,
  buildGitConfigContent,
  provisionGitCredentials,
} from './git-credentials'

describe('buildGitCredentialsContent', () => {
  it('builds the HTTPS x-access-token line for the store helper', () => {
    expect(buildGitCredentialsContent('github_pat_ABC')).toBe(
      'https://x-access-token:github_pat_ABC@github.com\n'
    )
  })
})

describe('buildGitConfigContent', () => {
  const cfg = buildGitConfigContent({ name: 'nimbleco', email: 'n@users.noreply.github.com' })

  it('uses the store credential helper and identity', () => {
    expect(cfg).toContain('helper = store')
    expect(cfg).toContain('name = nimbleco')
    expect(cfg).toContain('email = n@users.noreply.github.com')
  })

  it('rewrites BOTH ssh-style github remotes to https (so the token is used)', () => {
    expect(cfg).toContain('[url "https://github.com/"]')
    expect(cfg).toContain('insteadOf = git@github.com:')
    expect(cfg).toContain('insteadOf = ssh://git@github.com/')
  })
})

describe('provisionGitCredentials', () => {
  let writes: Array<{ path: string; data: string; mode?: number }>

  beforeEach(() => {
    writes = []
    vi.spyOn(fs, 'writeFileSync').mockImplementation((p, data, opts) => {
      writes.push({ path: String(p), data: String(data), mode: (opts as any)?.mode })
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('writes .git-credentials (0600) and .gitconfig from the agent .env token', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('GITHUB_TOKEN=github_pat_XYZ\n' as never)

    const result = provisionGitCredentials('h_nimbleco', { dataDir: '/data/nimbleco' })

    expect(result.provisioned).toBe(true)
    const creds = writes.find(w => w.path === '/data/nimbleco/.git-credentials')!
    expect(creds.data).toContain('x-access-token:github_pat_XYZ@github.com')
    expect(creds.mode).toBe(0o600)
    expect(writes.some(w => w.path === '/data/nimbleco/.gitconfig')).toBe(true)
  })

  it('is a no-op when no GitHub token is configured', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('OTHER=1\n' as never)

    const result = provisionGitCredentials('h_nimbleco', { dataDir: '/data/nimbleco' })

    expect(result.provisioned).toBe(false)
    expect(writes).toHaveLength(0)
  })

  it('prefers a dedicated GITHUB_PAT over the copilot GITHUB_TOKEN', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      'GITHUB_TOKEN=copilot_tok\nGITHUB_PAT=github_pat_DEDICATED\n' as never
    )

    const result = provisionGitCredentials('h_nimbleco', { dataDir: '/data/nimbleco' })

    expect(result.source).toBe('GITHUB_PAT')
    const creds = writes.find(w => w.path === '/data/nimbleco/.git-credentials')!
    expect(creds.data).toContain('github_pat_DEDICATED')
  })
})
