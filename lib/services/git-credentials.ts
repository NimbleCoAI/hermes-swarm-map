/**
 * Per-agent git credential provisioning.
 *
 * Agents run as a non-root user with HOME=/opt/data (the mounted data dir).
 * Hermes ships no `gh` CLI and no SSH key, so the only reliable path is an
 * HTTPS personal access token via git's `store` credential helper. We write
 * the agent's OWN token (from its .env) into ~/.git-credentials + ~/.gitconfig
 * in its data dir. The insteadOf rewrites route ssh-style remotes
 * (git@github.com:, ssh://git@github.com/) through HTTPS too, so an agent that
 * reaches for an SSH URL doesn't die on "Host key verification failed".
 *
 * Each agent reads ONLY its own data dir — tokens never cross-pollinate, which
 * matters because agents carry different fine-grained PATs by design.
 */
import fs from 'fs'
import path from 'path'
import os from 'os'

const GIT_HOST = 'github.com'

// Checked in order; a dedicated GITHUB_PAT wins over the copilot GITHUB_TOKEN.
const TOKEN_VARS = ['GITHUB_PAT', 'GITHUB_TOKEN', 'GH_TOKEN'] as const

/** The ~/.git-credentials line the `store` helper reads for HTTPS GitHub auth. */
export function buildGitCredentialsContent(token: string): string {
  return `https://x-access-token:${token}@${GIT_HOST}\n`
}

/** Minimal ~/.gitconfig: store helper + identity + ssh→https rewrites. */
export function buildGitConfigContent(opts: { name: string; email: string }): string {
  return [
    '[credential]',
    '\thelper = store',
    '[user]',
    `\tname = ${opts.name}`,
    `\temail = ${opts.email}`,
    `[url "https://${GIT_HOST}/"]`,
    `\tinsteadOf = git@${GIT_HOST}:`,
    `\tinsteadOf = ssh://git@${GIT_HOST}/`,
    '',
  ].join('\n')
}

export function agentDataDir(harnessId: string): string {
  const name = harnessId.replace(/^h_/, '').replace(/_/g, '-')
  if (name === 'personal') return path.join(os.homedir(), '.hermes')
  return path.join(os.homedir(), `.hermes-${name}`)
}

function readEnvToken(envPath: string): { token: string; source: string } | null {
  let content: string
  try {
    content = fs.readFileSync(envPath, 'utf-8')
  } catch {
    return null
  }
  for (const key of TOKEN_VARS) {
    const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'))
    if (m) {
      const val = m[1].trim().replace(/^["']|["']$/g, '')
      if (val) return { token: val, source: key }
    }
  }
  return null
}

export interface ProvisionResult {
  provisioned: boolean
  reason?: string
  source?: string
}

/**
 * Write per-agent git auth from the agent's own configured GitHub PAT.
 * Idempotent; safe to call on every deploy. No-op (provisioned:false) when the
 * agent has no token configured.
 */
export function provisionGitCredentials(
  harnessId: string,
  opts?: { name?: string; email?: string; dataDir?: string },
): ProvisionResult {
  const dataDir = opts?.dataDir ?? agentDataDir(harnessId)
  const found = readEnvToken(path.join(dataDir, '.env'))
  if (!found) return { provisioned: false, reason: 'no GitHub token configured' }

  const name = opts?.name ?? harnessId.replace(/^h_/, '').replace(/_/g, '-')
  const email = opts?.email ?? `${name}@users.noreply.github.com`

  fs.writeFileSync(path.join(dataDir, '.git-credentials'), buildGitCredentialsContent(found.token), { mode: 0o600 })
  fs.writeFileSync(path.join(dataDir, '.gitconfig'), buildGitConfigContent({ name, email }), { mode: 0o644 })

  return { provisioned: true, source: found.source }
}
