// Shared mock state for Hermes Swarm Map prototype.
// Both directions (Operator Console + Calm Orchestrator) read from this.

window.MOCK_DATA = (() => {
  const now = Date.now();
  const min = (n) => now - n * 60_000;
  const hr  = (n) => now - n * 3_600_000;

  const TIERS = [
    { id: 'individual',  label: 'Individual',  rank: 1, color: '#6BB39A', desc: 'Inner sanctum. Solo operator. Full trust.' },
    { id: 'team',        label: 'Team',        rank: 2, color: '#7FA9D6', desc: 'Small group. High trust. Shared memory.' },
    { id: 'org',         label: 'Org',         rank: 3, color: '#C7A86B', desc: 'Internal only. Memory firewalls.' },
    { id: 'orgpublic',   label: 'Org + Public',rank: 4, color: '#D58A5A', desc: 'Internal team with limited public surface.' },
    { id: 'public',      label: 'Public',      rank: 5, color: '#C46A6A', desc: 'Adversarial. Open API. Heavy scoping.' },
  ];

  // Model stacks: ordered list = priority. First = primary, rest = fallbacks.
  // The legacy `model` string is kept as a derived convenience (= models[0]).
  const HARNESSES = [
    { id: 'h_audrey',  name: 'audrey',     runtime: 'hermes', status: 'running', tier: 'team',      platform: 'mattermost', channel: 'team-ops',         lastSeen: min(0.4), models: ['claude-sonnet-4.5','claude-haiku-4.5','qwen2.5:14b'],     costToday: 1.84, invocations: 142, tools: ['notion','github','calendar','memory','mattermost'], cpu: 18, mem: 412, persona: 'Helpful operator. Threaded updates. Reads room.', errors: 0 },
    { id: 'h_osint',   name: 'osint-01',   runtime: 'hermes', status: 'running', tier: 'individual',platform: 'mattermost', channel: 'sanctum',          lastSeen: min(1.2), models: ['claude-sonnet-4.5','qwen2.5:14b'],                        costToday: 0.42, invocations: 38,  tools: ['web','github','memory','filesystem'],            cpu: 9,  mem: 287, persona: 'Methodical researcher. Always cites sources.',     errors: 0 },
    { id: 'h_cryptid', name: 'cryptid',    runtime: 'hermes', status: 'running', tier: 'org',       platform: 'telegram',   channel: '@nimble_cryptid', lastSeen: min(0.1), models: ['qwen2.5-coder:32b','claude-haiku-4.5'],                  costToday: 0.00, invocations: 211, tools: ['github','code','memory'],                        cpu: 31, mem: 612, persona: 'Crypto/code specialist. Terse. Verifies twice.',  errors: 1 },
    { id: 'h_frontdesk',name:'frontdesk', runtime: 'hermes', status: 'running', tier: 'public',    platform: 'telegram',   channel: '@nimble_help',    lastSeen: min(0.0), models: ['claude-haiku-4.5','qwen2.5:14b'],                          costToday: 4.21, invocations: 1284,tools: ['memory'],                                          cpu: 6,  mem: 198, persona: 'Public-facing help bot. Read-only. Triages and escalates.', errors: 3 },
    { id: 'h_handoff', name: 'handoff',    runtime: 'hermes', status: 'idle',    tier: 'team',      platform: 'mattermost', channel: 'standup',          lastSeen: min(42),  models: ['claude-haiku-4.5','qwen2.5:14b'],                         costToday: 0.08, invocations: 4,   tools: ['calendar','mattermost','memory'],                cpu: 0,  mem: 92,  persona: 'Daily standup curator. Wakes on schedule.',         errors: 0 },
    { id: 'h_review',  name: 'pr-review',  runtime: 'hermes', status: 'error',   tier: 'org',       platform: 'mattermost', channel: 'eng-review',       lastSeen: min(8),   models: ['claude-sonnet-4.5','claude-haiku-4.5'],                  costToday: 0.31, invocations: 22,  tools: ['github','code','memory'],                        cpu: 0,  mem: 0,   persona: 'Reads PRs. Inline comments. Style + bugs.',         errors: 12, errorMsg: 'GitHub token expired — see Keys' },
    { id: 'h_egregore',name: 'egregore',   runtime: 'hermes', status: 'stopped', tier: 'orgpublic', platform: 'telegram',   channel: '@egregore_bot',   lastSeen: hr(6),    models: ['claude-sonnet-4.5','claude-haiku-4.5','qwen2.5:14b'],     costToday: 0.00, invocations: 0,   tools: ['memory','web'],                                   cpu: 0,  mem: 0,   persona: 'Shared-context entity. Summons via /summon.',       errors: 0 },
    { id: 'h_sandbox', name: 'sandbox-dev',runtime: 'hermes', status: 'running', tier: 'individual',platform: 'mattermost', channel: 'sanctum',          lastSeen: min(0.2), models: ['qwen3.5:9b','qwen2.5-coder:32b'],                         costToday: 0.00, invocations: 67,  tools: ['filesystem','code','memory','web'],              cpu: 24, mem: 510, persona: 'Local-only experiment harness. Anything goes.',     errors: 0 },
  ];
  // Backfill legacy single-model field so existing UI code keeps working.
  HARNESSES.forEach((h) => { if (!h.model && h.models) h.model = h.models[0]; });

  const INTEGRATIONS = [
    { id: 'int_mm',  kind: 'mattermost', label: 'mattermost.nimbleco.ai', status: 'connected', scopes: ['post_messages','read_channels','manage_bots'], harnessIds: ['h_audrey','h_osint','h_handoff','h_review','h_sandbox'], serverInfo: 'v9.11 · 4 teams · 23 channels', lastSync: min(2),  dmsBlocked: true,  allowList: 8 },
    { id: 'int_tg',  kind: 'telegram',   label: '@NimbleBotFather suite',  status: 'connected', scopes: ['receive_messages','send_messages','inline_query'], harnessIds: ['h_cryptid','h_frontdesk','h_egregore'], serverInfo: '3 bots registered', lastSync: min(0.5), dmsAllowed: 'whitelisted', groupAdds: 'admin-only' },
    { id: 'int_dc',  kind: 'discord',    label: 'Discord',                  status: 'available', scopes: [], harnessIds: [], serverInfo: 'Not yet configured' },
    { id: 'int_sg',  kind: 'signal',     label: 'Signal',                   status: 'planned',   scopes: [], harnessIds: [], serverInfo: 'Roadmap · phase 2' },
  ];

  const PEOPLE = [
    { id: 'p_juni',   name: 'Juni Bevensee',  handle: '@juni',  role: 'owner',    tierAccess: ['individual','team','org','orgpublic','public'], lastActive: min(1) },
    { id: 'p_audrey', name: 'Audrey K.',      handle: '@audrey',role: 'admin',    tierAccess: ['team','org','orgpublic','public'], lastActive: min(14) },
    { id: 'p_max',    name: 'Max Lin',        handle: '@max',   role: 'operator', tierAccess: ['team','org'], lastActive: hr(2) },
    { id: 'p_rin',    name: 'Rin Park',       handle: '@rin',   role: 'operator', tierAccess: ['team'], lastActive: hr(20) },
    { id: 'p_dev',    name: 'Devon S.',       handle: '@devon', role: 'viewer',   tierAccess: ['team'], lastActive: hr(48) },
  ];

  const KEYS = [
    { id: 'k_anth',   label: 'Anthropic — primary',   provider: 'anthropic', masked: 'sk-ant-…q4F2', assignedTo: ['h_audrey','h_osint','h_review','h_egregore','h_frontdesk'], tier: 'org',        budgetUsd: 200, spentUsd: 84.21,  health: 'ok' },
    { id: 'k_anth2',  label: 'Anthropic — sandbox',   provider: 'anthropic', masked: 'sk-ant-…7zNa', assignedTo: ['h_sandbox'], tier: 'individual', budgetUsd: 25,  spentUsd: 4.10,   health: 'ok' },
    { id: 'k_aws',    label: 'AWS Bedrock',           provider: 'bedrock',   masked: 'AKIA…HGE9',    assignedTo: [], tier: 'org', budgetUsd: 100, spentUsd: 0, health: 'idle' },
    { id: 'k_vertex', label: 'Vertex AI (free trial)',provider: 'vertex',    masked: 'svc-acct…',    assignedTo: [], tier: 'team',      budgetUsd: 300, spentUsd: 12.40,  health: 'ok' },
    { id: 'k_ollama', label: 'Ollama (local)',        provider: 'ollama',    masked: 'localhost',    assignedTo: ['h_cryptid','h_sandbox'], tier: 'individual', budgetUsd: null, spentUsd: 0, health: 'ok' },
    { id: 'k_gh',     label: 'GitHub — service',      provider: 'github',    masked: 'ghp_…N3',      assignedTo: ['h_audrey','h_cryptid','h_review','h_sandbox'], tier: 'org', budgetUsd: null, spentUsd: 0, health: 'expired', healthMsg: 'Token expired 2d ago' },
    { id: 'k_notion', label: 'Notion',                provider: 'notion',    masked: 'secret_…aZ',   assignedTo: ['h_audrey'], tier: 'team',      budgetUsd: null, spentUsd: 0, health: 'ok' },
  ];

  // source: 'builtin' = ships with Hermes, hand-classified.
  //         'mcp'     = imported from an MCP server, hand-classified by an admin.
  //         'custom'  = user-added; risk + tier ceiling are guesses until reviewed.
  // reviewed: false = needs an admin to confirm risk + allowedTiers before opening to non-admins.
  const TOOLS = [
    { id: 't_memread',   name: 'memory.read',     category: 'memory',    source: 'builtin', reviewed: true, risk: 1, allowedTiers: ['individual','team','org','orgpublic','public'], desc: 'Read learned preferences (scope-aware).' },
    { id: 't_memwrite',  name: 'memory.append',   category: 'memory',    source: 'builtin', reviewed: true, risk: 2, allowedTiers: ['individual','team','org','orgpublic'],          desc: 'Append-only memory write. Scope-tagged.' },
    { id: 't_chatpost',  name: 'chat.post',       category: 'chat',      source: 'builtin', reviewed: true, risk: 1, allowedTiers: ['individual','team','org','orgpublic','public'], desc: 'Post messages back to source channel.' },
    { id: 't_calendar',  name: 'calendar.read',   category: 'calendar',  source: 'builtin', reviewed: true, risk: 1, allowedTiers: ['individual','team','org'],                     desc: 'Read ICS feeds.' },
    { id: 't_notion',    name: 'notion.search',   category: 'docs',      source: 'mcp',     reviewed: true, risk: 2, allowedTiers: ['individual','team','org'],                     desc: 'Search internal docs.' },
    { id: 't_github_r',  name: 'github.read',     category: 'code',      source: 'mcp',     reviewed: true, risk: 2, allowedTiers: ['individual','team','org','orgpublic'],         desc: 'Read repos, PRs, issues.' },
    { id: 't_github_w',  name: 'github.comment',  category: 'code',      source: 'mcp',     reviewed: true, risk: 3, allowedTiers: ['individual','team','org'],                     desc: 'Post PR comments and reviews.' },
    { id: 't_fs_read',   name: 'fs.read',         category: 'filesystem',source: 'builtin', reviewed: true, risk: 2, allowedTiers: ['individual','team'],                            desc: 'Sandboxed file read.' },
    { id: 't_fs_write',  name: 'fs.write',        category: 'filesystem',source: 'builtin', reviewed: true, risk: 3, allowedTiers: ['individual','team'],                            desc: 'Sandboxed file write.' },
    { id: 't_code_run',  name: 'code.exec',       category: 'sandbox',   source: 'builtin', reviewed: true, risk: 4, allowedTiers: ['individual','team'],                            desc: 'Execute code in sandbox. Network-isolated.' },
    { id: 't_web_fetch', name: 'web.fetch',       category: 'web',       source: 'builtin', reviewed: true, risk: 5, allowedTiers: ['individual','team'],                            desc: 'Fetch arbitrary URL. Highest risk — content can carry instructions.' },
    { id: 't_web_search',name: 'web.search',      category: 'web',       source: 'builtin', reviewed: true, risk: 5, allowedTiers: ['individual','team','org'],                     desc: 'Web search via provider. Content can carry instructions.' },
    { id: 't_delete',    name: 'fs.delete',       category: 'filesystem',source: 'builtin', reviewed: true, risk: 5, allowedTiers: ['individual'],                                   desc: 'Destructive. Requires confirm + audit.' },
    { id: 't_jira',      name: 'jira.search',     category: 'docs',      source: 'mcp',     reviewed: false,risk: 2, allowedTiers: ['individual'],                                   desc: 'User-added MCP. Risk + ceiling unconfirmed.' },
    { id: 't_shell',     name: 'shell.exec',      category: 'sandbox',   source: 'custom',  reviewed: false,risk: 5, allowedTiers: ['individual'],                                   desc: 'User-added. Reviewed: no. Locked to individual until admin classifies.' },
  ];

  const MEMORY_SCOPES = [
    { id: 'm_sanctum',   name: 'sanctum',     tier: 'individual', strategy: 'siloed-runtime', members: 1, size: '24 MB',  notes: 'Encrypted at rest. Never leaves machine.' },
    { id: 'm_team',      name: 'team-shared', tier: 'team',       strategy: 'tag-gated',      members: 5, size: '180 MB', notes: 'SQL with user_id tags. All members read/write.' },
    { id: 'm_org_int',   name: 'org-internal',tier: 'org',        strategy: 'tag-gated',      members: 12,size: '412 MB', notes: 'SQL + channel-scoped. Admins see all.' },
    { id: 'm_pub',       name: 'public-faq',  tier: 'public',     strategy: 'tag-gated',      members: '1.2k', size: '88 MB', notes: 'Read-only memory. Writes require admin approval.' },
  ];

  const RECENT_LOGS = [
    { ts: min(0.1), harness: 'frontdesk', level: 'info',  msg: 'invoke @user_3892: "how do I cancel my plan?" → triage: billing' },
    { ts: min(0.3), harness: 'audrey',    level: 'info',  msg: 'tool: notion.search "PR review checklist" → 3 results in 412ms' },
    { ts: min(0.6), harness: 'cryptid',   level: 'warn',  msg: 'rate limit at 84% (211/250 daily) — backing off' },
    { ts: min(0.9), harness: 'osint-01',  level: 'info',  msg: 'memory.append: scope=sanctum "preferred citation style: chicago"' },
    { ts: min(1.4), harness: 'audrey',    level: 'info',  msg: 'reply posted in #team-ops/thread:1827 (1.2s, 412 tok)' },
    { ts: min(2.1), harness: 'pr-review', level: 'error', msg: 'github.comment failed: 401 Unauthorized — token rotation required' },
    { ts: min(3.0), harness: 'frontdesk', level: 'info',  msg: 'invoke @user_2104: "thanks" → no action (ack only)' },
    { ts: min(4.2), harness: 'sandbox-dev',level:'info',  msg: 'code.exec: python script (387ms, exit 0)' },
    { ts: min(5.5), harness: 'cryptid',   level: 'info',  msg: 'reply posted to @user_aaron in @nimble_cryptid (840ms)' },
  ];

  // Model catalog with admin-defined access tiers.
  // accessTier: 'open' = anyone the harness habitat allows; 'admin' = admin-only invocation.
  // costClass is informational copy.
  const MODELS = [
    { id: 'claude-sonnet-4.5',  label: 'Claude Sonnet 4.5',     vendor: 'anthropic', accessTier: 'admin', costClass: '$$$', notes: 'High capability. Frontier reasoning.' },
    { id: 'claude-haiku-4.5',   label: 'Claude Haiku 4.5',      vendor: 'anthropic', accessTier: 'admin', costClass: '$$',  notes: 'Fast, cheaper. Good default for high-volume.' },
    { id: 'qwen2.5-coder:32b',  label: 'Qwen 2.5 Coder 32B',    vendor: 'ollama',    accessTier: 'open',  costClass: 'local', notes: 'Local. Code-focused.' },
    { id: 'qwen2.5:14b',        label: 'Qwen 2.5 14B',          vendor: 'ollama',    accessTier: 'open',  costClass: 'local', notes: 'Local. General purpose.' },
    { id: 'qwen3.5:9b',         label: 'Qwen 3.5 9B',           vendor: 'ollama',    accessTier: 'open',  costClass: 'local', notes: 'Local. Lightweight.' },
  ];

  return { TIERS, HARNESSES, INTEGRATIONS, PEOPLE, KEYS, TOOLS, MEMORY_SCOPES, MODELS, RECENT_LOGS, now };
})();
