import { NextResponse } from 'next/server'
import { loadUseCaseTemplates } from '@/lib/services/usecase-templates'

// Lists public use-case templates the create-new wizard can offer. Returns only
// presentational fields + recommendations; artifact sources are non-secret repo
// refs but aren't needed by the client, so we keep the payload lean.
export async function GET() {
  const templates = loadUseCaseTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    recommends: t.recommends ?? {},
  }))
  return NextResponse.json(templates)
}
