# Design: CAPTCHA Cascade + WireGuard Sidecar for Hermes Agents

**Date:** 2026-06-02
**Author:** Juniper + Claude
**Status:** Spec
**Repos:** hermes-agent-mt, hermes-swarm-map

## Problem

Hermes agents using Camofox (anti-detection Firefox) for browser automation hit
two classes of failure:

1. **CAPTCHAs** (reCAPTCHA, hCaptcha, Cloudflare Turnstile) — Camofox has no
   CAPTCHA solving. The agent can screenshot and try vision AI, but that's
   unreliable for interactive challenges.

2. **IP reputation blocks** — Camofox has strong fingerprint spoofing but runs
   on the host's IP. Sites like Moshtix (Cloudflare-protected) ban the IP after
   detecting automation patterns, regardless of browser fingerprint.

A previous attempt (challenge-relay MCP) built a separate Playwright browser
with CapSolver + VNC. This failed because:
- Cookie handoff between two browsers (Firefox → Chromium) triggered extra detection
- Different fingerprints meant the target site saw a "new" browser
- Unnecessary complexity — Camofox already has VNC and JS eval

## Solution

Three independent components that compose into one flow:

### 1. captcha_cascade module (hermes-agent-mt)

A new module at `tools/captcha_cascade.py` that hooks into the browser tool's
existing bot-detection-warning path.

**Flow:**

```
browser_tool navigation/action completes
  → title matches blocked_patterns? (existing check)
  → captcha_cascade.try_solve(task_id)
      ├─ extract_sitekey(task_id) via _camofox_eval()
      │   ├─ .g-recaptcha[data-sitekey]
      │   ├─ iframe[src*="recaptcha"] → parse k= param
      │   ├─ .h-captcha[data-sitekey]
      │   ├─ iframe[src*="hcaptcha"] → parse sitekey= param
      │   └─ .cf-turnstile[data-sitekey]
      │
      ├─ CAPSOLVER_API_KEY set?
      │   ├─ yes → capsolver_solve(sitekey, page_url, captcha_type)
      │   │         ├─ POST createTask → poll getTaskResult (120s timeout)
      │   │         ├─ success → inject_token() via _camofox_eval()
      │   │         │            ├─ reCAPTCHA: set g-recaptcha-response + call callback
      │   │         │            ├─ hCaptcha: set h-captcha-response
      │   │         │            └─ Turnstile: set cf-turnstile-response + call callback
      │   │         └─ fail → escalate
      │   └─ no → escalate
      │
      └─ escalate:
          return {
            "captcha_escalation": {
              "vnc_url": camofox_vnc_url,
              "hint": "reCAPTCHA detected — CapSolver failed/unavailable",
              "screenshot": base64_screenshot
            }
          }
```

**Integration point in browser_tool.py:**

After the existing `blocked_patterns` check (~line 2436), before returning:

```python
if "bot_detection_warning" in response:
    from tools.captcha_cascade import try_solve
    cascade_result = await try_solve(task_id)
    if cascade_result and cascade_result.get("captcha_solved"):
        # Re-snapshot — page may have advanced
        response.pop("bot_detection_warning", None)
        response["captcha_solved"] = True
        response["captcha_method"] = cascade_result["method"]
    elif cascade_result and cascade_result.get("captcha_escalation"):
        response["captcha_escalation"] = cascade_result["captcha_escalation"]
```

**JS eval access:** `captcha_cascade.py` calls the Camofox `/tabs/{tab_id}/evaluate`
endpoint directly (same as `_camofox_eval` in browser_tool.py, but the cascade
module owns its own HTTP calls to avoid importing private functions). Falls back
gracefully if the endpoint returns 404/405.

**CapSolver API client:**

Ported from challenge-relay's proven implementation. Supports:
- `ReCaptchaV2TaskProxyLess`
- `HCaptchaTaskProxyLess`
- `AntiTurnstileTaskProxyLess`

120-second timeout, 3-second poll interval. Uses httpx async client.

**Environment:** `CAPSOLVER_API_KEY` in agent `.env`. No key = cascade skips
auto-solve and goes straight to VNC escalation.

**What the agent sees:**

```python
# Auto-solved (transparent — agent continues normally)
{"captcha_solved": True, "captcha_method": "capsolver"}

# Needs human intervention
{"captcha_escalation": {
    "vnc_url": "http://100.x.x.x:6080",
    "hint": "reCAPTCHA detected — CapSolver failed after 120s",
    "screenshot": "<base64>"
}}
```

On escalation, the agent DMs the user on their connected surface using its
existing `send_message` tool. No new notification infrastructure.

### 2. WireGuard Docker Sidecar

Camofox routes all browser traffic through a WireGuard container connected to
Mullvad VPN. Host networking (Tailscale) is untouched.

**Docker Compose pattern:**

```yaml
services:
  wireguard:
    image: lscr.io/linuxserver/wireguard:latest
    container_name: wg-${AGENT_NAME}
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    sysctls:
      - net.ipv4.conf.all.src_valid_mark=1
    volumes:
      - ${AGENT_DATA_DIR}/wg-config:/config
    ports:
      - published: ${CAMOFOX_PORT:-9377}
        target: 9377
      - published: ${VNC_PORT:-6080}
        target: 6080
    restart: unless-stopped

  camofox:
    image: camofox-browser:135.0.1-aarch64
    container_name: camofox-${AGENT_NAME}
    network_mode: "service:wireguard"
    depends_on:
      - wireguard
    environment:
      - CAMOFOX_PORT=9377
      - ENABLE_VNC=1
      - VNC_BIND=0.0.0.0
      - VNC_RESOLUTION=1920x1080
    volumes:
      - ${AGENT_DATA_DIR}/.camofox:/root/.camofox
    restart: unless-stopped
```

**Key mechanism:** `network_mode: "service:wireguard"` shares the WireGuard
container's network namespace. All Camofox traffic exits through the VPN
tunnel. Ports are exposed on the WireGuard container.

**Mullvad setup:** Download a WireGuard `.conf` from mullvad.net (pick a
server, e.g., nz-akl-wg-001 for NZ IP). Place at
`~/.hermes-{agent}/wg-config/wg0.conf`. ~$5/mo, no account info required.

**Tailscale isolation:** The VPN tunnel is container-scoped. The host's
Tailscale interface is untouched. No split-tunnel conflicts. No Little Snitch
interactions. This was the core problem with running Mullvad at the host level.

**HSM integration:**

`generateStandaloneCompose()` in `lib/services/harness.ts` gains an optional
WireGuard sidecar block. Controlled by:
- `vpnEnabled: boolean` in harness settings
- `vpnConfigPath: string` pointing to the WireGuard config file

When enabled, the compose template includes the WireGuard service and sets
Camofox's `network_mode` to route through it. When disabled, Camofox runs
with normal Docker networking (current behavior).

The setup wizard in `/api/setup/deploy` gets a "VPN" toggle that creates the
wg-config directory and prompts for config file placement.

### 3. VNC Escalation Behavior

No new infrastructure. Uses existing pieces:

1. Camofox `/health` → VNC URL (already cached in `_vnc_url`)
2. `camofox_navigate()` already returns `vnc_url` in responses
3. captcha_cascade adds `captcha_escalation` with VNC URL on failure
4. Agent DMs user via existing `send_message` tool

**Agent behavior** is taught via a skill installed in the agent's skills dir:

```markdown
# CAPTCHA Escalation

When browser_navigate or browser_click returns `captcha_escalation`:

1. Send the user a DM on your primary platform:
   - Include the VNC link
   - Attach the screenshot
   - Explain what you were trying to do and what blocked you
2. Wait for the user to reply "done" or similar
3. Call browser_snapshot to verify the page advanced past the challenge
4. If still blocked, tell the user and offer the VNC link again
5. Once clear, continue your original task
```

**VNC reachability:** With the WireGuard sidecar, VNC port is exposed on the
host via the WireGuard container's port mapping. Accessible at
`http://{tailscale-ip}:6080` from any device on the Tailscale mesh.

## Files Changed

| Repo | File | Change |
|------|------|--------|
| hermes-agent-mt | `tools/captcha_cascade.py` | New — CapSolver client + cascade orchestrator |
| hermes-agent-mt | `tools/browser_tool.py` | Hook cascade into bot-detection path (~5 lines) |
| hermes-agent-mt | `tests/tools/test_captcha_cascade.py` | New — unit tests for cascade logic |
| hermes-swarm-map | `lib/services/harness.ts` | WG sidecar in `generateStandaloneCompose()` |
| hermes-swarm-map | `lib/templates/config-yaml.ts` | No change needed |
| hermes-swarm-map | `app/api/harnesses/[id]/settings/route.ts` | vpnEnabled setting |
| hermes-swarm-map | `components/harness/settings-tab.tsx` | VPN toggle in UI |
| per-agent | `.env` | `CAPSOLVER_API_KEY=` |
| per-agent | `skills/captcha-escalation/` | Escalation behavior skill |

## Out of Scope

- **Challenge-relay MCP** — retired. Camofox + this cascade replaces it.
- **Browserbase fallback** — not needed with residential IP via WireGuard.
- **Camofox proxy support** — not needed. WireGuard sidecar handles IP at
  network level, no Camofox code changes.
- **Payment automation** — agent extracts payment URL or gives VNC link.
  Human completes payment. No attempt to automate Apple Pay/card entry.
- **2FA automation** — agent DMs user for codes. Same VNC escalation path.
- **Multiple VPN providers** — Mullvad only for now. WireGuard is standard,
  other providers can be swapped by replacing the .conf file.

## Risks

| Risk | Mitigation |
|------|------------|
| Camofox `/evaluate` endpoint returns 404 (not implemented in server version) | Graceful fallback — skip CapSolver, go straight to VNC escalation. Log a warning. |
| CapSolver fails on newer CAPTCHA versions | VNC escalation is always available. CapSolver is best-effort. |
| WireGuard container can't establish tunnel (firewall, bad config) | Health check on WG container. Camofox still works without VPN, just on host IP. |
| VNC URL not reachable from user's device | Depends on Tailscale being connected. Document that VNC requires Tailscale mesh access. |
| Mullvad IP also gets flagged eventually | Rotate server configs. Mullvad has 60+ locations. Could automate rotation. |

## Dependencies

- **Mullvad subscription** (~$5/mo) — user needs to purchase
- **CapSolver account** (optional, ~$0.003/solve) — user needs to sign up
- **Camofox `/evaluate` endpoint** — already exists in hermes-agent-mt's
  `_camofox_eval()`, but depends on the Camofox server version supporting it.
  If not supported, cascade degrades gracefully to VNC-only.

## Testing Strategy

1. **Unit tests** for captcha_cascade.py — mock CapSolver API, mock
   `_camofox_eval`, verify cascade logic (sitekey extraction, token injection,
   escalation fallback)
2. **Integration test** — spin up Camofox + WireGuard locally, navigate to
   a reCAPTCHA test page, verify CapSolver solves it
3. **End-to-end test** — agent browses Moshtix with VPN, hits CAPTCHA, solves
   or escalates, DMs user, user resolves via VNC, agent continues
4. **WireGuard health** — verify tunnel establishes, Camofox traffic exits
   via VPN IP (curl ifconfig.me from within Camofox container)
