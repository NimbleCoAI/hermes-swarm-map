import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const CONTAINER = process.env.SIGNAL_CONTAINER || 'signal-cli-daemon'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const phone = searchParams.get('phone')

  if (!phone) {
    return NextResponse.json({ error: 'phone param required' }, { status: 400 })
  }

  try {
    const { stdout } = await execAsync(
      `docker exec ${CONTAINER} signal-cli -a ${phone} listGroups -d`,
      { timeout: 15000 }
    )

    // Parse signal-cli listGroups output
    // Format: Id: <base64id> Name: <name> Active: true/false Blocked: true/false Members: [...]
    const groups: Array<{ id: string; name: string; active: boolean }> = []

    for (const line of stdout.split('\n')) {
      const idMatch = line.match(/Id:\s+(\S+)/)
      const nameMatch = line.match(/Name:\s+(.+?)(?:\s+Active:|$)/)
      const activeMatch = line.match(/Active:\s+(true|false)/)

      if (idMatch) {
        groups.push({
          id: idMatch[1],
          name: nameMatch?.[1]?.trim() || 'Unknown',
          active: activeMatch?.[1] === 'true',
        })
      }
    }

    return NextResponse.json({ groups })
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string }
    return NextResponse.json({
      error: (err.stderr || err.message || 'Failed to list groups').split('\n').pop(),
      groups: []
    }, { status: 500 })
  }
}
