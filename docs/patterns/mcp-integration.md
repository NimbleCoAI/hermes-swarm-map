# Adding an MCP Integration to HSM

This documents the repeatable pattern for wiring a new MCP server into the HSM deploy pipeline. Follow these steps to add any MCP server so agents get tools automatically on deploy.

## Overview

HSM auto-configures MCP servers by:
1. **Setup wizard** — user enables the integration via checkbox
2. **Deploy route** — injects env vars into Docker Compose + adds server to config.yaml
3. **Config template** — `generateDefaultConfig()` emits the `mcp_servers:` YAML section
4. **Agent startup** — Hermes reads config.yaml, launches MCP server subprocess with env vars

## Step-by-Step

### 1. Add wizard state (`app/(setup)/setup/wizard/page.tsx`)

Add a boolean to `WizardState`:
```typescript
  myMcpEnabled: boolean
```

Add to `INITIAL_STATE`:
```typescript
  myMcpEnabled: false,
```

Add checkbox UI in the Platforms step (follow the Google/GitHub pattern):
```tsx
<div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
  <label className="flex items-center gap-3 cursor-pointer">
    <input type="checkbox" checked={state.myMcpEnabled}
      onChange={(e) => update({ myMcpEnabled: e.target.checked })}
      className="accent-[var(--accent)]" />
    <div>
      <div className="font-medium text-sm">My MCP</div>
      <div className="text-xs text-muted-foreground">Description</div>
    </div>
  </label>
</div>
```

Pass to deploy POST: `myMcpEnabled: state.myMcpEnabled,`

Add to summary section.

### 2. Handle in deploy route (`app/api/setup/deploy/route.ts`)

Parse the flag:
```typescript
const myMcpEnabled = body.myMcpEnabled === true
```

Add to the `mcpServers` object:
```typescript
if (myMcpEnabled) {
  mcpServers.myMcp = {
    command: 'npx',
    args: ['-y', '@my-org/server-my-mcp'],
    env: { MY_API_KEY: '${MY_API_KEY}' },
  }
}
```

If the MCP needs Docker volumes or port mappings (like google-mcp needs for OAuth), add them to `generateCompose()`.

If the MCP just needs an env var (like GitHub), add it to the compose environment block.

### 3. Env var mapping

MCP servers often expect env var names different from what HSM stores. Map them:

| HSM Key Store Name | MCP Expected Env Var | MCP Server |
|---|---|---|
| `GITHUB_TOKEN` | `GITHUB_PERSONAL_ACCESS_TOKEN` | server-github |
| (Google OAuth tokens) | (volume-mounted) | google-mcp |

The mapping happens in Docker Compose `environment:` section, not in config.yaml.

### 4. Test

Add test cases to `lib/templates/config-yaml.test.ts` verifying:
- Config includes `mcp_servers.myMcp` when enabled
- Config excludes it when disabled
- Env var references use `${VAR}` syntax (never literal tokens)

### Reference implementations

- **GitHub** (env var only): simple — just command + args + env passthrough
- **Google** (volumes + ports + OAuth): complex — needs Docker volume mounts, port mapping for OAuth callback, and host directory resolution
