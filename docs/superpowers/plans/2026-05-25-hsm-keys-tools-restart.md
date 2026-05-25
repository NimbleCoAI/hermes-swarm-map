# HSM Keys UI, Tools Default-On, Auto-Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add key management UI to harness detail pages, default all tools to on, and auto-restart harnesses after config changes.

**Architecture:** Extend the existing harness detail page (`app/(dashboard)/harnesses/[id]/page.tsx`) with inline key add/assign/unassign UI and update the tools service to default `reviewed: true`. Add an API endpoint to write keys to harness `.env` files, and trigger auto-restart after key/model changes. All env writes use read-modify-write pattern to avoid clobbering.

**Tech Stack:** Next.js (App Router), React, TypeScript, Tailwind CSS, `fs` for env file operations

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/services/keys.ts` | Modify | Add `writeKeyToEnv()` method, extend `add()` to accept `assignedTo` |
| `lib/services/tools.ts` | Modify | Change `reviewed` default to `true` |
| `app/api/keys/route.ts` | Modify | Accept `assignedTo` in POST, write key to harness `.env` |
| `app/api/keys/[id]/route.ts` | Modify | On `assignedTo` update, sync key to/from harness `.env` files |
| `app/(dashboard)/harnesses/[id]/page.tsx` | Modify | Add key form, assign dropdown, unassign button; remove "Pending" review column |
| `app/api/harnesses/[id]/models/route.ts` | Modify | Trigger quick restart after model save |

---

### Task 1: Default tools to reviewed=true

**Files:**
- Modify: `lib/services/tools.ts:144`

- [ ] **Step 1: Change reviewed default in tool discovery**

In `lib/services/tools.ts`, line 144, change `reviewed: false` to `reviewed: true`:

```typescript
// In discoverTools(), inside the tool object creation (~line 138-148)
const tool: Tool = {
  id,
  name: rawName,
  source,
  risk: defaultRisk(source),
  allowedTiers: ['individual', 'team', 'org', 'orgpublic', 'public'] as HabitatTier[],
  reviewed: true,  // was: false
  description: `Discovered from agent: ${name}`,
}
```

- [ ] **Step 2: Update the harness detail page to remove "Pending" label**

In `app/(dashboard)/harnesses/[id]/page.tsx`, replace the "Reviewed" column content (lines 910-913). Change the ternary to show a checkmark or nothing:

```tsx
<td className="px-4 py-3">
  <span className="text-[var(--success)]">✓</span>
</td>
```

Also rename the column header from "Reviewed" to "Status" (line 879):

```tsx
<th className="text-left px-4 py-3">Status</th>
```

- [ ] **Step 3: Default empty tools array to "all tools"**

In `app/(dashboard)/harnesses/[id]/page.tsx`, update the `harnessTools` and `enabled` logic. Around line 403, change:

```typescript
// Old:
const harnessTools = tools?.filter((t) => harness.tools.includes(t.id)) ?? []

// New: empty tools array means "all enabled"
const allToolsEnabled = harness.tools.length === 0
const harnessTools = allToolsEnabled ? (tools ?? []) : tools?.filter((t) => harness.tools.includes(t.id)) ?? []
```

And in the tools table (line 884), update the `enabled` check:

```typescript
const enabled = allToolsEnabled || harness.tools.includes(t.id)
```

- [ ] **Step 4: Update tab header to reflect default-all**

In line 458, update the tools tab trigger:

```tsx
<TabsTrigger value="tools">Tools ({allToolsEnabled ? allTools.length : harnessTools.length}/{allTools.length})</TabsTrigger>
```

- [ ] **Step 5: Verify in browser**

Run: Navigate to any harness detail page → Tools tab.
Expected: All tools show as enabled (toggle on), Status column shows ✓ for all, tab header shows e.g. "Tools (31/31)".

- [ ] **Step 6: Commit**

```bash
git add lib/services/tools.ts app/\(dashboard\)/harnesses/\[id\]/page.tsx
git commit -m "feat: default all tools to reviewed/enabled, remove pending state"
```

---

### Task 2: Add key management UI to harness detail page

**Files:**
- Modify: `app/(dashboard)/harnesses/[id]/page.tsx` (keys tab section, lines 926-941)
- Modify: `app/api/keys/route.ts`
- Modify: `app/api/keys/[id]/route.ts`
- Modify: `lib/services/keys.ts`

- [ ] **Step 1: Extend KeysService.add() to accept assignedTo**

In `lib/services/keys.ts`, update the `add()` method to accept and store `assignedTo`:

```typescript
add(input: KeyInput & { assignedTo?: string[] }): Key {
  const stored = this.storage.read<StoredKey[]>(KEYS_FILE, [])
  const newKey: StoredKey = {
    id: generateId(),
    provider: input.provider,
    maskedValue: maskValue(input.value),
    encryptedValue: this.encryption.encrypt(input.value),
    assignedTo: input.assignedTo ?? [],
    budgetUsd: input.budgetUsd,
    health: 'good',
    manuallyAdded: true,
  }
  stored.push(newKey)
  this.storage.write(KEYS_FILE, stored)
  this.audit.append({ who: 'admin', what: 'key:add', target: input.provider })
  const { encryptedValue: _, manuallyAdded: __, ...key } = newKey
  return key
}
```

- [ ] **Step 2: Add writeKeyToEnv() method to KeysService**

Add a new method to `lib/services/keys.ts` that writes a key to a harness's `.env` file using read-modify-write:

```typescript
// Map provider to env var name
private static PROVIDER_TO_VAR: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  github: 'GITHUB_TOKEN',
  mattermost: 'MATTERMOST_TOKEN',
  telegram: 'TELEGRAM_BOT_TOKEN',
  signal: 'SIGNAL_ACCOUNT',
  notion: 'NOTION_API_KEY',
  aws: 'AWS_ACCESS_KEY_ID',
  'aws-bedrock': 'AWS_BEARER_TOKEN_BEDROCK',
  'google-cloud': 'GOOGLE_CLOUD_API_KEY',
  brave: 'BRAVE_SEARCH_API_KEY',
  helius: 'HELIUS_API_KEY',
  coingecko: 'COINGECKO_API_KEY',
  dehashed: 'DEHASHED_API_KEY',
  opencorporates: 'OPENCORPORATES_API_KEY',
  capsolver: 'CAPSOLVER_API_KEY',
  'open-measures': 'OPEN_MEASURES_API_KEY',
  pexels: 'PEXELS_API_KEY',
}

writeKeyToEnv(harnessName: string, provider: string, value: string): void {
  const varName = KeysService.PROVIDER_TO_VAR[provider] ?? `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`
  const dataDir = agentDataDir(harnessName)
  const envPath = path.join(dataDir, '.env')

  let content = ''
  try {
    content = fs.readFileSync(envPath, 'utf-8')
  } catch {
    // .env doesn't exist yet — will create
  }

  // Check if var already exists — replace it; otherwise append
  const regex = new RegExp(`^${varName}=.*$`, 'm')
  if (regex.test(content)) {
    content = content.replace(regex, `${varName}=${value}`)
  } else {
    content = content.trimEnd() + `\n${varName}=${value}\n`
  }

  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(envPath, content, { mode: 0o600 })
}

removeKeyFromEnv(harnessName: string, provider: string): void {
  const varName = KeysService.PROVIDER_TO_VAR[provider] ?? `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`
  const dataDir = agentDataDir(harnessName)
  const envPath = path.join(dataDir, '.env')

  try {
    let content = fs.readFileSync(envPath, 'utf-8')
    const regex = new RegExp(`^${varName}=.*\n?`, 'm')
    content = content.replace(regex, '')
    fs.writeFileSync(envPath, content, { mode: 0o600 })
  } catch {
    // .env doesn't exist, nothing to remove
  }
}
```

- [ ] **Step 3: Update POST /api/keys to write to harness .env**

In `app/api/keys/route.ts`, update POST handler to accept `assignedTo` and write the key value to each assigned harness's `.env`:

```typescript
export async function POST(request: Request) {
  const body = await request.json()
  const key = services.keys.add(body)

  // Write key to assigned harnesses' .env files
  if (body.assignedTo?.length && body.value) {
    for (const harnessId of body.assignedTo) {
      services.keys.writeKeyToEnv(harnessId, body.provider, body.value)
    }
  }

  return NextResponse.json(key, { status: 201 })
}
```

- [ ] **Step 4: Update PUT /api/keys/[id] to sync .env on assignedTo change**

In `app/api/keys/[id]/route.ts`, when `assignedTo` changes, write/remove the key from the relevant harness `.env` files:

```typescript
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  // Get current state before update
  const currentKeys = services.keys.list()
  const currentKey = currentKeys.find((k) => k.id === id)

  const key = services.keys.update(id, body)
  if (!key) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // If assignedTo changed, sync .env files
  if (body.assignedTo && currentKey) {
    const decrypted = services.keys.getDecryptedValue(id)
    if (decrypted) {
      const added = body.assignedTo.filter((h: string) => !currentKey.assignedTo.includes(h))
      const removed = currentKey.assignedTo.filter((h: string) => !body.assignedTo.includes(h))

      for (const h of added) {
        services.keys.writeKeyToEnv(h, key.provider, decrypted)
      }
      for (const h of removed) {
        services.keys.removeKeyFromEnv(h, key.provider)
      }
    }
  }

  return NextResponse.json(key)
}
```

- [ ] **Step 5: Add key management UI state to harness page**

In `app/(dashboard)/harnesses/[id]/page.tsx`, add state variables after the existing state declarations (~line 147):

```typescript
// Key management state
const [showAddKey, setShowAddKey] = useState(false)
const [newKeyProvider, setNewKeyProvider] = useState('')
const [newKeyValue, setNewKeyValue] = useState('')
const [newKeyBudget, setNewKeyBudget] = useState('')
const [keySaving, setKeySaving] = useState(false)
const [showAssignKey, setShowAssignKey] = useState(false)
```

Also add the provider list constant near the top of the component:

```typescript
const KEY_PROVIDERS = [
  'anthropic', 'openai', 'notion', 'github', 'telegram', 'signal',
  'mattermost', 'aws', 'aws-bedrock', 'google-cloud', 'brave',
  'helius', 'coingecko', 'dehashed', 'opencorporates', 'capsolver',
  'open-measures', 'pexels',
]
```

- [ ] **Step 6: Add addKeyToHarness function**

Add after the `toggleTool` function:

```typescript
async function addKeyToHarness() {
  if (!harness || !newKeyProvider || !newKeyValue) return
  setKeySaving(true)
  try {
    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: newKeyProvider,
        value: newKeyValue,
        assignedTo: [harness.id],
        ...(newKeyBudget ? { budgetUsd: parseFloat(newKeyBudget) } : {}),
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast.error(err.error ?? 'Failed to add key')
      return
    }
    toast.success(`${newKeyProvider} key added`)
    setShowAddKey(false)
    setNewKeyProvider('')
    setNewKeyValue('')
    setNewKeyBudget('')
    // Trigger restart for the harness to pick up new env
    await fetch(`/api/harnesses/${id}/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'quick' }),
    })
    toast.success('Restarting agent to apply key...')
    refetch()
    // Refresh keys list
    window.location.reload()
  } catch {
    toast.error('Failed to add key')
  } finally {
    setKeySaving(false)
  }
}

async function assignExistingKey(keyId: string) {
  if (!harness) return
  const key = keys?.find((k) => k.id === keyId)
  if (!key) return
  setKeySaving(true)
  try {
    const res = await fetch(`/api/keys/${keyId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignedTo: [...key.assignedTo, harness.id],
      }),
    })
    if (!res.ok) {
      toast.error('Failed to assign key')
      return
    }
    toast.success(`${key.provider} key assigned`)
    setShowAssignKey(false)
    await fetch(`/api/harnesses/${id}/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'quick' }),
    })
    toast.success('Restarting agent to apply key...')
    refetch()
    window.location.reload()
  } catch {
    toast.error('Failed to assign key')
  } finally {
    setKeySaving(false)
  }
}

async function unassignKey(keyId: string) {
  if (!harness) return
  const key = keys?.find((k) => k.id === keyId)
  if (!key) return
  setKeySaving(true)
  try {
    const res = await fetch(`/api/keys/${keyId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignedTo: key.assignedTo.filter((h) => h !== harness.id),
      }),
    })
    if (!res.ok) {
      toast.error('Failed to unassign key')
      return
    }
    toast.success(`${key.provider} key removed`)
    await fetch(`/api/harnesses/${id}/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'quick' }),
    })
    toast.success('Restarting agent to apply...')
    refetch()
    window.location.reload()
  } catch {
    toast.error('Failed to unassign key')
  } finally {
    setKeySaving(false)
  }
}
```

- [ ] **Step 7: Replace keys tab UI with full management interface**

Replace the keys TabsContent (lines 926-941) with:

```tsx
<TabsContent value="keys" className="mt-4">
  <div className="space-y-3">
    {/* Action buttons */}
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowAddKey(!showAddKey)}
      >
        + Add Key
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowAssignKey(!showAssignKey)}
      >
        Assign Existing
      </Button>
    </div>

    {/* Add new key form */}
    {showAddKey && (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
        <h4 className="text-sm font-medium">Add New Key</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Provider</label>
            <select
              value={newKeyProvider}
              onChange={(e) => setNewKeyProvider(e.target.value)}
              className="w-full mt-1 text-sm border border-[var(--border)] rounded-md px-2 py-1.5 bg-[var(--surface)]"
            >
              <option value="">Select provider...</option>
              {KEY_PROVIDERS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Budget ($/mo)</label>
            <input
              type="number"
              value={newKeyBudget}
              onChange={(e) => setNewKeyBudget(e.target.value)}
              placeholder="Optional"
              className="w-full mt-1 text-sm border border-[var(--border)] rounded-md px-2 py-1.5 bg-[var(--surface)]"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">API Key</label>
          <input
            type="password"
            value={newKeyValue}
            onChange={(e) => setNewKeyValue(e.target.value)}
            placeholder="sk-ant-..., secret_..., etc."
            className="w-full mt-1 text-sm font-mono border border-[var(--border)] rounded-md px-2 py-1.5 bg-[var(--surface)]"
          />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={addKeyToHarness}
            disabled={!newKeyProvider || !newKeyValue || keySaving}
          >
            {keySaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Add & Restart
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setShowAddKey(false); setNewKeyProvider(''); setNewKeyValue(''); setNewKeyBudget('') }}
          >
            Cancel
          </Button>
        </div>
      </div>
    )}

    {/* Assign existing key dropdown */}
    {showAssignKey && (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
        <h4 className="text-sm font-medium">Assign Existing Key</h4>
        {(() => {
          const unassigned = keys?.filter((k) => !k.assignedTo.includes(harness.id)) ?? []
          if (unassigned.length === 0) {
            return <p className="text-sm text-muted-foreground">No unassigned keys available.</p>
          }
          return (
            <div className="space-y-2">
              {unassigned.map((k) => (
                <div key={k.id} className="flex items-center justify-between p-2 rounded border border-[var(--border)]">
                  <div>
                    <span className="text-sm font-medium">{k.provider}</span>
                    <span className="text-xs font-mono text-muted-foreground ml-2">{k.maskedValue}</span>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => assignExistingKey(k.id)} disabled={keySaving}>
                    Assign
                  </Button>
                </div>
              ))}
            </div>
          )
        })()}
        <Button variant="ghost" size="sm" onClick={() => setShowAssignKey(false)}>Cancel</Button>
      </div>
    )}

    {/* Current keys list */}
    {harnessKeys.map((k) => (
      <div key={k.id} className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div>
          <p className="font-medium text-sm">{k.provider}</p>
          <p className="text-xs font-mono text-muted-foreground">{k.maskedValue}</p>
        </div>
        <div className="flex items-center gap-3">
          {k.budgetUsd && (
            <span className="text-xs text-muted-foreground">${k.budgetUsd}/mo</span>
          )}
          <button
            onClick={() => unassignKey(k.id)}
            className="text-muted-foreground hover:text-[var(--destructive)] transition-colors"
            title="Unassign from this harness"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    ))}
    {harnessKeys.length === 0 && !showAddKey && !showAssignKey && (
      <p className="text-sm text-muted-foreground">No keys assigned.</p>
    )}
  </div>
</TabsContent>
```

- [ ] **Step 8: Verify in browser**

Navigate to harness detail → Keys tab.
Expected: See "Add Key" and "Assign Existing" buttons. Existing keys show with X to unassign. Adding a new key writes to `.env` and triggers restart.

- [ ] **Step 9: Commit**

```bash
git add lib/services/keys.ts app/api/keys/ app/\(dashboard\)/harnesses/\[id\]/page.tsx
git commit -m "feat: add key management UI to harness detail — add, assign, unassign with auto-restart"
```

---

### Task 3: Auto-restart after model cascade changes

**Files:**
- Modify: `app/(dashboard)/harnesses/[id]/page.tsx` (model save handler)

- [ ] **Step 1: Find the model save handler**

In `app/(dashboard)/harnesses/[id]/page.tsx`, locate the model cascade save function. It calls `PUT /api/harnesses/${id}/models`. After a successful save, add a quick restart call.

Search for the `modelSaving` state usage to find the save function, then add after the successful response:

```typescript
// After successful model save response:
await fetch(`/api/harnesses/${id}/restart`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'quick' }),
})
toast.success('Restarting agent to apply model changes...')
```

- [ ] **Step 2: Verify in browser**

Change model cascade on a harness, save. Expected: Toast says "Restarting agent to apply model changes..." and harness restarts.

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/harnesses/\[id\]/page.tsx
git commit -m "feat: auto-restart harness after model cascade changes"
```

---

### Task 4: Env write safety audit

**Files:**
- Review: `app/api/harnesses/[id]/settings/route.ts` (existing env write pattern)
- Modify: `lib/services/keys.ts` (ensure writeKeyToEnv is safe)

- [ ] **Step 1: Verify writeKeyToEnv uses read-modify-write**

Confirm the `writeKeyToEnv` method from Task 2 Step 2:
1. Reads existing `.env` content first
2. Uses regex to find-and-replace existing var, or appends if new
3. Writes back with `mode: 0o600` (owner-only permissions)
4. Creates directory if it doesn't exist
5. Never overwrites the entire file from scratch

This is already handled in the implementation from Task 2 Step 2. Just verify the code matches.

- [ ] **Step 2: Verify removeKeyFromEnv only removes the target line**

Confirm the `removeKeyFromEnv` method:
1. Reads existing content
2. Removes only the line matching `^VAR_NAME=.*\n?`
3. Writes back
4. Does not affect other env vars

Already handled in Task 2 Step 2. Verify.

- [ ] **Step 3: Commit (if any fixes needed)**

```bash
git add lib/services/keys.ts
git commit -m "fix: ensure env writes use safe read-modify-write pattern"
```
