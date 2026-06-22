"""Browser Login Plugin — credentialless authenticated browser sessions (Phase 1).

Lets an agent obtain an *authenticated* browser tab without the model ever
seeing the plaintext credential. Phase 1 strategy = persistent Camofox profile
+ one-time human VNC login:

  1. `browser_login(platform)` probes whether the agent already has a valid
     session for `platform` (navigate to an authed-only page, look for an
     "authenticated" text signal in the accessibility snapshot).
  2. If authenticated → return {status: "authenticated"} and the agent drives
     the already-logged-in tab. The password was never in the model's context.
  3. If not → navigate to the login page and return a `login_escalation` block
     (vnc_url + screenshot). A human opens the VNC link, types the credentials
     directly into the real browser, and the resulting session persists in the
     Camofox profile volume. The model never constructs a call containing the
     password — the human typed it into pixels.
  4. `check_login_status(platform)` re-probes; the agent polls it (with its own
     attempt budget) until the human has logged in.

The password→browser path bypasses the model entirely. The model only ever sees
status strings ("authenticated" / "login_required") and a VNC URL.

Configuration:
- CAMOFOX_URL: Required. URL of the Camofox browser server.
- VNC_EXTERNAL_URL: Externally-reachable noVNC URL (HSM writes it when VPN mode
  is enabled). Without it, escalation falls back to the Camofox /health port,
  which a remote human usually cannot reach.
- BROWSER_LOGIN_DESCRIPTORS: Optional JSON object keyed by platform, merged over
  the bundled DEFAULT_DESCRIPTORS. HSM writes it from operator-editable settings.

Design: memory/specs/2026-06-22-credentialless-browser-login-phase1-build.md
"""

import json
import logging
import os
from typing import Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

try:
    import requests
except ImportError:
    requests = None


# ---------------------------------------------------------------------------
# Bundled default platform descriptors (D3 — env merges over these)
# ---------------------------------------------------------------------------
#
# A descriptor tells the probe where to look and what "logged in" / "logged out"
# looks like, by matching *text* in the accessibility snapshot (selector-free,
# robust to UI churn). Operators override/extend via BROWSER_LOGIN_DESCRIPTORS.
#
# Intentionally empty by default: real platforms are operator-configured per
# deployment (no platform names baked into the shared/sanitized template). The
# schema is exercised by tests and documented in the design spec §4.
DEFAULT_DESCRIPTORS: dict = {}


# ---------------------------------------------------------------------------
# Camofox / VNC helpers (copied from captcha_cascade — D2: keep plugin
# self-contained rather than sharing a module for one more consumer)
# ---------------------------------------------------------------------------


def _camofox_url() -> str:
    """Get Camofox URL from environment."""
    return os.environ.get("CAMOFOX_URL", "").rstrip("/")


def _vnc_url() -> Optional[str]:
    """Get the externally-reachable VNC URL for human login escalation.

    Prefers VNC_EXTERNAL_URL (HSM writes the externally-reachable host+port when
    VPN mode is on). The Camofox /health fallback only knows the internal noVNC
    port built from CAMOFOX_URL (host.docker.internal), which a remote human
    cannot reach — so it's a last resort.
    """
    external = os.environ.get("VNC_EXTERNAL_URL", "").strip().rstrip("/")
    if external:
        return external

    url = _camofox_url()
    if not url:
        return None
    try:
        resp = requests.get(f"{url}/health", timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            vnc_port = data.get("vncPort")
            if isinstance(vnc_port, int):
                parsed = urlparse(url)
                host = parsed.hostname or "localhost"
                return f"http://{host}:{vnc_port}"
    except Exception:
        pass
    return None


def _screenshot() -> str:
    """Get a screenshot from Camofox as base64 (empty string on any failure)."""
    url = _camofox_url()
    if not url:
        return ""
    try:
        tabs_resp = requests.get(f"{url}/tabs", timeout=5)
        if tabs_resp.status_code != 200:
            return ""
        tabs = tabs_resp.json()
        if not tabs or not isinstance(tabs, list):
            return ""
        tab = tabs[0]
        tab_id = tab.get("tabId") or tab.get("id")
        user_id = tab.get("userId", "default")
        resp = requests.get(
            f"{url}/tabs/{tab_id}/screenshot",
            params={"userId": user_id},
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            return data.get("screenshot", "")
    except Exception:
        pass
    return ""


def _first_tab() -> Optional[dict]:
    """Return the first Camofox tab dict, or None."""
    url = _camofox_url()
    if not url:
        return None
    try:
        tabs_resp = requests.get(f"{url}/tabs", timeout=5)
        if tabs_resp.status_code != 200:
            return None
        tabs = tabs_resp.json()
        if tabs and isinstance(tabs, list):
            return tabs[0]
    except Exception:
        pass
    return None


def _navigate(target_url: str, task_id: str = "default") -> bool:
    """Navigate the active Camofox tab to target_url. Returns success bool."""
    url = _camofox_url()
    if not url:
        return False
    tab = _first_tab()
    if not tab:
        return False
    tab_id = tab.get("tabId") or tab.get("id")
    user_id = tab.get("userId", "default")
    try:
        resp = requests.post(
            f"{url}/tabs/{tab_id}/navigate",
            json={"url": target_url, "userId": user_id},
            timeout=30,
        )
        return resp.status_code == 200
    except Exception:
        return False


def _snapshot_text(task_id: str = "default") -> str:
    """Return the active tab's accessibility snapshot as a single text blob.

    The whole snapshot response is stringified so text-signal matching is robust
    to the exact JSON shape (snapshot/tree/accessibility — all become searchable
    text). Empty string on any failure.
    """
    url = _camofox_url()
    if not url:
        return ""
    tab = _first_tab()
    if not tab:
        return ""
    tab_id = tab.get("tabId") or tab.get("id")
    user_id = tab.get("userId", "default")
    try:
        resp = requests.get(
            f"{url}/tabs/{tab_id}/snapshot",
            params={"userId": user_id},
            timeout=10,
        )
        if resp.status_code != 200:
            return ""
        data = resp.json()
        if isinstance(data, str):
            return data
        return json.dumps(data)
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Platform descriptor resolution (D3)
# ---------------------------------------------------------------------------


def _get_descriptors() -> dict:
    """Return platform descriptors: env (BROWSER_LOGIN_DESCRIPTORS) merged over
    the bundled DEFAULT_DESCRIPTORS. Malformed or non-object env → defaults only,
    never raises.
    """
    merged = dict(DEFAULT_DESCRIPTORS)
    raw = os.environ.get("BROWSER_LOGIN_DESCRIPTORS", "").strip()
    if not raw:
        return merged
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        logger.warning("browser-login: BROWSER_LOGIN_DESCRIPTORS is not valid JSON — using defaults")
        return merged
    if not isinstance(parsed, dict):
        logger.warning("browser-login: BROWSER_LOGIN_DESCRIPTORS is not a JSON object — using defaults")
        return merged
    merged.update(parsed)
    return merged


def _get_descriptor(platform: str) -> Optional[dict]:
    """Return the descriptor for `platform`, or None if unknown."""
    return _get_descriptors().get(platform)


# ---------------------------------------------------------------------------
# Session probe
# ---------------------------------------------------------------------------


def _probe_session(descriptor: dict, task_id: str = "default") -> str:
    """Determine whether the agent has a valid session for this platform.

    Navigates to the descriptor's authed_probe_url and checks the snapshot text
    for the authed_signal. Returns "authenticated" or "login_required".
    Fails safe to "login_required" if navigation/probe fails (we cannot confirm
    auth, so treat it as not-authenticated).
    """
    probe_url = descriptor.get("authed_probe_url") or descriptor.get("login_url")
    if not probe_url:
        return "login_required"
    if not _navigate(probe_url, task_id):
        return "login_required"
    text = _snapshot_text(task_id)
    authed_signal = descriptor.get("authed_signal") or ""
    if authed_signal and authed_signal in text:
        return "authenticated"
    return "login_required"


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------


def _handle_browser_login(platform: str = "", task_id: str = "default", **kwargs) -> str:
    """Tool handler: ensure an authenticated browser session for `platform`.

    Returns one of:
      {status: "authenticated", platform}
      {status: "login_required", platform, login_escalation: {vnc_url, hint, screenshot}}
      {status: "error", error}
    The plaintext credential is never returned and never enters the model context.
    """
    if not _camofox_url():
        return json.dumps({
            "status": "error",
            "error": "Camofox not configured (set CAMOFOX_URL)",
        })

    descriptor = _get_descriptor(platform)
    if not descriptor:
        return json.dumps({
            "status": "error",
            "error": (
                f"Unknown platform {platform!r} — no login descriptor. "
                "Configure it in HSM settings (BROWSER_LOGIN_DESCRIPTORS)."
            ),
        })

    status = _probe_session(descriptor, task_id)
    if status == "authenticated":
        return json.dumps({"status": "authenticated", "platform": platform})

    # login_required: put the human on the login page in the VNC view, then escalate.
    login_url = descriptor.get("login_url")
    if login_url:
        _navigate(login_url, task_id)
    vnc = _vnc_url()
    return json.dumps({
        "status": "login_required",
        "platform": platform,
        "login_escalation": {
            "vnc_url": vnc or "VNC not available (set VNC_EXTERNAL_URL / enable VPN mode)",
            "hint": (
                f"No valid session for {platform}. Open the VNC URL and log in "
                "directly in the browser, then poll check_login_status(platform)."
            ),
            "screenshot": _screenshot(),
        },
    })


def _handle_check_login_status(platform: str = "", task_id: str = "default", **kwargs) -> str:
    """Tool handler: re-probe the session (single, non-blocking).

    The agent calls this in a loop with its OWN attempt budget; the tool never
    blocks waiting for the human. Returns {status: "authenticated"|"login_required",
    platform} or {status: "error", error}.
    """
    if not _camofox_url():
        return json.dumps({
            "status": "error",
            "error": "Camofox not configured (set CAMOFOX_URL)",
        })
    descriptor = _get_descriptor(platform)
    if not descriptor:
        return json.dumps({
            "status": "error",
            "error": f"Unknown platform {platform!r} — no login descriptor.",
        })
    status = _probe_session(descriptor, task_id)
    return json.dumps({"status": status, "platform": platform})


# ---------------------------------------------------------------------------
# Plugin registration
# ---------------------------------------------------------------------------


def register(ctx):
    """Register browser_login and check_login_status tools."""
    if not requests:
        logger.warning("browser-login: 'requests' not installed, plugin disabled")
        return

    if not _camofox_url():
        logger.info("browser-login: CAMOFOX_URL not set, plugin inactive (will activate if set later)")

    ctx.register_tool(
        name="browser_login",
        toolset="browser",
        schema={
            "type": "function",
            "function": {
                "name": "browser_login",
                "description": (
                    "Ensure an authenticated browser session for a platform WITHOUT "
                    "handling the password yourself. Returns {status:'authenticated'} "
                    "if a valid session already exists (proceed to drive the tab), or "
                    "{status:'login_required', login_escalation:{vnc_url,...}} if a human "
                    "must log in. On login_required, share the vnc_url with the human, "
                    "then poll check_login_status until it returns 'authenticated'. "
                    "Never ask the user to paste their password to you."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "platform": {
                            "type": "string",
                            "description": "Platform key (must have a configured login descriptor).",
                        },
                        "task_id": {
                            "type": "string",
                            "description": "Browser task ID (default: 'default').",
                        },
                    },
                    "required": ["platform"],
                },
            },
        },
        handler=_handle_browser_login,
    )

    ctx.register_tool(
        name="check_login_status",
        toolset="browser",
        schema={
            "type": "function",
            "function": {
                "name": "check_login_status",
                "description": (
                    "Re-check whether the platform's browser session is authenticated "
                    "yet (single, non-blocking probe). Call this in a loop after "
                    "browser_login returns 'login_required', while the human logs in via "
                    "VNC. Use your own attempt/time budget — e.g. poll every ~10s for a "
                    "few minutes, then give up and report the human is unavailable. "
                    "Returns {status:'authenticated'|'login_required', platform}."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "platform": {
                            "type": "string",
                            "description": "Platform key (must have a configured login descriptor).",
                        },
                        "task_id": {
                            "type": "string",
                            "description": "Browser task ID (default: 'default').",
                        },
                    },
                    "required": ["platform"],
                },
            },
        },
        handler=_handle_check_login_status,
    )

    logger.info("browser-login: registered browser_login + check_login_status tools")
