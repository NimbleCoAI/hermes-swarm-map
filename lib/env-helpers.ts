/**
 * Shared helpers for env file manipulation in surface connect and settings routes.
 *
 * Key invariant: connecting a surface should NEVER overwrite policy vars
 * (ALLOWED_USERS, GROUP_ALLOWED_USERS, etc.) that the user set via settings.
 */

import { POLICY_VARS as DERIVED_POLICY_VARS } from '@/lib/surfaces/derive'

/**
 * Build env vars for a surface connect operation.
 * Returns ONLY connection-specific vars (URL, token, account) — never policy vars.
 */
export function buildConnectEnvVars(
  platform: string,
  config: Record<string, string>
): Record<string, string> {
  switch (platform) {
    case 'signal': {
      const vars: Record<string, string> = {
        SIGNAL_HTTP_URL: config.url || 'http://host.docker.internal:8080',
        SIGNAL_ACCOUNT: config.phone,
      }
      if (config.profileName) {
        vars.SIGNAL_PROFILE_NAME = config.profileName
      }
      return vars
    }
    case 'telegram':
      return {
        TELEGRAM_BOT_TOKEN: config.token,
      }
    case 'mattermost':
      return {
        MATTERMOST_URL: config.url,
        MATTERMOST_TOKEN: config.token,
      }
    case 'discord':
      return {
        DISCORD_BOT_TOKEN: config.token,
      }
    case 'slack':
      return {
        SLACK_BOT_TOKEN: config.botToken,
        SLACK_APP_TOKEN: config.appToken,
      }
    default:
      return {}
  }
}

/** Policy env var names per platform — these are never touched by connect. */
// Derived from the surface registry (lib/surfaces): [users, groups,
// requireMention] per platform. Re-exported for existing importers.
export const POLICY_VARS = DERIVED_POLICY_VARS

/**
 * Guard a value that will be spliced onto a single line of a generated file
 * (.env or docker-compose YAML). A CR or LF in the value would inject additional
 * `KEY=value` lines (policy override) or additional YAML keys (`privileged: true`
 * + `/:/host` → container breakout to host root) — the mechanism behind findings
 * F8–F11 of the 2026-07 security review. Values that legitimately live on one
 * line (secrets, tokens, URLs, image refs) never contain a newline, so we reject
 * rather than escape. `field` names the offending value in the thrown error.
 */
export function assertNoNewline(value: string, field = 'value'): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${field} must not contain newline characters`)
  }
  return value
}

/**
 * Merge env vars into an existing .env file content string.
 * Updates existing keys, appends new ones. Does not remove anything.
 */
export function mergeEnvVars(
  content: string,
  vars: Record<string, string>
): string {
  let result = content

  for (const [key, value] of Object.entries(vars)) {
    assertNoNewline(value, key)
    const regex = new RegExp(`^${key}=.*$`, 'm')
    if (regex.test(result)) {
      result = result.replace(regex, `${key}=${value}`)
    } else {
      result = result.trimEnd() + `\n${key}=${value}\n`
    }
  }

  return result
}

/**
 * Ensure policy defaults exist in .env content for a given platform.
 * Only writes if the key doesn't already exist (preserves user settings).
 * Default is empty string = "no one allowed" (secure default).
 */
export function ensurePolicyDefaults(
  content: string,
  platform: string
): string {
  const policyKeys = POLICY_VARS[platform]
  if (!policyKeys) return content

  let result = content
  for (const key of policyKeys) {
    const regex = new RegExp(`^${key}=`, 'm')
    if (!regex.test(result)) {
      // Secure default: empty string = no one allowed
      result = result.trimEnd() + `\n${key}=\n`
    }
  }

  return result
}

/**
 * Canonical URL for the signal-cli daemon.
 * Server-side code (API routes) should use this directly.
 * Agent .env files use host.docker.internal since agents run inside Docker.
 */
export function getSignalDaemonUrl(): string {
  return process.env.SIGNAL_API_URL || 'http://localhost:8080'
}

/**
 * Call the signal-cli JSON-RPC daemon (POST {daemon}/api/v1/rpc).
 *
 * The daemon is signal-cli's JSON-RPC daemon — it 404s on the REST `/v1/...`
 * paths; everything goes through this single RPC endpoint. Returns the parsed
 * `{result}` / `{error}` envelope.
 */
export async function callSignalRpc(
  method: string,
  params?: Record<string, unknown>,
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const res = await fetch(`${getSignalDaemonUrl()}/api/v1/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, id: '1', params }),
    signal: AbortSignal.timeout(15000),
  })
  return res.json()
}

/**
 * Build the value for a settings env var (ALLOWED_USERS etc.)
 *
 * Rules:
 * - per-surface allowAll → '*'
 * - specific users → comma-joined
 * - otherwise → '' (empty = no one, secure default)
 *
 * `dmPolicy` deliberately does NOT produce '*'. These vars are the *general*
 * user allowlist, not a DM-only one: `DISCORD_ALLOWED_USERS` gates guild
 * messages, slash commands and button interactions too (adapter
 * `_is_allowed_user`), so deriving '*' from a toggle the UI labels "DM Access
 * Policy" silently granted every member of a Discord server command access to
 * the agent. Only the explicit per-surface `allowAll` opts into a wildcard.
 * The parameter is retained so callers keep compiling and so the intent stays
 * documented at the one place that used to honor it.
 */
export function buildSettingsEnvValue(
  _dmPolicy: 'approved-only' | 'allow-all',
  surfaceAllowAll: boolean,
  users: string[]
): string {
  // Explicit users override allowAll — if someone added specific admins,
  // they want those people, not wildcard open access.
  if (users.length > 0) {
    return users.join(',')
  }
  if (surfaceAllowAll) {
    return '*'
  }
  return ''
}
