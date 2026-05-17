import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

const COMMON_PATHS = [
  '~/Documents/GitHub/hermes-swarm',
  '~/Documents/GitHub/hermes-agent',
  '~/hermes-swarm',
  '~/hermes-agent',
]

// The real indicator: compose files that use the Hermes agent image
const HERMES_IMAGE_PATTERNS = [
  'nousresearch/hermes-agent',
  'ghcr.io/nousresearch/hermes-agent',
  'hermes-agent:',
]

function expandPath(p: string): string {
  return p.replace(/^~/, os.homedir())
}

function getComposeFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => f.startsWith('docker-compose') && f.endsWith('.yml'))
  } catch {
    return []
  }
}

function hasHermesImage(content: string): boolean {
  return HERMES_IMAGE_PATTERNS.some(pattern => content.includes(pattern))
}

function countServices(content: string): number {
  // Count top-level service definitions (2-space indented names ending with colon under 'services:')
  const serviceSection = content.split(/^services:\s*$/m)[1]
  if (!serviceSection) return 0
  const matches = serviceSection.match(/^\s{2}\w[\w-]*:/gm)
  return matches?.length ?? 0
}

function scanDirForHermes(dir: string, displayPath: string): { path: string; composeCount: number; agentCount: number } | null {
  const files = getComposeFiles(dir)
  if (files.length === 0) return null

  let totalAgents = 0
  let hermesFiles = 0

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8')
      if (hasHermesImage(content)) {
        hermesFiles++
        totalAgents += countServices(content)
      }
    } catch {}
  }

  if (hermesFiles === 0) return null
  return { path: displayPath, composeCount: hermesFiles, agentCount: totalAgents }
}

export async function GET() {
  const found: Array<{ path: string; composeCount: number; agentCount: number }> = []

  // Scan common paths — only include dirs with compose files that use Hermes image
  for (const p of COMMON_PATHS) {
    const expanded = expandPath(p)
    if (!fs.existsSync(expanded)) continue
    const result = scanDirForHermes(expanded, p)
    if (result) found.push(result)
  }

  // Also scan ~/Documents/GitHub for any dir with Hermes compose files
  const ghDir = path.join(os.homedir(), 'Documents', 'GitHub')
  try {
    const entries = fs.readdirSync(ghDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const fullPath = path.join(ghDir, entry.name)
      const tildePath = `~/Documents/GitHub/${entry.name}`
      if (found.some(f => expandPath(f.path) === fullPath)) continue
      const result = scanDirForHermes(fullPath, tildePath)
      if (result) found.push(result)
    }
  } catch {}

  return NextResponse.json({ paths: found })
}
