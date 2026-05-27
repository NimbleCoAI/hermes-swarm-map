/**
 * In-memory tracker for harnesses currently being restarted.
 * Prevents UI flicker by overriding status to 'restarting' until
 * the container comes back up or the TTL expires.
 */

const restarts = new Map<string, { startedAt: number; mode: string }>()
const TTL = 5 * 60 * 1000 // 5 minute max

export function markRestarting(id: string, mode: string) {
  restarts.set(id, { startedAt: Date.now(), mode })
}

export function isRestarting(id: string): boolean {
  const entry = restarts.get(id)
  if (!entry) return false
  if (Date.now() - entry.startedAt > TTL) {
    restarts.delete(id)
    return false
  }
  return true
}

export function clearRestarting(id: string) {
  restarts.delete(id)
}
