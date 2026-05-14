import type { HarnessStatus } from '@/lib/types'

const colors: Record<HarnessStatus, string> = {
  running: 'bg-[var(--success)]',
  idle: 'bg-[var(--text-secondary)]',
  stopped: 'border border-[var(--text-secondary)] bg-transparent',
  error: 'bg-[var(--danger)]',
}

export function StatusDot({ status }: { status: HarnessStatus }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${colors[status]}`}
      title={status}
    />
  )
}
