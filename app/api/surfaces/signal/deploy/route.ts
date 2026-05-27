import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getSignalDaemonUrl } from '@/lib/env-helpers'

const COMPOSE_CONTENT = `services:
  signal-cli:
    image: bbernhard/signal-cli-rest-api:0.199-dev
    container_name: signal-cli-daemon
    restart: unless-stopped
    environment:
      - MODE=json-rpc
    ports:
      - "8080:8080"
    volumes:
      - \${HOME}/.hermes-swarm/signal-data:/home/.local/share/signal-cli
    healthcheck:
      test: ["CMD-SHELL", "curl -sf --max-time 3 http://localhost:8080/v1/about | grep -q json-rpc"]
      interval: 30s
      timeout: 10s
      start_period: 45s
      retries: 3
    networks:
      - hermes-net

networks:
  hermes-net:
    external: true
`

export async function POST() {
  try {
    // Check if already running
    try {
      const ps = execSync('docker ps --filter name=signal-cli-daemon --format "{{.Status}}"', { timeout: 5000 }).toString().trim()
      if (ps.includes('Up')) {
        return NextResponse.json({ status: 'already_running', healthy: true })
      }
    } catch { /* docker not available or container not found */ }

    // Ensure network exists
    try {
      execSync('docker network create hermes-net 2>/dev/null || true', { timeout: 5000 })
    } catch { /* already exists */ }

    // Write compose file
    const swarmDir = path.join(os.homedir(), '.hermes-swarm')
    fs.mkdirSync(swarmDir, { recursive: true })
    fs.mkdirSync(path.join(swarmDir, 'signal-data'), { recursive: true })
    const composePath = path.join(swarmDir, 'docker-compose.signal.yml')
    fs.writeFileSync(composePath, COMPOSE_CONTENT)

    // Remove old container if stopped
    try {
      execSync('docker rm signal-cli-daemon 2>/dev/null || true', { timeout: 5000 })
    } catch { /* nothing to remove */ }

    // Start
    execSync(`docker compose -f "${composePath}" up -d`, { timeout: 60000, cwd: swarmDir })

    // Poll for health (up to 45 seconds)
    const signalUrl = getSignalDaemonUrl()
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 3000))
      try {
        const res = await fetch(`${signalUrl}/v1/about`, { signal: AbortSignal.timeout(3000) })
        if (res.ok) {
          const data = await res.json()
          if (data.mode === 'json-rpc') {
            return NextResponse.json({ status: 'started', healthy: true })
          }
        }
      } catch { /* not ready yet */ }
    }

    return NextResponse.json({ status: 'started', healthy: false })
  } catch (err) {
    return NextResponse.json({ status: 'failed', error: String(err) }, { status: 500 })
  }
}
