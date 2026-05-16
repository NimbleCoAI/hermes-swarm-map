import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { dataDir, name } = body

  if (!dataDir || !name) {
    return NextResponse.json({ error: 'dataDir and name are required' }, { status: 400 })
  }

  try {
    const result = services.harness.importFromDir(dataDir, name.trim())
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Import failed' },
      { status: 500 }
    )
  }
}
