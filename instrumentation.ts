// Next.js instrumentation hook — runs once per server start.
// Registers the fleet SQLite integrity sweep scheduler (#204, PR1).
export async function register() {
  // Only the Node.js server runtime can touch better-sqlite3 / the filesystem.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startIntegrityScheduler } = await import('@/lib/services/integrity-scheduler')
  startIntegrityScheduler()
}
