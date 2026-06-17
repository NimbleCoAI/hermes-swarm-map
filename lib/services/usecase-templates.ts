/**
 * Use-case templates: opinionated, public "packages" a user can opt into when
 * creating an agent (e.g. Matilde, the science assistant). A template declares
 * recommended model/platform config plus a set of git-sourced artifacts
 * (plugins/skills/hooks) and an optional SOUL overlay.
 *
 * Everything fetched from a template repo goes through the SAME security path as
 * baseline artifacts: pinned git source -> fetch -> trust gate (injection scan)
 * -> copy. Nothing is executed (no setup scripts) — copy + gate only.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { cp } from 'fs/promises'
import {
  installArtifacts,
  parseGitSource,
  type ArtifactsManifest,
  type ArtifactType,
  type InstallResult,
  type GitSource,
} from './artifacts-manifest'
import { fetchGitArtifact } from './git-fetch'
import { gateArtifactDir } from './artifact-gate'

export interface UseCaseArtifact {
  type: ArtifactType
  name: string
  /** git:<org>/<repo>#<tag>[:<subdir>] — pinned + trust-gated like any artifact. */
  source: string
  /** plugins only: enable in config.yaml plugins.enabled. */
  enabled?: boolean
}

export interface UseCaseRecommends {
  provider?: string
  primaryModel?: string
  fallbackModel?: string
  platforms?: string[]
  browser?: boolean
}

export interface UseCaseSoul {
  /** git source whose (sub)dir contains the SOUL file. */
  source: string
  /** file within the fetched dir to seed as the agent's SOUL.md. */
  file: string
}

export interface UseCaseTemplate {
  id: string
  name: string
  description: string
  recommends?: UseCaseRecommends
  artifacts: UseCaseArtifact[]
  soul?: UseCaseSoul
}

export interface InstallTemplateOpts {
  gitToken?: string
  cacheRoot?: string
  /** Inject a fetcher for tests; defaults to the real trust-gated git fetch. */
  gitFetch?: (src: GitSource) => string
}

export function loadUseCaseTemplates(repoRoot: string = process.cwd()): UseCaseTemplate[] {
  const p = path.join(repoRoot, 'infra', 'usecase-templates.json')
  let raw: string
  try {
    raw = fs.readFileSync(p, 'utf-8')
  } catch {
    return [] // registry is optional — no templates is a valid state
  }
  let parsed: { templates?: UseCaseTemplate[] }
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`Invalid usecase-templates.json: ${(e as Error).message}`)
  }
  return Array.isArray(parsed.templates) ? parsed.templates : []
}

export function getUseCaseTemplate(id: string, repoRoot: string = process.cwd()): UseCaseTemplate | undefined {
  return loadUseCaseTemplates(repoRoot).find((t) => t.id === id)
}

/** Plugin names a template marks enabled — merged into config.yaml plugins.enabled. */
export function templateEnabledPlugins(template: UseCaseTemplate): string[] {
  return template.artifacts.filter((a) => a.type === 'plugins' && a.enabled === true).map((a) => a.name)
}

/**
 * Install a use-case template's artifacts into an agent's data dir, then seed its
 * SOUL (if any). Artifacts are installed via the shared, trust-gated
 * installArtifacts. The SOUL file is gated the same way (scanned in isolation)
 * before it overwrites the agent's SOUL.md.
 */
export async function installUseCaseTemplate(
  agentDataDir: string,
  template: UseCaseTemplate,
  opts: InstallTemplateOpts = {},
): Promise<InstallResult[]> {
  const gitToken = opts.gitToken ?? process.env.ARTIFACT_GIT_TOKEN ?? process.env.GITHUB_TOKEN ?? undefined
  const cacheRoot = opts.cacheRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), 'hsm-usecase-cache-'))
  const gitFetch =
    opts.gitFetch ?? ((src: GitSource): string => fetchGitArtifact(src, { token: gitToken, cacheRoot }))

  const manifest: ArtifactsManifest = { plugins: [], skills: [], hooks: [] }
  for (const a of template.artifacts) {
    manifest[a.type].push({ name: a.name, source: a.source, enabled: a.enabled })
  }
  const results = await installArtifacts(agentDataDir, manifest, process.cwd(), { gitToken, cacheRoot, gitFetch })

  if (template.soul) {
    await seedSoulFromGit(agentDataDir, template.soul, gitFetch, cacheRoot)
  }
  return results
}

/**
 * Fetch a single SOUL file from a git source, run it through the trust gate in
 * isolation (so sibling files like setup scripts don't taint the scan and a
 * poisoned SOUL is refused), then write it as the agent's SOUL.md.
 */
async function seedSoulFromGit(
  agentDataDir: string,
  soul: UseCaseSoul,
  gitFetch: (src: GitSource) => string,
  cacheRoot: string,
): Promise<void> {
  const src = parseGitSource(soul.source)
  if (!src) throw new Error(`Use-case template SOUL source must be a pinned git source: "${soul.source}"`)
  // Guard against path traversal in the declared file name.
  if (soul.file.includes('..') || path.isAbsolute(soul.file)) {
    throw new Error(`Invalid SOUL file path "${soul.file}"`)
  }
  const fetchedDir = gitFetch(src)
  const soulSrc = path.join(fetchedDir, soul.file)
  if (!fs.existsSync(soulSrc)) {
    throw new Error(`SOUL file "${soul.file}" not found in ${soul.source}`)
  }

  // Gate the SOUL file in isolation: copy just it into a scratch dir and scan.
  const scratch = fs.mkdtempSync(path.join(cacheRoot, 'soul-gate-'))
  await cp(soulSrc, path.join(scratch, 'SOUL.md'))
  const gate = gateArtifactDir(scratch)
  if (!gate.ok) {
    const summary = gate.findings.map((f) => `${f.file} [${f.ids.join(',')}]`).join('; ')
    throw new Error(`Refused SOUL from ${soul.source}: failed the injection scan (${summary}).`)
  }
  await cp(path.join(scratch, 'SOUL.md'), path.join(agentDataDir, 'SOUL.md'))
}
