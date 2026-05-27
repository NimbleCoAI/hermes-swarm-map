import type { CacheState } from '@/lib/types'

const styles: Record<CacheState, string> = {
  warm: 'bg-green-500/10 text-green-600',
  cold: 'bg-gray-500/10 text-gray-500',
  stale: 'bg-orange-500/10 text-orange-500',
}

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h`
}

export function CacheStatePill({ state, age }: { state: CacheState; age?: number }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${styles[state]}`}>
      {state}
      {age !== undefined && <span className="opacity-70">{formatAge(age)}</span>}
    </span>
  )
}
