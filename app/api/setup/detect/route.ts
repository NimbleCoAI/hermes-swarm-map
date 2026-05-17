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
  const found: Array<{ path: string; composeCount: number; agentCount: number }> = []

  // Scan common paths — only include dirs with compose files
  for (const p of COMMON_PATHS) {
    const expanded = expandPath(p)
    if (!fs.existsSync(expanded)) continue
    const composeCount = countComposeFiles(expanded)
    if (composeCount > 0) {
      // Count hermes services in compose files
      let agentCount = 0
      try {
        const files = fs.readdirSync(expanded).filter(f => f.startsWith('docker-compose') && f.endsWith('.yml'))
        for (const file of files) {
          const content = fs.readFileSync(path.join(expanded, file), 'utf-8')
          const matches = content.match(/^\s+(hermes-|seraph-)\w+:/gm)
          agentCount += matches?.length ?? 0
        }
      } catch {}
      found.push({ path: p, composeCount, agentCount })
    }
  }

  // Also scan ~/Documents/GitHub for any dir with docker-compose + hermes services
  const ghDir = path.join(os.homedir(), 'Documents', 'GitHub')
  try {
    const entries = fs.readdirSync(ghDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const fullPath = path.join(ghDir, entry.name)
      const tildePath = `~/Documents/GitHub/${entry.name}`
      if (found.some(f => expandPath(f.path) === fullPath)) continue
      const composeCount = countComposeFiles(fullPath)
      if (composeCount > 0) {
        // Only include if compose defines hermes-* or seraph-* services with gateway command
        let agentCount = 0
        try {
          const files = fs.readdirSync(fullPath).filter(f => f.startsWith('docker-compose') && f.endsWith('.yml'))
          for (const file of files) {
            const content = fs.readFileSync(path.join(fullPath, file), 'utf-8')
            // Match service definitions (indented service names ending with colon)
            const matches = content.match(/^\s{2}(hermes-|seraph-)\w+:/gm)
            agentCount += matches?.length ?? 0
          }
        } catch {}
        if (agentCount > 0) {
          found.push({ path: tildePath, composeCount, agentCount })
        }
      }
    }
  } catch {}

  return NextResponse.json({ paths: found })
}
