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
    default:
      return {}
  }
}

/** Policy env var names per platform — these are never touched by connect. */
export const POLICY_VARS: Record<string, string[]> = {
  signal: ['SIGNAL_ALLOWED_USERS', 'SIGNAL_GROUP_ALLOWED_USERS', 'SIGNAL_REQUIRE_MENTION'],
  telegram: ['TELEGRAM_ALLOWED_USERS', 'TELEGRAM_GROUP_ALLOWED_CHATS', 'TELEGRAM_REQUIRE_MENTION'],
  mattermost: ['MATTERMOST_ALLOWED_USERS', 'MATTERMOST_ALLOWED_CHANNELS', 'MATTERMOST_REQUIRE_MENTION'],
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
