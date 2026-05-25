import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function GET() {
  return NextResponse.json(services.keys.list())
}

export async function POST(request: Request) {
  const body = await request.json()
  const key = services.keys.add(body)

  // Write key to assigned harnesses' .env files
  if (body.assignedTo?.length && body.value) {
    for (const harnessId of body.assignedTo) {
      services.keys.writeKeyToEnv(harnessId, body.provider, body.value)
    }
  }

  return NextResponse.json(key, { status: 201 })
}
