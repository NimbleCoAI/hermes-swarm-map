/**
 * One-time healing of legacy agent-image refs (stale-`:latest` incident,
 * 2026-08-06).
 *
 * The hermes-agent-mt repo was transferred NimbleCoAI → NimbleCoOrg around
 * 2026-07-21. GHCR packages do NOT follow repo transfers, so the old package
 * (`ghcr.io/nimblecoai/hermes-agent-mt`) froze at its last pre-transfer build
 * while every post-transfer CI publish landed — successfully — on the new
 * path (`ghcr.io/nimblecoorg/hermes-agent-mt`) that no existing install was
 * pulling. Result: fleets silently ran a 2026-07-21 image forever while CI
 * reported green.
 *
 * New installs are fine (seed.ts and all compose generation already default
 * to the nimblecoorg path). What this module heals is EXISTING installs,
 * which pin the dead path in two persisted places:
 *   1. `settings.json` → `defaultImage`
 *   2. each generated `<dataDir>/compose/<agent>/docker-compose.yml`
 *
 * Runs once per server start from instrumentation.ts. Idempotent, fail-open
 * per file: a migration failure must never take the server down. Running
 * containers keep the old image until their next recreate — this migration
 * only guarantees the next pull/recreate uses the live path.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { services } from '@/lib/services'
import { readComposeImage, setComposeImage } from './harness-compose'

/** Dead repo path → live repo path. Tag/digest suffixes are preserved. */
const LEGACY_IMAGE_REPOS: Record<string, string> = {
  'ghcr.io/nimblecoai/hermes-agent-mt': 'ghcr.io/nimblecoorg/hermes-agent-mt',
}

/**
 * Rewrite a legacy image ref to its live equivalent, preserving any `:tag`
 * or `@sha256:…` suffix. Returns the ref unchanged when it isn't legacy.
 * Only exact repo-path matches migrate — `nimblecoai/hermes-agent-mt-foo`
 * or a ref that merely contains the string as a substring is left alone.
 */
export function normalizeImageRef(ref: string): string {
  for (const [legacy, current] of Object.entries(LEGACY_IMAGE_REPOS)) {
    if (ref === legacy) return current
    if (ref.startsWith(legacy + ':') || ref.startsWith(legacy + '@')) {
      return current + ref.slice(legacy.length)
    }
  }
  return ref
}

export type ImageMigrationResult = {
  settingsChanged: boolean
  composeMigrated: string[]
  composeFailed: string[]
}

/**
 * Heal legacy image refs in persisted state. Called once at server start.
 * Never throws.
 */
export function migrateLegacyImageRefs(): ImageMigrationResult {
  const result: ImageMigrationResult = {
    settingsChanged: false,
    composeMigrated: [],
    composeFailed: [],
  }

  let dataDir = path.join(os.homedir(), '.hermes-swarm-map')
  try {
    const settings = services.config.getSettings()
    if (settings?.dataDir) dataDir = settings.dataDir.replace(/^~/, os.homedir())

    const current = settings?.defaultImage
    if (current) {
      const normalized = normalizeImageRef(current)
      if (normalized !== current) {
        services.config.updateSettings({ defaultImage: normalized })
        result.settingsChanged = true
        console.log(`[image-migration] settings.defaultImage: ${current} → ${normalized}`)
      }
    }
  } catch (err) {
    console.error('[image-migration] settings migration failed:', err)
  }

  const composeBaseDir = path.join(dataDir, 'compose')
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(composeBaseDir, { withFileTypes: true })
  } catch {
    return result // fresh install, no compose dir yet
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const composePath = path.join(composeBaseDir, entry.name, 'docker-compose.yml')
    try {
      if (!fs.existsSync(composePath)) continue
      const content = fs.readFileSync(composePath, 'utf-8')
      const image = readComposeImage(content)
      if (!image) continue // local-build compose — nothing to migrate
      const normalized = normalizeImageRef(image)
      if (normalized === image) continue
      fs.writeFileSync(composePath, setComposeImage(content, normalized), 'utf-8')
      result.composeMigrated.push(composePath)
      console.log(`[image-migration] ${composePath}: ${image} → ${normalized}`)
    } catch (err) {
      result.composeFailed.push(composePath)
      console.error(`[image-migration] failed to migrate ${composePath}:`, err)
    }
  }

  if (result.composeMigrated.length) {
    console.log(
      `[image-migration] migrated ${result.composeMigrated.length} compose file(s) off the dead ` +
      'ghcr.io/nimblecoai path — agents pick up the live image on their next recreate',
    )
  }
  return result
}
