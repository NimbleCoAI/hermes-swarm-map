import fs from 'fs'
import path from 'path'
import { scanForThreats } from './threat-patterns'

export interface ArtifactFinding {
  file: string // path relative to the artifact dir
  ids: string[] // threat-pattern ids that matched
}

export interface GateResult {
  ok: boolean
  findings: ArtifactFinding[]
}

// Files larger than this are assumed to be data/binary blobs, not instructions,
// and are skipped to keep the scan fast and avoid false positives on minified
// assets.
const MAX_SCAN_BYTES = 1_000_000

function walk(dir: string, base: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === '.git') continue // never scan VCS metadata
      walk(path.join(dir, entry.name), base, out)
    } else if (entry.isFile()) {
      out.push(path.relative(base, path.join(dir, entry.name)))
    }
  }
}

/**
 * Scan every text file in a fetched git-sourced artifact directory for
 * prompt-injection / promptware patterns BEFORE it is installed into an agent
 * (the early trust gate; the image-side Python scanner is the runtime backstop).
 *
 * Binary files (containing a NUL byte) and oversized files are skipped. Returns
 * `ok: false` with per-file findings if anything trips, so the caller can refuse
 * the install (loud failure) rather than copying a poisoned artifact onto disk.
 */
export function gateArtifactDir(dir: string): GateResult {
  const rels: string[] = []
  walk(dir, dir, rels)

  const findings: ArtifactFinding[] = []
  for (const rel of rels) {
    const full = path.join(dir, rel)
    let buf: Buffer
    try {
      if (fs.statSync(full).size > MAX_SCAN_BYTES) continue
      buf = fs.readFileSync(full)
    } catch {
      continue
    }
    if (buf.includes(0)) continue // binary — skip

    const ids = scanForThreats(buf.toString('utf-8'), 'context')
    if (ids.length > 0) {
      findings.push({ file: rel.split(path.sep).join('/'), ids })
    }
  }

  return { ok: findings.length === 0, findings }
}
