import { NextResponse } from 'next/server'
import { services } from '@/lib/services'
import { isLettaHarnessId } from '@/lib/services/letta-agent-provider'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  // Letta agents/server aren't containers — resolve them over REST (design §1c),
  // not through the sync container discovery in HarnessService.get().
  if (isLettaHarnessId(id)) {
    const harness = await services.lettaAgents.get(id)
    if (!harness) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json(harness)
  }
  const harness = services.harness.get(id)
  if (!harness) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json(harness)
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const url = new URL(request.url)
  const deleteFiles = url.searchParams.get('deleteFiles') === 'true'

  const result = services.harness.remove(id, deleteFiles)
  if (!result.removed) {
    return NextResponse.json({ error: 'Harness not found' }, { status: 404 })
  }

  return NextResponse.json(result)
}
