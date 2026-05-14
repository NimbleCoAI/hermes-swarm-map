import { Storage } from './services/storage'
import path from 'path'
import os from 'os'

const DATA_DIR = process.env.DATA_DIR
  ? process.env.DATA_DIR.replace('~', os.homedir())
  : path.join(os.homedir(), '.hermes-swarm-map')

const storage = new Storage(DATA_DIR)
const now = Date.now()

storage.write('harnesses.json', [
  { id: 'h_alpha', name: 'alpha', runtime: 'hermes', status: 'running', health: { errors: 0 }, persona: 'Helpful operator. Threaded updates.', tier: 'team', platform: 'mattermost', channel: 'team-ops', lastSeen: now, models: ['claude-sonnet-4.5','claude-haiku-4.5','qwen2.5:14b'], costToday: 1.84, invocations: 142, cpu: 18, mem: 412, tools: ['t_memread','t_chatpost','t_notion','t_github_r'] },
  { id: 'h_recon', name: 'recon-01', runtime: 'hermes', status: 'running', health: { errors: 0 }, persona: 'Methodical researcher. Always cites sources.', tier: 'individual', platform: 'mattermost', channel: 'private', lastSeen: now, models: ['claude-sonnet-4.5','qwen2.5:14b'], costToday: 0.42, invocations: 38, cpu: 9, mem: 287, tools: ['t_web_search','t_github_r','t_memread','t_fs_read'] },
  { id: 'h_coder', name: 'coder', runtime: 'hermes', status: 'running', health: { errors: 1, errorMsg: 'Rate limit at 84%' }, persona: 'Code specialist. Terse. Verifies twice.', tier: 'org', platform: 'telegram', channel: '@example_coder', lastSeen: now, models: ['qwen2.5-coder:32b','claude-haiku-4.5'], costToday: 0.0, invocations: 211, cpu: 31, mem: 612, tools: ['t_github_r','t_github_w','t_code_run','t_memread'] },
  { id: 'h_helpdesk', name: 'helpdesk', runtime: 'hermes', status: 'running', health: { errors: 3 }, persona: 'Public-facing help bot. Read-only.', tier: 'public', platform: 'telegram', channel: '@example_help', lastSeen: now, models: ['claude-haiku-4.5','qwen2.5:14b'], costToday: 4.21, invocations: 1284, cpu: 6, mem: 198, tools: ['t_memread'] },
  { id: 'h_standup', name: 'standup', runtime: 'hermes', status: 'idle', health: { errors: 0 }, persona: 'Daily standup curator.', tier: 'team', platform: 'mattermost', channel: 'standup', lastSeen: now - 42*60000, models: ['claude-haiku-4.5','qwen2.5:14b'], costToday: 0.08, invocations: 4, cpu: 0, mem: 92, tools: ['t_calendar','t_chatpost','t_memread'] },
  { id: 'h_reviewer', name: 'pr-review', runtime: 'hermes', status: 'error', health: { errors: 12, errorMsg: 'GitHub token expired — see Keys' }, persona: 'Reads PRs. Inline comments.', tier: 'org', platform: 'mattermost', channel: 'eng-review', lastSeen: now - 8*60000, models: ['claude-sonnet-4.5','claude-haiku-4.5'], costToday: 0.31, invocations: 22, cpu: 0, mem: 0, tools: ['t_github_r','t_github_w','t_code_run','t_memread'] },
  { id: 'h_shared', name: 'shared-entity', runtime: 'hermes', status: 'stopped', health: { errors: 0 }, persona: 'Shared-context entity.', tier: 'orgpublic', platform: 'telegram', channel: '@example_shared', lastSeen: now - 6*3600000, models: ['claude-sonnet-4.5','claude-haiku-4.5','qwen2.5:14b'], costToday: 0.0, invocations: 0, cpu: 0, mem: 0, tools: ['t_memread','t_web_search'] },
  { id: 'h_sandbox', name: 'sandbox-dev', runtime: 'hermes', status: 'running', health: { errors: 0 }, persona: 'Local-only experiment harness.', tier: 'individual', platform: 'mattermost', channel: 'private', lastSeen: now, models: ['qwen3.5:9b','qwen2.5-coder:32b'], costToday: 0.0, invocations: 67, cpu: 24, mem: 510, tools: ['t_fs_read','t_fs_write','t_code_run','t_memread','t_web_fetch'] },
])

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
