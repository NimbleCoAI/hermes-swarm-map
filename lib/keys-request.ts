/**
 * Pure parser for credential-request prefill links on the Keys page.
 *
 * Agents send operators links like `/keys?request=hedra&assign=h_mare` so the
 * Add Key form opens pre-populated and the operator only pastes the secret.
 * The link encodes intent only — no secret material ever travels in the URL,
 * and parsing it causes no state change on the server.
 *
 * @param searchParams the page's URL search params
 * @param harnessIds   optional list of known harness ids; when provided,
 *                     `assign` entries not in the list are silently dropped
 * @returns the prefill intent, or null when no (valid) `request` param exists
 */
export interface KeyRequestPrefill {
  provider: string
  assignTo: string[]
  name: string | undefined
}

const PROVIDER_SLUG = /^[a-z0-9][a-z0-9_-]*$/

export function parseKeyRequestParams(
  searchParams: URLSearchParams,
  harnessIds?: string[],
): KeyRequestPrefill | null {
  const provider = (searchParams.get('request') ?? '').trim().toLowerCase()
  if (!PROVIDER_SLUG.test(provider)) return null

  let assignTo = (searchParams.get('assign') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  if (harnessIds) {
    assignTo = assignTo.filter((id) => harnessIds.includes(id))
  }

  const name = searchParams.get('name')?.trim() || undefined

  return { provider, assignTo, name }
}
