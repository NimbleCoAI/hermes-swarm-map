import { Storage } from './services/storage'
import path from 'path'
import os from 'os'

const DATA_DIR = process.env.DATA_DIR
  ? process.env.DATA_DIR.replace('~', os.homedir())
  : path.join(os.homedir(), '.hermes-swarm-map')

const storage = new Storage(DATA_DIR)

// Write settings pointing at the real hermes-swarm compose directory
storage.write('settings.json', {
  hermesDir: path.join(os.homedir(), 'Documents/GitHub/hermes-swarm'),
  dataDir: DATA_DIR,
  theme: 'light',
  composeFiles: [],
  onboarded: true,
})

// Harnesses are discovered live from Docker.
// harnesses.json stores user-configured overlays (tier, platform, channel, etc.)
storage.write('harnesses.json', [
  { id: 'h_personal', tier: 'individual', platform: 'mattermost', channel: 'sanctum' },
  { id: 'h_osint', tier: 'team', platform: 'mattermost', channel: 'sanctum' },
  { id: 'h_cyborg', tier: 'team', platform: 'mattermost', channel: 'team-ops' },
  { id: 'h_cryptids', tier: 'org', platform: 'telegram', channel: '@nimble_cryptid' },
  { id: 'h_egregore', tier: 'orgpublic', platform: 'telegram', channel: '@egregore_bot' },
  { id: 'h_seraph_thinker', tier: 'org', platform: 'hermes', channel: ':8692' },
  { id: 'h_seraph_doer', tier: 'org', platform: 'hermes', channel: ':8702' },
  { id: 'h_seraph_generalist', tier: 'org', platform: 'hermes', channel: ':8712' },
])

// Models — static config (not discovered)
storage.write('models.json', [
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', vendor: 'anthropic', accessTier: 'admin', costClass: 'high', notes: 'Primary model via LiteLLM proxy.' },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', vendor: 'anthropic', accessTier: 'admin', costClass: 'high', notes: 'Fallback direct anthropic.' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', vendor: 'google', accessTier: 'admin', costClass: 'medium', notes: 'Via vertex-proxy.' },
  { id: 'qwen3.5-9b', name: 'Qwen 3.5 9B', vendor: 'ollama', accessTier: 'open', costClass: 'local', notes: 'Local. Lightweight.' },
])

// People — static admin config
storage.write('people.json', [
  { id: 'p_juniper', handle: '@juniper', role: 'admin', surfaces: ['int_mm', 'int_tg'] },
])

// Tools, keys, surfaces, memory-scopes are discovered live — no seed data needed.
// tools.json, keys.json, surfaces.json, memory-scopes.json = user override stores only.

console.log(`Seed data written to ${DATA_DIR}`)
