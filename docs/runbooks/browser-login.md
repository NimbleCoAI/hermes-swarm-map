# Runbook: credentialless browser login (Phase 1)

How an agent gets an **authenticated** browser tab without the model ever seeing
the password. Companion to the design + build specs in the org memory
(`2026-06-10-browser-credential-isolation-design.md`,
`2026-06-22-credentialless-browser-login-phase1-build.md`) and the plugin at
`infra/templates/plugins/browser_login/`.

## What it does

1. The agent calls `browser_login(platform)`. The plugin navigates to the
   platform's authed-only page and checks the accessibility snapshot for a
   "logged in" text signal.
2. **Already logged in** → returns `{status:"authenticated"}`; the agent drives
   the existing session. The password was never in the model's context.
3. **Not logged in** → navigates to the login page and returns a
   `login_escalation` block with a `vnc_url` + screenshot. A human opens the VNC
   link, types the credentials **directly into the browser**, and the session
   persists in the agent's Camofox profile volume.
4. The agent polls `check_login_status(platform)` until it returns
   `authenticated`, then proceeds.

The password travels human-keyboard → Camofox. It never passes through the model.

## Operator setup

1. **Camofox + VPN/VNC mode on** for the agent (HSM agent settings → VPN toggle).
   This sets `CAMOFOX_URL` and `VNC_EXTERNAL_URL`. For *remote* human login, set
   the global `vncBindHost` setting to a Tailscale address (not loopback) — same
   requirement as CAPTCHA escalation.
2. **Define platform descriptors.** Set the global `platformLoginDescriptors`
   setting (via `PUT /api/settings`) — a JSON object keyed by platform:
   ```json
   {
     "example": {
       "login_url": "https://example.com/login",
       "authed_probe_url": "https://example.com/account",
       "authed_signal": "Sign out",
       "login_form_signal": "Password"
     }
   }
   ```
   On the next per-agent settings save, HSM writes this to the agent's
   `BROWSER_LOGIN_DESCRIPTORS` env var and recreates the container. Editing the
   setting + saving is the "hot edit" path — there is no in-place env reload.
   With no descriptor for a platform, `browser_login` returns a clear error.

## Security notes

- **`.camofox` volume holds session cookies.** After login, the session lives in
  the agent's profile volume at `{agentDataDir}/.camofox`. Treat it with the same
  access controls as the agent's `.env` (mode `0o600`). A compromised volume = a
  compromised session (blast radius limited by the session's TTL; treat
  long-lived "remember me" cookies as passwords).
- **Cookie residual (known, Phase 1).** The model never sees the password. It
  *can*, however, read the post-login **session cookie** via `document.cookie`
  through `browser_console` if Camofox's `/evaluate` endpoint is enabled (Camofox
  is CDP-less, so `Network.getAllCookies` is *not* reachable). This is an
  accepted Phase 1 residual: a session token is a lighter, TTL-bounded capability
  than a password. Closing it (gating `/evaluate` for credentialled agents) is a
  Phase 2 decision when the credential broker lands.
- **One session per agent.** Do not share a `.camofox` volume across agents.

## Limits (Phase 1)

- First login and any MFA step require the human-via-VNC path. Hands-free login
  (HSM broker + autofill via Camofox `/type`+`/click`) is Phase 2.
- The probe matches **text** in the accessibility snapshot, not CSS selectors —
  robust to UI churn but requires a sensible `authed_signal` per platform.
