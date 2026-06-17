import fs from 'fs'
import path from 'path'
import { scanForThreats, type ThreatScope } from './threat-patterns'

export interface ArtifactFinding {
  file: string // path relative to the artifact dir
  ids: string[] // threat-pattern ids that matched
}

export interface GateResult {
  ok: boolean
  findings: ArtifactFinding[]
}

// Files larger than this can't be reliably scanned as instructions; rather than
// skipping them (which let a >1MB poisoned file pass clean — audit FIX 2) we
// REFUSE them with an 'oversized' finding. Kept a named const for visibility.
const MAX_SCAN_BYTES = 1_000_000

interface WalkEntry {
  rel: string
  symlink: boolean // audit FIX 1: refuse symlinks, never follow them
}

function walk(dir: string, base: string, out: WalkEntry[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(base, path.join(dir, entry.name))
    // FIX 1 (audit): a symlink is neither isFile() nor isDirectory(), so the old
    // walk silently skipped it — but the installer's `cp` copies symlinks
    // verbatim (e.g. SKILL.md -> /etc/passwd). Record it and DO NOT follow.
    if (entry.isSymbolicLink()) {
      out.push({ rel, symlink: true })
    } else if (entry.isDirectory()) {
      if (entry.name === '.git') continue // never scan VCS metadata
      walk(path.join(dir, entry.name), base, out)
    } else if (entry.isFile()) {
      out.push({ rel, symlink: false })
    }
  }
}

/**
 * Scan every text file in a fetched git-sourced artifact directory for
 * prompt-injection / promptware patterns BEFORE it is installed into an agent
 * (the early trust gate; the image-side Python scanner is the runtime backstop).
 *
 * Symlinks and oversized files are REFUSED (not skipped); a NUL byte no longer
 * blanks the scan (audit fixes). Returns `ok: false` with per-file findings if
 * anything trips, so the caller can refuse the install (loud failure) rather
 * than copying a poisoned artifact onto disk.
 *
 * `scope` selects the threat-pattern set: 'context' (default) for general
 * artifacts; 'strict' for highest-trust content the agent obeys as instructions
 * — SOUL (identity prompt) and use-case skill installs — which additionally
 * screens exfil / persistence / config-mod / hardcoded-secret patterns.
 */
export function gateArtifactDir(dir: string, scope: ThreatScope = 'context'): GateResult {
  const entries: WalkEntry[] = []
  walk(dir, dir, entries)

  const findings: ArtifactFinding[] = []
  for (const { rel, symlink } of entries) {
    const norm = rel.split(path.sep).join('/')

    // FIX 1 (audit): refuse symlinks outright — never stat/read the target.
    if (symlink) {
      findings.push({ file: norm, ids: ['symlink'] })
      continue
    }

    const full = path.join(dir, rel)
    let buf: Buffer
    try {
      // FIX 2 (audit): an oversized file can't be reliably scanned; refuse it
      // (it used to be silently skipped, passing a >1MB poisoned file clean).
      if (fs.statSync(full).size > MAX_SCAN_BYTES) {
        findings.push({ file: norm, ids: ['oversized'] })
        continue
      }
      buf = fs.readFileSync(full)
    } catch {
      continue
    }

    // FIX 3 (audit): do NOT skip on a NUL byte (which used to mark a file
    // "binary" and blank the scan, so `\0` + injection passed clean). Strip NUL
    // bytes so any payload after one is still matched. Genuine large binaries
    // are caught by the oversized check above.
    const ids = scanForThreats(buf.toString('utf-8').replace(/\0/g, ''), scope)
    if (ids.length > 0) {
      findings.push({ file: norm, ids })
    }
  }

  return { ok: findings.length === 0, findings }
}
