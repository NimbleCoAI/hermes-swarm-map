import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { dataDir, name } = body

  if (!dataDir || !name) {
    return NextResponse.json({ error: 'dataDir and name are required' }, { status: 400 })
  }

  try {
    const result = await services.harness.importFromDir(dataDir, name.trim())
    return NextResponse.json({
      id: result.id,
      name: result.name,
      sourceDir: result.sourceDir,
      destDir: result.destDir,
      changes: result.changes,
    }, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Import failed' },
      { status: 500 }
    )
  }
}
