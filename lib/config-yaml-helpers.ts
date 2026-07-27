/**
 * Surgical edits to an agent's config.yaml.
 *
 * The hermes gateway only starts a chat platform when config.yaml has
 * `platforms: <platform>: enabled: true` (gateway/run.py skips any platform
 * whose config is missing or has enabled: false). Connect/disconnect must
 * therefore manage that flag — writing tokens into .env alone silently does
 * nothing.
 *
 * config.yaml is large (~500 lines) and hand-maintained with comments, so we
 * NEVER round-trip it through a YAML parser (that would destroy comments and
 * formatting). Like the .env helpers in lib/env-helpers.ts, we do line-level
 * edits — and we only ever splice validated, allowlisted platform slugs into
 * the file (see SURFACE_PLATFORMS), so no user-controlled bytes reach it.
 *
 * IMPORTANT: real configs can contain multiple `platforms:`-like keys — e.g.
 * an INDENTED `  platforms:` nested under another section, and the col-0
 * `platform_toolsets:` key. The real gateway key is the TOP-LEVEL (column-0)
 * `platforms:` mapping, so everything here anchors to column 0 with an exact
 * `platforms:` match.
 */

/** Chat surface slugs the gateway knows about. The ONLY values ever spliced
 *  into config.yaml — reject everything else before touching the file. */
export const SURFACE_PLATFORMS = [
  'signal',
  'telegram',
  'mattermost',
  'discord',
  'slack',
] as const

export type SurfacePlatform = (typeof SURFACE_PLATFORMS)[number]

export function isSurfacePlatform(platform: string): platform is SurfacePlatform {
  return (SURFACE_PLATFORMS as readonly string[]).includes(platform)
}

/** Matches the top-level (column-0) `platforms:` key — NOT an indented
 *  `  platforms:` nested elsewhere, and NOT `platform_toolsets:`. */
const TOP_LEVEL_PLATFORMS_RE = /^platforms:[ \t]*(#.*)?$/

/**
 * Set `platforms.<platform>.enabled` in config.yaml content, preserving every
 * other line (comments, formatting, sibling keys under the platform entry).
 *
 * Cases handled:
 * - platform entry exists with an `enabled:` line → value rewritten in place
 * - platform entry exists without `enabled:` → line inserted as first child
 * - `platforms:` block exists but entry missing → entry appended to the block
 *   (only when enabling; a missing entry is already disabled)
 * - no top-level `platforms:` block → block appended at end of file (enabling
 *   only)
 *
 * Throws on unknown platform slugs — callers must not pass user input through.
 */
export function setPlatformEnabled(
  content: string,
  platform: string,
  enabled: boolean
): string {
  if (!isSurfacePlatform(platform)) {
    throw new Error(`Unknown platform: ${platform}`)
  }

  const lines = content.split('\n')

  // ── Locate the top-level platforms: block ────────────────────────────────
  let blockStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (TOP_LEVEL_PLATFORMS_RE.test(lines[i])) {
      blockStart = i
      break
    }
  }

  if (blockStart === -1) {
    // No block at all. Absence means disabled, so disabling is a no-op.
    if (!enabled) return content
    const block =
      `\n# --- Platforms (chat surfaces the gateway starts) ---\n` +
      `platforms:\n  ${platform}:\n    enabled: true\n`
    return content.replace(/\n*$/, '\n') + block
  }

  // Block spans from blockStart+1 until the next column-0 content line.
  // Track the last indented content line so a new entry is appended before
  // any trailing blank/comment gap.
  let blockEnd = lines.length // exclusive
  let lastContentIdx = blockStart
  let childIndent = '  '
  let childIndentSeen = false
  for (let i = blockStart + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    if (/^\S/.test(line)) {
      blockEnd = i
      break
    }
    if (/^\s*#/.test(line)) continue
    lastContentIdx = i
    if (!childIndentSeen) {
      childIndent = line.match(/^(\s+)/)![1]
      childIndentSeen = true
    }
  }

  // ── Locate the platform entry inside the block ───────────────────────────
  const entryRe = new RegExp(`^(\\s+)${platform}:[ \\t]*(#.*)?$`)
  let entryIdx = -1
  let entryIndent = ''
  for (let i = blockStart + 1; i < blockEnd; i++) {
    const m = lines[i].match(entryRe)
    // Direct children only — a deeper `discord:` under some sub-map is not
    // the platform entry.
    if (m && m[1] === childIndent) {
      entryIdx = i
      entryIndent = m[1]
      break
    }
  }

  if (entryIdx === -1) {
    // Entry missing. Missing == disabled, so disabling is a no-op.
    if (!enabled) return content
    const insertion = [`${childIndent}${platform}:`, `${childIndent}  enabled: true`]
    lines.splice(lastContentIdx + 1, 0, ...insertion)
    return lines.join('\n')
  }

  // ── Entry exists: find its `enabled:` line among its own children ────────
  let entryEnd = blockEnd // exclusive
  for (let i = entryIdx + 1; i < blockEnd; i++) {
    const line = lines[i]
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    const indent = line.match(/^(\s*)/)![1]
    if (indent.length <= entryIndent.length) {
      entryEnd = i
      break
    }
  }

  for (let i = entryIdx + 1; i < entryEnd; i++) {
    const m = lines[i].match(/^(\s+)enabled:([ \t]*)(?:[^#\s][^#]*?)?[ \t]*(#.*)?$/)
    if (m && m[1].length > entryIndent.length) {
      const comment = m[3] ? `  ${m[3]}` : ''
      lines[i] = `${m[1]}enabled: ${enabled}${comment}`
      return lines.join('\n')
    }
  }

  // Entry exists but has no enabled: line — insert as its first child.
  lines.splice(entryIdx + 1, 0, `${entryIndent}  enabled: ${enabled}`)
  return lines.join('\n')
}
