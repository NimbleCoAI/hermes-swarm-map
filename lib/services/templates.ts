import path from 'path'
import { loadManifest, installArtifacts, type InstallResult } from './artifacts-manifest'

/**
 * Install baseline plugins, skills, and hooks into an agent's data directory,
 * driven by infra/artifacts.json. Phase 1: all entries are 'local' (copied from
 * infra/templates), so output is identical to the previous hardcoded-array copy.
 * Returns what was actually installed (replaces the old void return + the
 * pluginsInstalled = [...TEMPLATE_PLUGINS] lie). Throws on unsupported sources.
 */
export async function installBaselineTemplates(agentDataDir: string): Promise<InstallResult[]> {
  const repoRoot = process.cwd()
  const manifest = loadManifest(path.join(repoRoot, 'infra', 'artifacts.json'))
  return installArtifacts(agentDataDir, manifest, repoRoot)
}

/**
 * @deprecated Read the manifest (infra/artifacts.json) instead. Retained only for
 * callers that still reference the plugin name list; will be removed in Phase 2.
 */
export const TEMPLATE_PLUGINS = ['swarm_map_policy', 'boot_md', 'captcha_cascade']
