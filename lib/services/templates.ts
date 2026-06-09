import path from 'path'
import { loadManifest, installArtifacts, type InstallResult } from './artifacts-manifest'

/**
 * Install baseline plugins, skills, and hooks into an agent's data directory,
 * driven by infra/artifacts.json. `local` entries are copied from
 * infra/templates; `git:<org>/<repo>#<tag>` entries are fetched at the pinned
 * tag and screened by the install-time trust gate (see installArtifacts).
 * Returns what was actually installed. Throws on unsupported sources or when the
 * trust gate refuses a fetched artifact.
 *
 * The git build-time token is read from the HSM *server* env
 * (`ARTIFACT_GIT_TOKEN`, falling back to `GITHUB_TOKEN`). This is deliberately
 * distinct from the per-agent runtime `GITHUB_TOKEN` written into an agent's
 * `.env`: the server fetches+screens artifacts at create time; the agent never
 * sees this credential.
 */
export async function installBaselineTemplates(agentDataDir: string): Promise<InstallResult[]> {
  const repoRoot = process.cwd()
  const manifest = loadManifest(path.join(repoRoot, 'infra', 'artifacts.json'))
  const gitToken = process.env.ARTIFACT_GIT_TOKEN || process.env.GITHUB_TOKEN || undefined
  return installArtifacts(agentDataDir, manifest, repoRoot, { gitToken })
}

/**
 * @deprecated Read the manifest (infra/artifacts.json) instead. Retained only for
 * callers that still reference the plugin name list; will be removed in Phase 2.
 */
export const TEMPLATE_PLUGINS = ['swarm_map_policy', 'boot_md', 'captcha_cascade']
