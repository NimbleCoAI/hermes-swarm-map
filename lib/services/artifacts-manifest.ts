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
