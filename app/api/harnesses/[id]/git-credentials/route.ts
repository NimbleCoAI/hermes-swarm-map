import { NextResponse } from 'next/server'
import { provisionGitCredentials } from '@/lib/services/git-credentials'

/**
 * Provision (or refresh) per-agent git credentials from the agent's own
 * configured GitHub PAT. Writes ~/.git-credentials + ~/.gitconfig into the
 * agent's data dir so `git` works over HTTPS without `gh` or SSH keys.
 *
 * No container restart needed — git reads these files live from the mounted
 * data dir. Returns provisioned:false (200) when the agent has no token.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const result = provisionGitCredentials(id)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'git credential provisioning failed' },
      { status: 500 },
    )
  }
}
