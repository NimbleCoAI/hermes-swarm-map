// lib/surfaces/derive.ts
//
// Derived views of the surface registry. Every per-platform var-name map that
// used to be hand-maintained in a route or service is now produced here, from
// SURFACES, so the maps cannot drift from each other. registry.test.ts pins each
// derived map against the literal it replaced (golden), so a registry edit that
// would change any consumer is visible in the diff.

import { SURFACES, SURFACE_SLUGS, type SurfaceSlug } from './registry'

// { platform: {P}_ALLOWED_USERS } — the user admission allowlist. Replaces
// ALLOWED_USERS_VARS (surface-admins), allowedUsersKey (connect), and
// PLATFORM_VARS[*].users (settings).
export const USERS_VARS: Record<string, string> = Object.fromEntries(
  SURFACE_SLUGS.map((p) => [p, SURFACES[p].admission.users]),
)

// { platform: group/channel allowlist }. Replaces GROUP_ALLOWED_VARS
// (surface-admins) and GROUP_VARS (policy).
export const GROUPS_VARS: Record<string, string> = Object.fromEntries(
  SURFACE_SLUGS.map((p) => [p, SURFACES[p].admission.groups]),
)

// { platform: {P}_REQUIRE_MENTION }. Replaces MENTION_GATING_VARS (settings) and
// MENTION_GATING_ENV_VARS (harness).
export const MENTION_GATING_VARS: Record<string, string> = Object.fromEntries(
  SURFACE_SLUGS.map((p) => [p, SURFACES[p].behavior.requireMention]),
)

// { platform: observe-unmentioned var } — only the surfaces that have one.
export const OBSERVE_UNMENTIONED_VARS: Record<string, string> = Object.fromEntries(
  SURFACE_SLUGS.flatMap((p) => {
    const v = SURFACES[p].behavior.observeUnmentioned
    return v ? [[p, v] as const] : []
  }),
)

// { platform: group-invite policy var } — only the surfaces that have one.
// Replaces GROUP_INVITE_VARS (settings) and GROUP_INVITE_POLICY_VARS
// (surface-admins), which carried a "must stay in step" comment because they
// were two copies of this fact.
export const GROUP_INVITE_POLICY_VARS: Record<string, string> = Object.fromEntries(
  SURFACE_SLUGS.flatMap((p) => {
    const v = SURFACES[p].behavior.groupInvitePolicy
    return v ? [[p, v] as const] : []
  }),
)

export type PlatformVarNames = {
  users: string
  groups: string
  roles?: string
  ignoredGroups?: string
  allowBots?: string
}

// The settings route's PLATFORM_VARS shape.
export const PLATFORM_VARS: Record<string, PlatformVarNames> = Object.fromEntries(
  SURFACE_SLUGS.map((p) => {
    const s = SURFACES[p]
    const entry: PlatformVarNames = { users: s.admission.users, groups: s.admission.groups }
    if (s.admission.roles) entry.roles = s.admission.roles
    if (s.admission.ignoredGroups) entry.ignoredGroups = s.admission.ignoredGroups
    if (s.behavior.allowBots) entry.allowBots = s.behavior.allowBots
    return [p, entry]
  }),
)

// env-helpers POLICY_VARS: [users, groups, requireMention] per platform — the
// three vars ensurePolicyDefaults seeds empty on connect.
export const POLICY_VARS: Record<string, string[]> = Object.fromEntries(
  SURFACE_SLUGS.map((p) => {
    const s = SURFACES[p]
    return [p, [s.admission.users, s.admission.groups, s.behavior.requireMention]]
  }),
)

// The disconnect/duplicate strip list: credentials + every admission var. NOT
// behavior vars — those are kept (see registry.ts). Single classification, so
// the disconnect route and the harness duplicate path can no longer disagree
// about, e.g., whether MATTERMOST_ADMIN_USERS survives a clone.
export function surfaceStripVars(platform: SurfaceSlug): string[] {
  const s = SURFACES[platform]
  return [
    ...s.credentials,
    ...([
      s.admission.users,
      s.admission.groups,
      s.admission.roles,
      s.admission.ignoredGroups,
      s.admission.adminUsers,
    ].filter(Boolean) as string[]),
  ]
}

export const PLATFORM_ENV_KEYS: Record<string, string[]> = Object.fromEntries(
  SURFACE_SLUGS.map((p) => [p, surfaceStripVars(p)]),
)

// Every env var the registry knows about, deduped — the universe a var must
// belong to (invariant: nothing written by a route is outside this set).
export const ALL_SURFACE_VARS: ReadonlySet<string> = new Set(
  SURFACE_SLUGS.flatMap((p) => {
    const s = SURFACES[p]
    return [
      ...s.credentials,
      ...Object.values(s.admission),
      ...Object.values(s.behavior),
    ].filter(Boolean) as string[]
  }),
)
