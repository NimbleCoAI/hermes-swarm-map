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

// Indicators that a compose file manages Hermes agents
// (may be built from source, pulled from registry, or use custom image)
const HERMES_MARKERS = [
  'command: gateway',           // Hermes gateway command
  '/opt/data',                  // Hermes data volume mount
  'x-hermes',                   // YAML extension anchor
  'nousresearch/hermes-agent',  // Official image
  'HERMES_REPO_URL',            // Hermes env var
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

function isHermesCompose(content: string): boolean {
  // At least 2 markers = high confidence this is a Hermes compose file
  const hits = HERMES_MARKERS.filter(marker => content.includes(marker))
  return hits.length >= 2
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
      if (isHermesCompose(content)) {
        hermesFiles++
        // Count services that have `command: gateway` (actual agents, not infra)
        const gatewayServices = (content.match(/command:\s*gateway/g) || []).length
        // Fallback: count services with /opt/data mount
        const dataServices = (content.match(/\/opt\/data/g) || []).length
        totalAgents += Math.max(gatewayServices, dataServices)
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

  // If filesystem scan found nothing, try detecting from running Docker containers
  if (found.length === 0) {
    try {
      const { execSync } = await import('child_process')
      // Find running containers with gateway command or /opt/data mount
      const psOutput = execSync(
        'docker ps --format "{{.Names}}\\t{{.Label \\"com.docker.compose.project.config_files\\"}}"',
        { stdio: 'pipe', timeout: 10000 }
      ).toString().trim()

      const composePaths = new Set<string>()
      for (const line of psOutput.split('\n')) {
        const [name, configFile] = line.split('\t')
        if (!name || !configFile) continue
        // Check if this looks like a hermes container (has gateway in command or hermes in name)
        if (name.includes('hermes') || name.includes('seraph')) {
          // configFile might be comma-separated
          for (const cf of configFile.split(',')) {
            const trimmed = cf.trim()
            if (trimmed && fs.existsSync(trimmed)) {
              composePaths.add(path.dirname(trimmed))
            }
          }
        }
      }

      for (const dir of composePaths) {
        const displayPath = dir.replace(os.homedir(), '~')
        const result = scanDirForHermes(dir, displayPath)
        if (result) found.push(result)
      }
    } catch {}
  }

  return NextResponse.json({ paths: found })
}
