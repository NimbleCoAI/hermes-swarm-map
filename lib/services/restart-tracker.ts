/**
 * In-memory tracker for harnesses currently being restarted.
 * Prevents UI flicker by overriding status to 'restarting' until
 * the container comes back up or the TTL expires.
 */

const restarts = new Map<string, { startedAt: number; mode: string }>()

// The lock's early clear (harness status GET observing 'running') only fires when
// a client polls status. A pure-API iterate-restart-verify loop that never GETs
// harness status would otherwise be held for the full TTL — falsely 409'ing a
// back-to-back restart long after the container has actually settled (issue #150).
//
// So the TTL is the real backstop, and it must reflect how long the mode can run:
//   - quick / recreate: complete in seconds → short window, just a debounce so we
//     don't hammer a container that's still coming up.
//   - rebuild / purge:  a Docker build can legitimately run for minutes → keep the
//     long window so a still-building harness isn't reported as done.
const QUICK_TTL = 90 * 1000 // 90s — quick/recreate
const BUILD_TTL = 5 * 60 * 1000 // 5 min — rebuild/purge

function ttlFor(mode: string): number {
  return mode === 'rebuild' || mode === 'purge' ? BUILD_TTL : QUICK_TTL
}

export function markRestarting(id: string, mode: string) {
  restarts.set(id, { startedAt: Date.now(), mode })
}

export function isRestarting(id: string): boolean {
  const entry = restarts.get(id)
  if (!entry) return false
  if (Date.now() - entry.startedAt > ttlFor(entry.mode)) {
    restarts.delete(id)
    return false
  }
  return true
}

export function clearRestarting(id: string) {
  restarts.delete(id)
}
