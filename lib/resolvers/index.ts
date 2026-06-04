// lib/resolvers/index.ts

export type { ResolvedIdentity } from './signal'
export { resolveSignalPhone, getSignalAccountUuid } from './signal'
export { resolveTelegramUsername, getTelegramDisplayName } from './telegram'
export { resolveMattermostUsername } from './mattermost'

import { resolveSignalPhone } from './signal'
import { resolveTelegramUsername } from './telegram'
import { resolveMattermostUsername } from './mattermost'
import type { ResolvedIdentity } from './signal'

const SIGNAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/

/**
 * Expand a Signal allowlist so every phone-number entry is stored alongside its
 * resolved UUID.
 *
 * Sealed-sender DMs identify the sender only by UUID, never phone number, and
 * the gateway matches that inbound UUID against SIGNAL_ALLOWED_USERS verbatim.
 * A phone-number-only allowlist therefore silently rejects the very person it
 * names (e.g. a fresh contact with no groups in common). Storing BOTH the phone
 * and its UUID makes the allowlist match whichever identifier signal-cli
 * surfaces for a given contact relationship.
 *
 * - '*' and entries already in UUID form pass through untouched.
 * - Phone numbers that resolve gain their UUID alongside the number.
 * - Phone numbers that fail to resolve pass through unchanged (no worse than
 *   before; resolution retries on the next write once the daemon can see them).
 *
 * Order is preserved and duplicates are removed.
 */
export async function expandSignalAllowlist(
  harnessId: string,
  identifiers: string[]
): Promise<string[]> {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (value: string) => {
    const trimmed = value.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      out.push(trimmed)
    }
  }

  for (const raw of identifiers) {
    const id = raw.trim()
    if (!id) continue
    push(id)
    if (id === '*' || SIGNAL_UUID_RE.test(id) || !id.startsWith('+')) continue
    const resolved = await resolveSignalPhone(harnessId, id)
    if (resolved?.nativeId) push(resolved.nativeId)
  }

  return out
}

/**
 * Resolve an identifier for a given platform.
 * Detects whether the input is already a native ID or needs resolution.
 */
export async function resolveIdentifier(
  harnessId: string,
  platform: string,
  identifier: string
): Promise<ResolvedIdentity | null> {
  switch (platform) {
    case 'signal': {
      // Already a UUID — skip resolution
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(identifier)) {
        return { display: identifier, nativeId: identifier }
      }
      return resolveSignalPhone(harnessId, identifier)
    }
    case 'telegram': {
      // Already numeric — skip resolution
      if (/^-?\d+$/.test(identifier)) {
        return { display: identifier, nativeId: identifier }
      }
      return resolveTelegramUsername(harnessId, identifier)
    }
    case 'mattermost': {
      // Already a 26-char alphanumeric ID — skip
      if (/^[a-z0-9]{26}$/.test(identifier)) {
        return { display: identifier, nativeId: identifier }
      }
      return resolveMattermostUsername(harnessId, identifier)
    }
    default:
      return null
  }
}
