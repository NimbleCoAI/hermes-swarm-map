# Native Signal-CLI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace bbernhard/signal-cli-rest-api with native signal-cli daemon, port upstream Hermes adapter, and update swarm-map routes — aligning with upstream community patterns.

**Architecture:** Custom Docker image runs signal-cli in native HTTP daemon mode (SSE + JSON-RPC on port 8080). Upstream signal.py adapter is ported into hermes-swarm with DM gate additions. Swarm-map routes use docker exec for registration and JSON-RPC for runtime queries.

**Tech Stack:** Docker, signal-cli 0.14.1, Java 17, Python (Hermes adapter), Next.js/TypeScript (swarm-map routes)

---

### Task 1: Create signal-cli-native Docker image

**Files:**
- Create: `hermes-swarm-map/infra/signal-cli/Dockerfile`
- Create: `hermes-swarm-map/infra/signal-cli/docker-compose.yml`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
FROM eclipse-temurin:17-jre-alpine

RUN apk add --no-cache curl bash

ARG SIGNAL_CLI_VERSION=0.14.1
RUN curl -L "https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}-Linux.tar.gz" \
    | tar -xz -C /opt \
    && ln -s /opt/signal-cli-${SIGNAL_CLI_VERSION}/bin/signal-cli /usr/local/bin/signal-cli

VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:8080/api/v1/check || exit 1

ENTRYPOINT ["signal-cli", "--config", "/data", "daemon", "--http", "0.0.0.0:8080"]
```

- [ ] **Step 2: Create docker-compose.yml**

```yaml
services:
  signal-cli-daemon:
    build: .
    container_name: signal-cli-daemon
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ${HOME}/.hermes-swarm/signal-data:/data
    networks:
      - hermes-net

networks:
  hermes-net:
    external: true
```

- [ ] **Step 3: Build and verify the image**

Run on Mac Mini:
```bash
cd ~/Documents/GitHub/hermes-swarm-map/infra/signal-cli
docker compose build
```
Expected: Image builds successfully.

- [ ] **Step 4: Commit**

```bash
git add infra/signal-cli/
git commit -m "feat: add native signal-cli Docker image and compose"
```

---

### Task 2: Stop bbernhard, start native daemon

**Files:** None (infra operations only)

- [ ] **Step 1: Copy existing account data to new path format**

The bbernhard container mounts `~/.hermes-swarm/signal-data` at `/home/.local/share/signal-cli`. The new container mounts the same host path at `/data`. signal-cli uses `--config /data` which expects `data/` subdirectory inside. We need to restructure:

```bash
# On Mac Mini:
docker stop signal-cli-daemon
docker rm signal-cli-daemon

# The existing data is at ~/.hermes-swarm/signal-data/ with accounts.json and account files
# Native signal-cli with --config /data expects /data/data/ for accounts
# Move current contents into the right structure:
mkdir -p ~/.hermes-swarm/signal-data/data
# If there are existing files at the top level, move them:
mv ~/.hermes-swarm/signal-data/accounts.json ~/.hermes-swarm/signal-data/data/ 2>/dev/null || true
mv ~/.hermes-swarm/signal-data/598110* ~/.hermes-swarm/signal-data/data/ 2>/dev/null || true
```

Note: The existing account has `registered: false` so it won't be usable — fresh registration will be needed regardless. If the move fails or data is corrupted, it's fine to start fresh:
```bash
rm -rf ~/.hermes-swarm/signal-data/data
mkdir -p ~/.hermes-swarm/signal-data/data
```

- [ ] **Step 2: Start native container**

```bash
cd ~/Documents/GitHub/hermes-swarm-map/infra/signal-cli
docker compose up -d
```

- [ ] **Step 3: Verify health**

```bash
curl -s http://localhost:8080/api/v1/check
```
Expected: JSON response with `versions` field, e.g. `{"versions":["v1"]}`

If it returns a connection error, check logs:
```bash
docker logs signal-cli-daemon --tail 20
```

- [ ] **Step 4: Connect container to hermes-swarm network**

The hermes agent containers are on `hermes-swarm_hermes-net`. Connect the signal daemon to that network too:

```bash
docker network connect hermes-swarm_hermes-net signal-cli-daemon
```

Verify connectivity from an agent container:
```bash
docker exec hermes-cyborg curl -sf http://signal-cli-daemon:8080/api/v1/check
```

---

### Task 3: Port upstream signal adapter to hermes-swarm

**Files:**
- Replace: `hermes-swarm/gateway/platforms/signal.py`
- Create: `hermes-swarm/gateway/platforms/signal_rate_limit.py`

- [ ] **Step 1: Copy upstream adapter**

```bash
cp ~/Documents/GitHub/hermes-agent/gateway/platforms/signal.py ~/Documents/GitHub/hermes-swarm/gateway/platforms/signal.py
cp ~/Documents/GitHub/hermes-agent/gateway/platforms/signal_rate_limit.py ~/Documents/GitHub/hermes-swarm/gateway/platforms/signal_rate_limit.py
```

- [ ] **Step 2: Add swarm-map policy fallback to DM gate**

In `hermes-swarm/gateway/platforms/signal.py`, find the `_is_dm_allowed()` method (or equivalent allowlist check). After the `SIGNAL_ALLOWED_USERS` check, before the fail-closed return, add the swarm-map policy fallback:

```python
        # Fall back to Swarm-Map admin lookup
        policy_url = os.getenv("SWARM_MAP_POLICY_URL", "")
        if policy_url:
            try:
                from plugins.swarm_map_policy import is_platform_admin
                return is_platform_admin("signal", sender_id)
            except (ImportError, TypeError, Exception):
                pass
```

The upstream adapter already checks `SIGNAL_ALLOWED_USERS` env var, so the DM gate logic is mostly there. The fork adds:
1. The `SWARM_MAP_POLICY_URL` fallback (above)
2. An `_is_signal_admin()` method for admin-level access (check `SIGNAL_ADMIN_USERS` env var)

If upstream already has admin support, skip. If not, add after the DM gate method:

```python
    def _is_signal_admin(self, sender_id: str) -> bool:
        """Check if sender is a Signal admin (global memory access)."""
        admin_csv = os.getenv("SIGNAL_ADMIN_USERS", "").strip()
        if not admin_csv or not sender_id:
            return False
        admins = {u.strip() for u in admin_csv.split(",") if u.strip()}
        return sender_id in admins
```

- [ ] **Step 3: Verify no missing imports**

Check that `signal_rate_limit.py` and any other dependencies are present:
```bash
cd ~/Documents/GitHub/hermes-swarm
python -c "from gateway.platforms.signal import SignalAdapter; print('OK')"
```

If import errors, install missing deps or copy missing modules.

- [ ] **Step 4: Commit**

```bash
cd ~/Documents/GitHub/hermes-swarm
git add gateway/platforms/signal.py gateway/platforms/signal_rate_limit.py
git commit -m "feat: port upstream native signal-cli adapter with DM gate additions"
```

---

### Task 4: Rewrite swarm-map Signal health route

**Files:**
- Modify: `hermes-swarm-map/app/api/surfaces/signal/route.ts`

- [ ] **Step 1: Rewrite health endpoint for native JSON-RPC**

Replace contents of `app/api/surfaces/signal/route.ts`:

```typescript
import { NextResponse } from 'next/server'

const SIGNAL_API = process.env.SIGNAL_API_URL || 'http://localhost:8080'

export async function GET() {
  try {
    // Health check via native signal-cli daemon
    const healthRes = await fetch(`${SIGNAL_API}/api/v1/check`, {
      signal: AbortSignal.timeout(3000),
    })
    const healthy = healthRes.ok

    // List accounts via JSON-RPC
    let accounts: string[] = []
    if (healthy) {
      const rpcRes = await fetch(`${SIGNAL_API}/api/v1/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'listAccounts', id: '1' }),
        signal: AbortSignal.timeout(3000),
      })
      const rpcData = await rpcRes.json()
      // Result is array of account objects with "number" field
      if (Array.isArray(rpcData.result)) {
        accounts = rpcData.result.map((a: { number?: string }) => a.number || '')
      }
    }

    return NextResponse.json({ healthy, url: SIGNAL_API, accounts })
  } catch {
    return NextResponse.json({ healthy: false, url: SIGNAL_API, accounts: [] })
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd ~/Documents/GitHub/hermes-swarm-map
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add app/api/surfaces/signal/route.ts
git commit -m "fix: signal health route uses native JSON-RPC"
```

---

### Task 5: Rewrite swarm-map Signal register route

**Files:**
- Modify: `hermes-swarm-map/app/api/surfaces/signal/register/route.ts`

- [ ] **Step 1: Rewrite register endpoint for docker exec**

Replace contents of `app/api/surfaces/signal/register/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const CONTAINER = process.env.SIGNAL_CONTAINER || 'signal-cli-daemon'

export async function POST(request: Request) {
  const { phone, captcha } = await request.json() as { phone: string; captcha?: string }

  if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone)) {
    return NextResponse.json({ success: false, error: 'Invalid phone number (E.164 format required)' }, { status: 400 })
  }

  const captchaArg = captcha ? ` --captcha '${captcha.replace(/'/g, "'\\''")}'` : ''
  const cmd = `docker exec ${CONTAINER} signal-cli --config /data -a ${phone} register${captchaArg}`

  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 })
    const output = (stderr || '') + (stdout || '')

    // signal-cli exits 0 even on failure — always check output
    if (output.toLowerCase().includes('captcha')) {
      return NextResponse.json({ success: false, needsCaptcha: true, error: 'Captcha required — solve at https://signalcaptchas.org/registration/generate.html and paste the token' })
    }

    if (output.toLowerCase().includes('rate limit') || output.includes('429')) {
      return NextResponse.json({ success: false, error: 'Rate limited by Signal. Wait a few minutes and try again.' }, { status: 429 })
    }

    if (output.includes('Failed to register')) {
      const match = output.match(/Failed to register: (.+)/)?.[1]
      return NextResponse.json({ success: false, error: match || 'Registration failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    const err = error as { stderr?: string; stdout?: string; message?: string }
    const output = (err.stderr || '') + (err.stdout || '') + (err.message || '')

    if (output.toLowerCase().includes('captcha')) {
      return NextResponse.json({ success: false, needsCaptcha: true, error: 'Captcha required — solve at https://signalcaptchas.org/registration/generate.html and paste the token' })
    }

    if (output.toLowerCase().includes('rate limit') || output.includes('429')) {
      return NextResponse.json({ success: false, error: 'Rate limited by Signal. Wait a few minutes and try again.' }, { status: 429 })
    }

    const match = output.match(/Failed to register: (.+)/)?.[1] || output.split('\n').pop()
    return NextResponse.json({ success: false, error: match || 'Registration failed' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/surfaces/signal/register/route.ts
git commit -m "fix: signal register route uses docker exec against native daemon"
```

---

### Task 6: Rewrite swarm-map Signal verify route

**Files:**
- Modify: `hermes-swarm-map/app/api/surfaces/signal/verify/route.ts`

- [ ] **Step 1: Rewrite verify endpoint**

Replace contents of `app/api/surfaces/signal/verify/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const CONTAINER = process.env.SIGNAL_CONTAINER || 'signal-cli-daemon'
const SIGNAL_API = process.env.SIGNAL_API_URL || 'http://localhost:8080'

export async function POST(request: Request) {
  const { phone, code, displayName } = await request.json() as {
    phone: string; code: string; displayName?: string
  }

  if (!phone || !code) {
    return NextResponse.json({ success: false, error: 'Phone and code required' }, { status: 400 })
  }

  if (!/^\d{6}$/.test(code.replace(/[- ]/g, ''))) {
    return NextResponse.json({ success: false, error: 'Code must be 6 digits' }, { status: 400 })
  }

  const cleanCode = code.replace(/[- ]/g, '')

  try {
    const { stdout, stderr } = await execAsync(
      `docker exec ${CONTAINER} signal-cli --config /data -a ${phone} verify ${cleanCode}`,
      { timeout: 30000 }
    )
    const output = (stderr || '') + (stdout || '')

    // Check for failure even on exit code 0
    if (output.includes('Failed to verify') || output.includes('Invalid verification code')) {
      const match = output.match(/Failed to verify: (.+)/)?.[1] || 'Verification failed'
      return NextResponse.json({ success: false, error: match }, { status: 400 })
    }

    // Confirm registration succeeded via JSON-RPC
    try {
      const rpcRes = await fetch(`${SIGNAL_API}/api/v1/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'listAccounts', id: '1' }),
        signal: AbortSignal.timeout(5000),
      })
      const rpcData = await rpcRes.json()
      const registered = Array.isArray(rpcData.result) &&
        rpcData.result.some((a: { number?: string }) => a.number === phone)
      if (!registered) {
        return NextResponse.json({ success: false, error: 'Verification appeared to succeed but account not found in daemon. Try again.' }, { status: 500 })
      }
    } catch {
      // Non-fatal — verification likely worked, just can't confirm
    }

    // Set display name if provided
    if (displayName) {
      await execAsync(
        `docker exec ${CONTAINER} signal-cli --config /data -a ${phone} updateProfile --given-name '${displayName.replace(/'/g, "'\\''")}'`,
        { timeout: 15000 }
      ).catch(() => {})
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    const err = error as { stderr?: string; stdout?: string; message?: string }
    const output = (err.stderr || '') + (err.stdout || '') + (err.message || '')
    const match = output.match(/Failed to verify: (.+)/)?.[1] || 'Verification failed'
    return NextResponse.json({ success: false, error: match }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/surfaces/signal/verify/route.ts
git commit -m "fix: signal verify route uses docker exec + JSON-RPC confirmation"
```

---

### Task 7: Rewrite swarm-map Signal groups route

**Files:**
- Modify: `hermes-swarm-map/app/api/surfaces/signal/groups/route.ts`

- [ ] **Step 1: Rewrite groups endpoint for JSON-RPC**

Replace contents of `app/api/surfaces/signal/groups/route.ts`:

```typescript
import { NextResponse } from 'next/server'

const SIGNAL_API = process.env.SIGNAL_API_URL || 'http://localhost:8080'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const phone = searchParams.get('phone')

  if (!phone) {
    return NextResponse.json({ error: 'phone param required' }, { status: 400 })
  }

  try {
    const rpcRes = await fetch(`${SIGNAL_API}/api/v1/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'listGroups',
        id: '1',
        params: { account: phone },
      }),
      signal: AbortSignal.timeout(15000),
    })

    const rpcData = await rpcRes.json()

    if (rpcData.error) {
      return NextResponse.json({ error: rpcData.error.message || 'Failed to list groups', groups: [] }, { status: 500 })
    }

    // Result is array of group objects with id, name, isMember, isBlocked
    const groups = Array.isArray(rpcData.result)
      ? rpcData.result.map((g: { id?: string; name?: string; isBlocked?: boolean; isMember?: boolean }) => ({
          id: g.id || '',
          name: g.name || 'Unknown',
          active: g.isMember !== false && !g.isBlocked,
        }))
      : []

    return NextResponse.json({ groups })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to list groups'
    return NextResponse.json({ error: msg, groups: [] }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add app/api/surfaces/signal/groups/route.ts
git commit -m "fix: signal groups route uses native JSON-RPC"
```

---

### Task 8: Update harness .env files and rebuild

**Files:** None in repo (runtime config on Mac Mini)

- [ ] **Step 1: Update cyborg's SIGNAL_HTTP_URL**

```bash
ssh juni@junis-mac-mini.local "export PATH=/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:\$PATH && \
  sed -i '' 's|SIGNAL_HTTP_URL=http://host.docker.internal:8080|SIGNAL_HTTP_URL=http://signal-cli-daemon:8080|' ~/.hermes-cyborg/.env"
```

- [ ] **Step 2: Update seraph-generalist's SIGNAL_HTTP_URL**

```bash
ssh juni@junis-mac-mini.local "export PATH=/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:\$PATH && \
  sed -i '' 's|SIGNAL_HTTP_URL=http://host.docker.internal:8080|SIGNAL_HTTP_URL=http://signal-cli-daemon:8080|' ~/.hermes-seraph-generalist/.env"
```

- [ ] **Step 3: Rebuild hermes-swarm image (new adapter)**

```bash
ssh juni@junis-mac-mini.local "export PATH=/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:\$PATH && \
  cd ~/Documents/GitHub/hermes-swarm && docker compose build"
```

- [ ] **Step 4: Restart affected agents**

```bash
ssh juni@junis-mac-mini.local "export PATH=/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:\$PATH && \
  cd ~/Documents/GitHub/hermes-swarm && docker compose restart hermes-cyborg hermes-seraph-generalist"
```

---

### Task 9: Build and deploy swarm-map, register number

**Files:** None (deployment + registration)

- [ ] **Step 1: Push swarm-map changes and rebuild on Mac Mini**

```bash
cd ~/Documents/GitHub/hermes-swarm-map
git push origin dev/juniper/signal-native-migration
# Merge to main, then on Mac Mini:
ssh juni@junis-mac-mini.local "export PATH=/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:\$PATH && \
  cd ~/Documents/GitHub/hermes-swarm-map && git pull origin main && npm run build"
```

Restart dev server:
```bash
ssh juni@junis-mac-mini.local "export PATH=/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:\$PATH && \
  kill \$(lsof -ti :3002) 2>/dev/null; sleep 1 && \
  cd ~/Documents/GitHub/hermes-swarm-map && nohup npx next dev --port 3002 > /tmp/swarm-map.log 2>&1 &"
```

- [ ] **Step 2: Verify health endpoint shows healthy**

```bash
ssh juni@junis-mac-mini.local "export PATH=/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:\$PATH && \
  curl -s http://localhost:3002/api/surfaces/signal"
```

Expected: `{"healthy":true,"url":"http://localhost:8080","accounts":[]}`

- [ ] **Step 3: Register +14474507704 via swarm-map UI**

Open http://junis-mac-mini.local:3002, navigate to cyborg harness, connect Signal surface. The captcha flow should work end-to-end now.

After registration:
```bash
curl -s http://localhost:3002/api/surfaces/signal
```
Expected: `{"healthy":true,"url":"http://localhost:8080","accounts":["+14474507704"]}`

- [ ] **Step 4: End-to-end test**

Send a Signal message to +14474507704. Verify cyborg responds.

---

### Task 10: Cleanup and final commit

**Files:**
- Modify: `hermes-swarm-map/docs/ROADMAP-surfaces.md`

- [ ] **Step 1: Mark roadmap items complete**

In `docs/ROADMAP-surfaces.md`, change:
```
- [ ] **Register Signal on Mac Mini**
```
to:
```
- [x] **Register Signal on Mac Mini** — native signal-cli daemon, registered via swarm-map
```

- [ ] **Step 2: Final commit**

```bash
git add docs/ROADMAP-surfaces.md
git commit -m "docs: mark Signal registration complete in roadmap"
```
