/**
 * ContainerRuntimeAdapter — the container-runtime seam.
 *
 * Design: memory/specs/2026-07-18-letta-wizard-fork-design.md §1b.
 *
 * HSM's discovery/detail code currently hardcodes Hermes assumptions inline
 * (the `hermes-`/`seraph-` name gate, `~/.hermes*` data dir, the SOUL/model
 * readers). This interface factors those out so `HarnessService.discover()`
 * dispatches on a runtime adapter instead of branching on string prefixes —
 * making room for `claude-code-proxy`/`custom` later.
 *
 * SCOPE (slice 1): only the *discovery* surface is extracted — the fields
 * `discover()` reads off a live container. The remaining container methods the
 * full design lists (`generateCompose`, `scaffold`, `readImageRef`/
 * `setImageRef`, `serviceName`) stay inline in harness.ts / harness-compose.ts
 * for now; extracting them touches the Hermes *deploy* path and is deferred to
 * Phase 2 (see design §5). Adding a member here is additive — nothing calls a
 * method that doesn't exist yet.
 *
 * NOTE: Letta agents do NOT go through this adapter. They are not containers;
 * they are enumerated from the Letta server over REST by the separate
 * AgentResourceProvider (lib/services/letta-agent-provider.ts). This interface
 * is exclusively the *container* seam.
 */

import type { Harness } from '@/lib/types'

export interface ContainerRuntimeAdapter {
  /** The `runtime` value stamped on harnesses this adapter discovers. */
  runtime: Harness['runtime']

  /**
   * Discovery gate: does this live container belong to this runtime? Replaces
   * the inline `containerName.startsWith('hermes-')` test in discover().
   */
  matches(containerName: string): boolean

  /** Where the agent's world lives on disk (SOUL.md, config). */
  dataDir(serviceName: string, containerName: string): string

  /** Short persona/identity string read off the data dir. */
  readPersona(dataDir: string): string

  /** Configured model handles read off the data dir. */
  readModels(dataDir: string): string[]
}
