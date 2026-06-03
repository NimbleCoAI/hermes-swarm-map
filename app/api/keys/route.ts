import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function GET() {
  return NextResponse.json(services.keys.list())
}

export async function POST(request: Request) {
  const body = await request.json()
  const key = services.keys.add(body)

  // Write key to assigned harnesses' .env files, then recreate so the new
  // value actually loads (env_file is read at container creation, not restart).
  if (body.assignedTo?.length && body.value) {
    for (const harnessId of body.assignedTo) {
      services.keys.writeKeyToEnv(harnessId, body.provider, body.value)
      try { services.harness.restart(harnessId, 'recreate') } catch {}
    }
  }

  return NextResponse.json(key, { status: 201 })
}
