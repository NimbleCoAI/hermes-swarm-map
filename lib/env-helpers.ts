/**
 * Shared helpers for env file manipulation in surface connect and settings routes.
 *
 * Key invariant: connecting a surface should NEVER overwrite policy vars
 * (ALLOWED_USERS, GROUP_ALLOWED_USERS, etc.) that the user set via settings.
 */

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
export const POLICY_VARS: Record<string, string[]> = {
  signal: ['SIGNAL_ALLOWED_USERS', 'SIGNAL_GROUP_ALLOWED_USERS', 'SIGNAL_REQUIRE_MENTION'],
  telegram: ['TELEGRAM_ALLOWED_USERS', 'TELEGRAM_GROUP_ALLOWED_CHATS', 'TELEGRAM_REQUIRE_MENTION'],
  mattermost: ['MATTERMOST_ALLOWED_USERS', 'MATTERMOST_ALLOWED_CHANNELS', 'MATTERMOST_REQUIRE_MENTION'],
  discord: ['DISCORD_ALLOWED_USERS', 'DISCORD_ALLOWED_CHANNELS', 'DISCORD_REQUIRE_MENTION'],
  slack: ['SLACK_ALLOWED_USERS', 'SLACK_ALLOWED_CHANNELS', 'SLACK_REQUIRE_MENTION'],
}

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
 * - allow-all policy or per-surface allowAll → '*'
 * - approved-only with specific users → comma-joined
 * - approved-only with no users → '' (empty = no one, secure default)
 */
export function buildSettingsEnvValue(
  dmPolicy: 'approved-only' | 'allow-all',
  surfaceAllowAll: boolean,
  users: string[]
): string {
  // Explicit users override allowAll — if someone added specific admins,
  // they want those people, not wildcard open access.
  if (users.length > 0) {
    return users.join(',')
  }
  if (dmPolicy === 'allow-all' || surfaceAllowAll) {
    return '*'
  }
  return ''
}
