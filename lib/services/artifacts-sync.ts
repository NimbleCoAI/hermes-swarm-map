import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import {
  ArtifactsManifest,
  ArtifactType,
  ArtifactEntry,
  enabledPluginNames,
} from './artifacts-manifest'

// Issue #82: installBaselineTemplates runs only at agent create/duplicate, so
// existing agents never receive new artifacts added to infra/artifacts.json.
// This module syncs an already-created agent's data dir against the manifest
// WITHOUT clobbering anything the user added or modified.
//
// Safety model (two layers):
//   1. Additive floor — always safe, needs no history: install artifacts that
//      are MISSING from the data dir. Never touch an artifact that exists.
//      This alone solves the driving case (#81: agents missing a plugin gain it).
//   2. Pristine-update — only when we have proof an artifact is unmodified: an
//      `.artifacts-lock.json` written at install time records the shipped
//      content hash. At sync, an existing artifact is updated to the new shipped
//      version ONLY if its on-disk hash still matches the lock (pristine). If it
//      differs (user-modified) or isn't in the lock (untracked / user-added), it
//      is SKIPPED. `force` overrides this to overwrite anyway.

export const LOCK_FILE = '.artifacts-lock.json'

export type SyncAction = 'install' | 'update' | 'skip'

export interface SyncPlanItem {
  type: ArtifactType
  name: string
  action: SyncAction
  // install: 'missing'; update: 'pristine' | 'forced'; skip: 'user-modified' | 'untracked' | 'source-missing'
  reason: string
}

export interface SyncPlan {
  items: SyncPlanItem[]
  /** enabled:true plugins that will be install/update'd — candidates for config.yaml plugins.enabled */
  enablePlugins: string[]
}

interface LockEntry {
  type: ArtifactType
  name: string
  hash: string
}
interface LockFile {
  version: number
  artifacts: LockEntry[]
}

const TYPES: ArtifactType[] = ['plugins', 'skills', 'hooks']

function srcDirFor(repoRoot: string, type: ArtifactType, name: string): string {
  return path.join(repoRoot, 'infra', 'templates', type, name)
}
function destDirFor(agentDataDir: string, type: ArtifactType, name: string): string {
  return path.join(agentDataDir, type, name)
}

/**
 * Deterministic content hash of an artifact directory tree: sorted relative
 * paths + file bytes. Returns null if the dir is missing. Symlinks are hashed
 * by their target string (not followed) so they can't smuggle content in.
 */
export function hashArtifactTree(dir: string): string | null {
  if (!fs.existsSync(dir)) return null
  const h = crypto.createHash('sha256')
  const walk = (rel: string) => {
    const abs = path.join(dir, rel)
    const st = fs.lstatSync(abs)
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(abs).sort()) {
        walk(path.join(rel, name))
      }
    } else if (st.isSymbolicLink()) {
      h.update(`L:${rel}:${fs.readlinkSync(abs)}\n`)
    } else {
      h.update(`F:${rel}:`)
      h.update(fs.readFileSync(abs))
      h.update('\n')
    }
  }
  walk('')
  return h.digest('hex')
}

export function readLock(agentDataDir: string): LockFile | null {
  const p = path.join(agentDataDir, LOCK_FILE)
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'))
    if (parsed && Array.isArray(parsed.artifacts)) return parsed as LockFile
  } catch {
    /* missing or malformed → treated as no lock (additive-only) */
  }
  return null
}

function lockHashFor(lock: LockFile | null, type: ArtifactType, name: string): string | null {
  if (!lock) return null
  const e = lock.artifacts.find((a) => a.type === type && a.name === name)
  return e ? e.hash : null
}

/**
 * Decide what sync would do — pure, no writes. Inspects the data dir + lock and
 * the shipped templates. Use dryRun at the call site to surface this to a human.
 */
export function planArtifactSync(
  agentDataDir: string,
  manifest: ArtifactsManifest,
  repoRoot: string,
  opts: { force?: boolean } = {},
): SyncPlan {
  const lock = readLock(agentDataDir)
  const items: SyncPlanItem[] = []
  const enablePlugins: string[] = []
  const enabledNames = new Set(enabledPluginNames(manifest))

  for (const type of TYPES) {
    for (const entry of manifest[type] as ArtifactEntry[]) {
      const dest = destDirFor(agentDataDir, type, entry.name)
      const src = srcDirFor(repoRoot, type, entry.name)
      let item: SyncPlanItem

      if (entry.source !== 'local') {
        item = { type, name: entry.name, action: 'skip', reason: `unsupported-source:${entry.source}` }
      } else if (!fs.existsSync(src)) {
        item = { type, name: entry.name, action: 'skip', reason: 'source-missing' }
      } else if (!fs.existsSync(dest)) {
        item = { type, name: entry.name, action: 'install', reason: 'missing' }
      } else if (opts.force) {
        item = { type, name: entry.name, action: 'update', reason: 'forced' }
      } else {
        const locked = lockHashFor(lock, type, entry.name)
        if (locked === null) {
          item = { type, name: entry.name, action: 'skip', reason: 'untracked' }
        } else if (hashArtifactTree(dest) === locked) {
          item = { type, name: entry.name, action: 'update', reason: 'pristine' }
        } else {
          item = { type, name: entry.name, action: 'skip', reason: 'user-modified' }
        }
      }

      items.push(item)
      if ((item.action === 'install' || item.action === 'update') && type === 'plugins' && enabledNames.has(entry.name)) {
        enablePlugins.push(entry.name)
      }
    }
  }
  return { items, enablePlugins }
}

export interface SyncResult extends SyncPlanItem {
  applied: boolean
  error?: string
}

function rmrf(p: string) {
  fs.rmSync(p, { recursive: true, force: true })
}
function copyTree(src: string, dest: string) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.cpSync(src, dest, { recursive: true })
}

/**
 * Apply a plan: copy install/update artifacts from the shipped templates and
 * rewrite the lock so every manifest artifact now present on disk records its
 * current shipped hash (future syncs can then pristine-update it). Skips are
 * left entirely untouched. Returns per-artifact outcomes.
 */
export function applyArtifactSync(
  agentDataDir: string,
  plan: SyncPlan,
  repoRoot: string,
): SyncResult[] {
  const results: SyncResult[] = []
  for (const item of plan.items) {
    if (item.action === 'skip') {
      results.push({ ...item, applied: false })
      continue
    }
    const src = srcDirFor(repoRoot, item.type, item.name)
    const dest = destDirFor(agentDataDir, item.type, item.name)
    try {
      if (item.action === 'update') rmrf(dest) // pristine/forced → safe to replace wholesale
      copyTree(src, dest)
      results.push({ ...item, applied: true })
    } catch (e) {
      results.push({ ...item, applied: false, error: (e as Error).message })
    }
  }
  writeLockForApplied(agentDataDir, results)
  return results
}

/**
 * Record/refresh the lock ONLY for artifacts whose copy actually succeeded,
 * preserving prior lock entries for artifacts we didn't touch. The recorded
 * hash is read from the ON-DISK dest after copy (not the shipped src) so a
 * partial/failed write can never be locked as a clean shipped hash — which
 * would otherwise strand the artifact as permanently "user-modified".
 */
function writeLockForApplied(agentDataDir: string, results: SyncResult[]) {
  const existing = readLock(agentDataDir)
  const byKey = new Map<string, LockEntry>()
  if (existing) for (const e of existing.artifacts) byKey.set(`${e.type}/${e.name}`, e)
  for (const r of results) {
    if (!r.applied) continue
    const onDisk = hashArtifactTree(destDirFor(agentDataDir, r.type, r.name))
    if (onDisk) byKey.set(`${r.type}/${r.name}`, { type: r.type, name: r.name, hash: onDisk })
  }
  const lock: LockFile = { version: 1, artifacts: Array.from(byKey.values()) }
  fs.writeFileSync(path.join(agentDataDir, LOCK_FILE), JSON.stringify(lock, null, 2))
}

/**
 * Ensure config.yaml's `plugins.enabled` list contains `names`, preserving the
 * rest of the file. Text-based (HSM writes config.yaml as a string, no YAML
 * dep). Returns the new content + which names were added (idempotent).
 *
 * Safety: only two shapes are edited — (a) an existing block-style
 * `plugins:` → `enabled:` list (items appended at its real indentation), or
 * (b) NO `plugins:` key at all (a fresh block is appended). Any other shape
 * (a `plugins:` block with an inline `enabled: [...]`, or with no recognizable
 * block-style `enabled:` child) is left UNTOUCHED and reported as added: [] —
 * bailing beats risking a duplicate key or a mis-nested list in a hand-edited
 * config.
 */
export function ensurePluginsEnabled(
  configYaml: string,
  names: string[],
): { content: string; added: string[] } {
  if (names.length === 0) return { content: configYaml, added: [] }
  const lines = configYaml.split('\n')

  let pluginsIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^plugins:\s*$/.test(lines[i])) { pluginsIdx = i; break }
  }

  // (b) No plugins key anywhere → safe to append a fresh, well-formed block.
  if (pluginsIdx < 0) {
    // Bail if there's a `plugins:` with inline content (e.g. `plugins: {...}`)
    // we didn't recognize above — don't risk a duplicate key.
    if (lines.some((l) => /^plugins:\s*\S/.test(l))) return { content: configYaml, added: [] }
    const fresh = ['', '# --- Plugins (added by Swarm Map artifacts sync) ---', 'plugins:', '  enabled:', ...names.map((n) => `    - ${n}`), '']
    const base = configYaml.endsWith('\n') ? configYaml.slice(0, -1) : configYaml
    return { content: [base, ...fresh].join('\n'), added: [...names] }
  }

  // (a) Scan the plugins block for a BLOCK-STYLE `enabled:` child.
  let enabledIdx = -1
  let enabledIndent = ''
  let itemIndent = ''
  const already = new Set<string>()
  for (let i = pluginsIdx + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break // dedented out of the plugins block
    const blockEnabled = lines[i].match(/^(\s+)enabled:\s*$/)
    if (blockEnabled) { enabledIdx = i; enabledIndent = blockEnabled[1]; continue }
    // An inline `enabled: [..]` or `enabled: x` is a shape we won't edit.
    if (enabledIdx < 0 && /^\s+enabled:\s*\S/.test(lines[i])) return { content: configYaml, added: [] }
    if (enabledIdx >= 0) {
      const item = lines[i].match(/^(\s+)-\s+(\S+)\s*$/)
      if (item) { already.add(item[2]); if (!itemIndent) itemIndent = item[1] }
      else if (/^\s*\S/.test(lines[i]) && !/^\s+#/.test(lines[i])) break // next key in block
    }
  }

  // plugins: block with no usable block-style enabled: → bail (don't duplicate).
  if (enabledIdx < 0) return { content: configYaml, added: [] }

  const toAdd = names.filter((n) => !already.has(n))
  if (toAdd.length === 0) return { content: configYaml, added: [] }

  const indent = itemIndent || enabledIndent + '  '
  let insertAt = enabledIdx + 1
  for (; insertAt < lines.length; insertAt++) {
    if (!/^\s+-\s+\S+/.test(lines[insertAt])) break
  }
  lines.splice(insertAt, 0, ...toAdd.map((n) => `${indent}- ${n}`))
  return { content: lines.join('\n'), added: toAdd }
}
