import fs from 'fs'
import { cp } from 'fs/promises'
import path from 'path'

export type ArtifactType = 'plugins' | 'skills' | 'hooks'

export interface ArtifactEntry {
  name: string
  // Phase 1: only 'local' is supported. Future: 'upstream', 'git:<org>/<repo>#<tag>'.
  source: string
  // plugins only: write into config.yaml plugins.enabled so the runtime loads this standalone plugin
  enabled?: boolean
}

export interface ArtifactsManifest {
  plugins: ArtifactEntry[]
  skills: ArtifactEntry[]
  hooks: ArtifactEntry[]
}

export interface GitSource {
  org: string
  repo: string
  ref: string
  subdir?: string
}

// org / repo names and refs are charset-validated because the parsed values
// later feed a git command — a stray shell metacharacter or path traversal
// must be rejected loudly, never silently passed through.
const GIT_NAME_RE = /^[A-Za-z0-9._-]+$/ // <org> and <repo>
const GIT_REF_RE = /^[A-Za-z0-9._/-]+$/ // <tag> (tags may contain '/')
const GIT_SUBDIR_RE = /^[A-Za-z0-9._/-]+$/

/**
 * Parse a `git:<org>/<repo>#<tag>[:<subdir>]` artifact source.
 *
 * Security front door for git-sourced (third-party / cross-trust-boundary)
 * artifacts:
 * - returns `null` for non-git sources (`local`, `upstream`, …) so the caller
 *   routes them through the existing local path;
 * - throws (loud failure) on any `git:`-prefixed source that is **unpinned**
 *   (pinning to a tag is mandatory — an unpinned ref can silently drift to
 *   malicious code), malformed, or contains unsafe characters / path traversal.
 */
export function parseGitSource(source: string): GitSource | null {
  if (!source.startsWith('git:')) return null
  const rest = source.slice('git:'.length)

  const hashIdx = rest.indexOf('#')
  if (hashIdx === -1) {
    throw new Error(`git source must be pinned: "${source}" is missing "#<tag>"`)
  }
  const repoPart = rest.slice(0, hashIdx) // <org>/<repo>
  let refPart = rest.slice(hashIdx + 1) // <tag>[:<subdir>]

  let subdir: string | undefined
  const colonIdx = refPart.indexOf(':')
  if (colonIdx !== -1) {
    subdir = refPart.slice(colonIdx + 1)
    refPart = refPart.slice(0, colonIdx)
  }

  const segs = repoPart.split('/')
  if (segs.length !== 2 || !segs[0] || !segs[1]) {
    throw new Error(`malformed git source "${source}": expected git:<org>/<repo>#<tag>`)
  }
  const [org, repo] = segs
  if (!GIT_NAME_RE.test(org) || !GIT_NAME_RE.test(repo)) {
    throw new Error(`invalid org/repo in git source "${source}" (unsafe characters)`)
  }
  if (!refPart) {
    throw new Error(`git source must be pinned: "${source}" has an empty ref`)
  }
  if (!GIT_REF_RE.test(refPart)) {
    throw new Error(`invalid ref in git source "${source}" (unsafe characters)`)
  }
  if (subdir !== undefined) {
    if (!subdir || !GIT_SUBDIR_RE.test(subdir) || subdir.split('/').includes('..')) {
      throw new Error(`invalid subdir in git source "${source}" (traversal or unsafe characters)`)
    }
  }

  const parsed: GitSource = { org, repo, ref: refPart }
  if (subdir !== undefined) parsed.subdir = subdir
  return parsed
}

export function loadManifest(manifestPath: string): ArtifactsManifest {
  let raw: string
  try {
    raw = fs.readFileSync(manifestPath, 'utf-8')
  } catch {
    throw new Error(`Artifacts manifest not found at ${manifestPath}`)
  }
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`Invalid artifacts manifest at ${manifestPath}: ${(e as Error).message}`)
  }
  return {
    plugins: Array.isArray(parsed.plugins) ? parsed.plugins : [],
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    hooks: Array.isArray(parsed.hooks) ? parsed.hooks : [],
  }
}

export interface InstallResult {
  type: ArtifactType
  name: string
  installed: boolean
  // true when the artifact was already present and left untouched (import-safe).
  skipped?: boolean
  error?: string
}

// Phase 1 supports only the 'local' source: copy infra/templates/<type>/<name>
// into <agentDataDir>/<type>/<name>. Unsupported source schemes throw (loud
// failure) rather than silently producing a capability-less agent.
export async function installArtifacts(
  agentDataDir: string,
  manifest: ArtifactsManifest,
  repoRoot: string,
): Promise<InstallResult[]> {
  const results: InstallResult[] = []
  const types: ArtifactType[] = ['plugins', 'skills', 'hooks']
  for (const type of types) {
    for (const entry of manifest[type]) {
      if (entry.source !== 'local') {
        throw new Error(
          `Unsupported artifact source "${entry.source}" for ${type}/${entry.name} (Phase 1 supports 'local' only)`,
        )
      }
      const srcDir = path.join(repoRoot, 'infra', 'templates', type, entry.name)
      const destDir = path.join(agentDataDir, type, entry.name)
      // Never clobber an agent's existing (possibly customized) artifact — e.g.
      // when importing an already-provisioned agent. Seed baseline only when the
      // artifact is absent; the agent owns its own copy thereafter.
      if (fs.existsSync(destDir)) {
        results.push({ type, name: entry.name, installed: true, skipped: true })
        continue
      }
      try {
        await cp(srcDir, destDir, { recursive: true })
        results.push({ type, name: entry.name, installed: true })
      } catch (e) {
        results.push({ type, name: entry.name, installed: false, error: `source not found: ${(e as Error).message}` })
      }
    }
  }
  return results
}

/** Plugin names the manifest marks enabled (written to config.yaml plugins.enabled). */
export function enabledPluginNames(manifest: ArtifactsManifest): string[] {
  return manifest.plugins.filter((p) => p.enabled === true).map((p) => p.name)
}

/** Convenience: enabled plugin names from the repo's infra/artifacts.json. */
export function defaultEnabledPlugins(repoRoot: string = process.cwd()): string[] {
  const manifest = loadManifest(path.join(repoRoot, 'infra', 'artifacts.json'))
  return enabledPluginNames(manifest)
}
