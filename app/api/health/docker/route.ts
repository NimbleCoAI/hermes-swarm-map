import { NextResponse } from 'next/server'
import { execSync } from 'child_process'

export async function GET() {
  try {
    const version = execSync('docker --version', { timeout: 5000 }).toString().trim()
    const running = execSync('docker info --format "{{.ServerVersion}}"', { timeout: 5000 }).toString().trim()
    return NextResponse.json({ available: true, version, serverVersion: running })
  } catch {
    return NextResponse.json({ available: false, error: 'Docker not found or not running' })
  }
}
