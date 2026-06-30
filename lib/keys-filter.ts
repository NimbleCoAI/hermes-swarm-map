import type { Key } from '@/lib/types'

/**
 * Pure, testable predicate for the Keys page search box.
 *
 * Filters a list of keys by a free-text query, matching case-insensitively
 * against the key's provider, display name, masked value, and the names of the
 * harnesses it is assigned to.
 *
 * @param keys        the keys to filter (may be null/undefined while loading)
 * @param query       the raw search string
 * @param harnessNames optional resolver mapping a key's `assignedTo` harness ids
 *                     to a human-readable string (so assigned-harness names are
 *                     searchable). Mirrors the page's existing `harnessNames`
 *                     helper. When omitted, the raw ids are searched.
 */
export function filterKeys(
  keys: Key[] | null | undefined,
  query: string,
  harnessNames?: (ids: string[]) => string,
): Key[] {
  if (!keys) return []
  const q = query.trim().toLowerCase()
  if (!q) return keys
  return keys.filter((k) => {
    const assigned = harnessNames ? harnessNames(k.assignedTo) : k.assignedTo.join(', ')
    const haystack = [
      k.provider,
      k.name ?? '',
      k.maskedValue,
      assigned,
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })
}
