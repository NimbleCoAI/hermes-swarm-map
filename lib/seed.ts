import { Storage } from './services/storage'
import path from 'path'
import os from 'os'

const DATA_DIR = process.env.DATA_DIR
  ? process.env.DATA_DIR.replace('~', os.homedir())
  : path.join(os.homedir(), '.hermes-swarm-map')

const storage = new Storage(DATA_DIR)
const now = Date.now()

// Write settings pointing at the real hermes-swarm compose directory
storage.write('settings.json', {
  hermesDir: path.join(os.homedir(), 'Documents/GitHub/hermes-swarm'),
  dataDir: DATA_DIR,
  theme: 'light',
  composeFiles: [],
})

// Harnesses are discovered live from Docker — no static seed data.
// harnesses.json stores user-configured overlays (tier, tools, keys, etc.)
// and is written on first updateConfig() call. Start with an empty overlay file.
storage.write('harnesses.json', [])

storage.write('surfaces.json', [
  { id: 'int_mm', platform: 'mattermost', name: 'Mattermost Instance', status: 'connected', config: { url: 'https://mattermost.example.com' }, harnessIds: ['h_alpha','h_recon','h_standup','h_reviewer','h_sandbox'] },
  { id: 'int_tg', platform: 'telegram', name: 'Telegram Bot Suite', status: 'connected', config: {}, harnessIds: ['h_coder','h_helpdesk','h_shared'] },
  { id: 'int_dc', platform: 'discord', name: 'Discord', status: 'available', config: {}, harnessIds: [] },
  { id: 'int_sg', platform: 'signal', name: 'Signal', status: 'planned', config: {}, harnessIds: [] },
])

storage.write('keys.json', [
  { id: 'k_anth', provider: 'anthropic', maskedValue: 'sk-a…fake', encryptedValue: 'sk-ant-fake-primary', assignedTo: ['h_alpha','h_recon','h_reviewer','h_shared','h_helpdesk'], budgetUsd: 200, health: 'good' },
  { id: 'k_anth2', provider: 'anthropic', maskedValue: 'sk-a…fake', encryptedValue: 'sk-ant-fake-sandbox', assignedTo: ['h_sandbox'], budgetUsd: 25, health: 'good' },
  { id: 'k_ollama', provider: 'ollama', maskedValue: 'localhost', encryptedValue: 'localhost', assignedTo: ['h_coder','h_sandbox'], health: 'good' },
  { id: 'k_gh', provider: 'github', maskedValue: 'ghp_…fake', encryptedValue: 'ghp_fake_token', assignedTo: ['h_alpha','h_coder','h_reviewer','h_sandbox'], health: 'expired' },
  { id: 'k_notion', provider: 'notion', maskedValue: 'secr…fake', encryptedValue: 'secret_fake_notion', assignedTo: ['h_alpha'], health: 'good' },
])

storage.write('tools.json', [
  { id: 't_memread', name: 'memory.read', source: 'builtin', reviewed: true, risk: 1, allowedTiers: ['individual','team','org','orgpublic','public'], description: 'Read learned preferences (scope-aware).' },
  { id: 't_memwrite', name: 'memory.append', source: 'builtin', reviewed: true, risk: 2, allowedTiers: ['individual','team','org','orgpublic'], description: 'Append-only memory write.' },
  { id: 't_chatpost', name: 'chat.post', source: 'builtin', reviewed: true, risk: 1, allowedTiers: ['individual','team','org','orgpublic','public'], description: 'Post messages back to source channel.' },
  { id: 't_calendar', name: 'calendar.read', source: 'builtin', reviewed: true, risk: 1, allowedTiers: ['individual','team','org'], description: 'Read ICS feeds.' },
  { id: 't_notion', name: 'notion.search', source: 'mcp', reviewed: true, risk: 2, allowedTiers: ['individual','team','org'], description: 'Search internal docs.' },
  { id: 't_github_r', name: 'github.read', source: 'mcp', reviewed: true, risk: 2, allowedTiers: ['individual','team','org','orgpublic'], description: 'Read repos, PRs, issues.' },
  { id: 't_github_w', name: 'github.comment', source: 'mcp', reviewed: true, risk: 3, allowedTiers: ['individual','team','org'], description: 'Post PR comments and reviews.' },
  { id: 't_fs_read', name: 'fs.read', source: 'builtin', reviewed: true, risk: 2, allowedTiers: ['individual','team'], description: 'Sandboxed file read.' },
  { id: 't_fs_write', name: 'fs.write', source: 'builtin', reviewed: true, risk: 3, allowedTiers: ['individual','team'], description: 'Sandboxed file write.' },
  { id: 't_code_run', name: 'code.exec', source: 'builtin', reviewed: true, risk: 4, allowedTiers: ['individual','team'], description: 'Execute code in sandbox.' },
  { id: 't_web_fetch', name: 'web.fetch', source: 'builtin', reviewed: true, risk: 5, allowedTiers: ['individual','team'], description: 'Fetch arbitrary URL. Highest risk.' },
  { id: 't_web_search', name: 'web.search', source: 'builtin', reviewed: true, risk: 5, allowedTiers: ['individual','team','org'], description: 'Web search via provider.' },
  { id: 't_delete', name: 'fs.delete', source: 'builtin', reviewed: true, risk: 5, allowedTiers: ['individual'], description: 'Destructive. Requires confirm + audit.' },
  { id: 't_jira', name: 'jira.search', source: 'mcp', reviewed: false, risk: 2, allowedTiers: ['individual'], description: 'User-added MCP. Unconfirmed risk.' },
  { id: 't_shell', name: 'shell.exec', source: 'custom', reviewed: false, risk: 5, allowedTiers: ['individual'], description: 'User-added. Locked until reviewed.' },
])

storage.write('memory-scopes.json', [
  { id: 'm_private', name: 'private', tier: 'individual', strategy: 'siloed-runtime', members: ['h_recon','h_sandbox'], sizeMb: 24 },
  { id: 'm_team', name: 'team-shared', tier: 'team', strategy: 'tag-gated', members: ['h_alpha','h_recon','h_standup','h_reviewer','h_sandbox'], sizeMb: 180 },
  { id: 'm_org', name: 'org-internal', tier: 'org', strategy: 'tag-gated', members: ['h_alpha','h_coder','h_reviewer','h_shared'], sizeMb: 412 },
  { id: 'm_pub', name: 'public-faq', tier: 'public', strategy: 'tag-gated', members: ['h_helpdesk'], sizeMb: 88 },
])

storage.write('models.json', [
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', vendor: 'anthropic', accessTier: 'admin', costClass: 'high', notes: 'High capability. Frontier reasoning.' },
  { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', vendor: 'anthropic', accessTier: 'admin', costClass: 'medium', notes: 'Fast, cheaper. Good default.' },
  { id: 'qwen2.5-coder:32b', name: 'Qwen 2.5 Coder 32B', vendor: 'ollama', accessTier: 'open', costClass: 'local', notes: 'Local. Code-focused.' },
  { id: 'qwen2.5:14b', name: 'Qwen 2.5 14B', vendor: 'ollama', accessTier: 'open', costClass: 'local', notes: 'Local. General purpose.' },
  { id: 'qwen3.5:9b', name: 'Qwen 3.5 9B', vendor: 'ollama', accessTier: 'open', costClass: 'local', notes: 'Local. Lightweight.' },
])

storage.write('people.json', [
  { id: 'p_admin', handle: '@admin', role: 'admin', surfaces: ['int_mm', 'int_tg'] },
  { id: 'p_user1', handle: '@user-one', role: 'community', surfaces: ['int_mm'] },
  { id: 'p_user2', handle: '@user-two', role: 'community', surfaces: ['int_tg'] },
])

console.log(`Seed data written to ${DATA_DIR}`)
