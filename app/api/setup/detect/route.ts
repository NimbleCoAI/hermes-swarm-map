import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

const COMMON_PATHS = [
  '~/.hermes',
  '~/.hermes-swarm',
  '~/Documents/GitHub/hermes-swarm',
  '~/Documents/GitHub/hermes',
]

function expandPath(p: string): string {
  return p.replace(/^~/, os.homedir())
}

function countComposeFiles(dir: string): number {
  try {
    const entries = fs.readdirSync(dir)
    return entries.filter((f) => f.startsWith('docker-compose') && f.endsWith('.yml')).length
  } catch {
    return 0
  }
}

function isHermesDir(dir: string): boolean {
  // A hermes dir has at least a .env or config.yaml or SOUL.md
  const markers = ['.env', 'config.yaml', 'SOUL.md']
  return markers.some((m) => fs.existsSync(path.join(dir, m)))
}

export async function GET() {
  const found: Array<{ path: string; composeCount: number }> = []

  // Scan common paths
  for (const p of COMMON_PATHS) {
    const expanded = expandPath(p)
    if (fs.existsSync(expanded) && isHermesDir(expanded)) {
      found.push({
        path: p,
        composeCount: countComposeFiles(expanded),
      })
    }
  }

  // Also scan home for .hermes-* directories
  const home = os.homedir()
  try {
    const entries = fs.readdirSync(home, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!entry.name.startsWith('.hermes')) continue
      const fullPath = path.join(home, entry.name)
      const tildePath = fullPath.replace(home, '~')
      if (found.some((f) => expandPath(f.path) === fullPath)) continue
      if (isHermesDir(fullPath)) {
        found.push({
          path: tildePath,
          composeCount: countComposeFiles(fullPath),
        })
      }
    }
  } catch {}

  return NextResponse.json({ paths: found })
}
