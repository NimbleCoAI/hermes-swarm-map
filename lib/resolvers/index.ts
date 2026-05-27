// lib/resolvers/index.ts

export type { ResolvedIdentity } from './signal'
export { resolveSignalPhone, getSignalAccountUuid } from './signal'
export { resolveTelegramUsername, getTelegramDisplayName } from './telegram'
export { resolveMattermostUsername } from './mattermost'

import { resolveSignalPhone } from './signal'
import { resolveTelegramUsername } from './telegram'
import { resolveMattermostUsername } from './mattermost'
import type { ResolvedIdentity } from './signal'

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
