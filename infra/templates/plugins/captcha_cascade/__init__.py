"""CAPTCHA Cascade Plugin — CapSolver auto-solve + VNC escalation.

Registers a `captcha_solve` tool that agents call when browser_navigate
returns a bot_detection_warning. Tries automated solving via CapSolver,
falls back to VNC escalation for human intervention.

Configuration:
- CAMOFOX_URL: Required. URL of the Camofox browser server.
- CAPSOLVER_API_KEY: Optional. Enables automated CAPTCHA solving (~$0.003/solve).
  Without it, the tool immediately returns VNC escalation info.
"""

import json
import logging
import os
import time
from typing import Optional, Tuple
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

try:
    import requests
except ImportError:
    requests = None

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CAPSOLVER_API_URL = "https://api.capsolver.com"
CAPSOLVER_POLL_INTERVAL = 3
CAPSOLVER_TIMEOUT = 120
CAPSOLVER_TASK_TYPES = {
    "recaptcha": "ReCaptchaV2TaskProxyLess",
    "hcaptcha": "HCaptchaTaskProxyLess",
    "turnstile": "AntiTurnstileTaskProxyLess",
}


# ---------------------------------------------------------------------------
# Camofox HTTP helpers
# ---------------------------------------------------------------------------

def _camofox_url() -> str:
    """Get Camofox URL from environment."""
    return os.environ.get("CAMOFOX_URL", "").rstrip("/")


def _vnc_url() -> Optional[str]:
    """Get the externally-reachable VNC URL for human CAPTCHA escalation.

    Prefers VNC_EXTERNAL_URL, which HSM writes when VPN mode is enabled — it
    encodes the externally-reachable host (the VNC bind host, e.g. a Tailscale
    address) and the host-published VNC port. The Camofox /health fallback only
    knows the internal noVNC port and builds the URL from CAMOFOX_URL
    (host.docker.internal), which a human cannot reach — so it's a last resort.
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


def _camofox_eval(expression: str, task_id: str = "default") -> dict:
    """Evaluate JS in the Camofox page context via REST API."""
    url = _camofox_url()
    if not url:
        return {"success": False, "error": "Camofox not configured"}
    try:
        tabs_resp = requests.get(f"{url}/tabs", timeout=5)
        if tabs_resp.status_code != 200:
            return {"success": False, "error": "Could not list tabs"}
        tabs = tabs_resp.json()
        if not tabs or not isinstance(tabs, list):
            return {"success": False, "error": "No active tabs"}
        tab = tabs[0]
        tab_id = tab.get("tabId") or tab.get("id")
        user_id = tab.get("userId", "default")

        resp = requests.post(
            f"{url}/tabs/{tab_id}/evaluate",
            json={"expression": expression, "userId": user_id},
            timeout=10,
        )
        if resp.status_code in (404, 405, 501):
            return {"success": False, "error": "JS eval not supported by this Camofox version"}
        resp.raise_for_status()
        data = resp.json()
        raw_result = data.get("result") if isinstance(data, dict) else data
        parsed = raw_result
        if isinstance(raw_result, str):
            try:
                parsed = json.loads(raw_result)
            except (json.JSONDecodeError, ValueError):
                pass
        return {"success": True, "result": parsed}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _screenshot() -> str:
    """Get a screenshot from Camofox as base64."""
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


# ---------------------------------------------------------------------------
# Layer 1: Sitekey extraction
# ---------------------------------------------------------------------------

def _extract_sitekey_js() -> str:
    """Return JavaScript that finds CAPTCHA sitekeys on the current page.

    Checks for reCAPTCHA, hCaptcha, and Turnstile widgets via DOM selectors
    and iframe src patterns.  Returns JSON: {sitekey, subtype}.
    """
    return """
(function() {
    // reCAPTCHA — .g-recaptcha div or iframe
    var rc = document.querySelector('.g-recaptcha');
    if (rc) {
        var key = rc.getAttribute('data-sitekey');
        if (key) return JSON.stringify({sitekey: key, subtype: 'recaptcha'});
    }
    var rcIframe = document.querySelector('iframe[src*="recaptcha"]');
    if (rcIframe) {
        var m = rcIframe.src.match(/[?&]k=([^&]+)/);
        if (m) return JSON.stringify({sitekey: m[1], subtype: 'recaptcha'});
    }

    // hCaptcha — .h-captcha div or iframe
    var hc = document.querySelector('.h-captcha');
    if (hc) {
        var key = hc.getAttribute('data-sitekey');
        if (key) return JSON.stringify({sitekey: key, subtype: 'hcaptcha'});
    }
    var hcIframe = document.querySelector('iframe[src*="hcaptcha"]');
    if (hcIframe) {
        var m = hcIframe.src.match(/[?&]sitekey=([^&]+)/);
        if (m) return JSON.stringify({sitekey: m[1], subtype: 'hcaptcha'});
    }

    // Turnstile — .cf-turnstile div
    var ts = document.querySelector('.cf-turnstile');
    if (ts) {
        var key = ts.getAttribute('data-sitekey');
        if (key) return JSON.stringify({sitekey: key, subtype: 'turnstile'});
    }

    return JSON.stringify({sitekey: null, subtype: null});
})();
""".strip()


def _parse_sitekey_response(raw: str) -> Tuple[Optional[str], Optional[str]]:
    """Parse JSON eval result into (sitekey, subtype). Both None if not found."""
    if not raw:
        return None, None
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None, None
    if not isinstance(data, dict):
        return None, None
    sitekey = data.get("sitekey") or None
    subtype = data.get("subtype") or None
    return sitekey, subtype


# ---------------------------------------------------------------------------
# Layer 2: CapSolver API client
# ---------------------------------------------------------------------------

def _capsolver_solve(
    sitekey: str,
    page_url: str,
    subtype: str,
) -> Optional[str]:
    """Solve a CAPTCHA via CapSolver's API.

    Creates a task and polls for the result. Returns the solved token
    string, or None on any failure.
    """
    api_key = os.getenv("CAPSOLVER_API_KEY", "").strip()
    if not api_key:
        logger.warning("CAPSOLVER_API_KEY not set — cannot auto-solve CAPTCHA")
        return None

    task_type = CAPSOLVER_TASK_TYPES.get(subtype)
    if not task_type:
        logger.warning("Unknown CAPTCHA subtype %r — cannot solve", subtype)
        return None

    task = {
        "type": task_type,
        "websiteURL": page_url,
        "websiteKey": sitekey,
    }

    try:
        # createTask
        resp = requests.post(
            f"{CAPSOLVER_API_URL}/createTask",
            json={"clientKey": api_key, "task": task},
            timeout=30,
        )
        data = resp.json()
        if data.get("errorId", 0) != 0:
            logger.warning("CapSolver createTask error: %s", data.get("errorDescription"))
            return None
        task_id = data.get("taskId")
        if not task_id:
            logger.warning("CapSolver createTask returned no taskId")
            return None

        # Poll getTaskResult
        start = time.time()
        while (time.time() - start) < CAPSOLVER_TIMEOUT:
            time.sleep(CAPSOLVER_POLL_INTERVAL)
            resp = requests.post(
                f"{CAPSOLVER_API_URL}/getTaskResult",
                json={"clientKey": api_key, "taskId": task_id},
                timeout=30,
            )
            result = resp.json()
            if result.get("errorId", 0) != 0:
                logger.warning("CapSolver poll error: %s", result.get("errorDescription"))
                return None
            status = result.get("status")
            if status == "ready":
                solution = result.get("solution", {})
                token = (
                    solution.get("gRecaptchaResponse")
                    or solution.get("token")
                    or solution.get("response")
                )
                return token
            if status not in ("processing", "idle"):
                logger.warning("CapSolver unexpected status: %s", status)
                return None

        logger.warning("CapSolver solve timed out after %ds", CAPSOLVER_TIMEOUT)
        return None

    except Exception:
        logger.exception("CapSolver solve failed")
        return None


def _inject_token_js(subtype: str, token: str) -> str:
    """Return JavaScript that injects a solved CAPTCHA token into the page."""
    safe_token = token.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")

    if subtype == "recaptcha":
        return f"""
(function() {{
    var ta = document.querySelector('textarea[name="g-recaptcha-response"]');
    if (ta) {{
        ta.value = '{safe_token}';
        ta.style.display = 'block';
    }}
    if (typeof ___grecaptcha_cfg !== 'undefined') {{
        var clients = ___grecaptcha_cfg.clients;
        for (var k in clients) {{
            var client = clients[k];
            for (var p in client) {{
                var widget = client[p];
                if (widget && widget.callback) {{
                    widget.callback('{safe_token}');
                    return 'injected';
                }}
            }}
        }}
    }}
    var rc = document.querySelector('.g-recaptcha');
    if (rc) {{
        var cbName = rc.getAttribute('data-callback');
        if (cbName && typeof window[cbName] === 'function') {{
            window[cbName]('{safe_token}');
            return 'injected';
        }}
    }}
    return 'injected_no_callback';
}})();
""".strip()

    elif subtype == "hcaptcha":
        return f"""
(function() {{
    var ta = document.querySelector('textarea[name="h-captcha-response"]');
    if (ta) {{
        ta.value = '{safe_token}';
    }}
    var iframe = document.querySelector('iframe[src*="hcaptcha"]');
    if (iframe) {{
        try {{
            iframe.setAttribute('data-hcaptcha-response', '{safe_token}');
        }} catch(e) {{}}
    }}
    return 'injected';
}})();
""".strip()

    elif subtype == "turnstile":
        return f"""
(function() {{
    var input = document.querySelector('input[name="cf-turnstile-response"]');
    if (input) {{
        input.value = '{safe_token}';
    }}
    var ts = document.querySelector('.cf-turnstile');
    if (ts) {{
        var cbName = ts.getAttribute('data-callback');
        if (cbName && typeof window[cbName] === 'function') {{
            window[cbName]('{safe_token}');
            return 'injected';
        }}
    }}
    return 'injected_no_callback';
}})();
""".strip()

    else:
        return "null;"


# ---------------------------------------------------------------------------
# Tool handler
# ---------------------------------------------------------------------------

def _handle_captcha_solve(task_id: str = "default", **kwargs) -> str:
    """Tool handler: attempt to solve the CAPTCHA on the current page.

    Called by the agent when browser_navigate returns bot_detection_warning.
    """
    camofox = _camofox_url()
    if not camofox:
        return json.dumps({
            "success": False,
            "error": "Camofox not configured (set CAMOFOX_URL)",
        })

    # Step 1: Extract sitekey
    eval_result = _camofox_eval(_extract_sitekey_js(), task_id)
    if not eval_result.get("success"):
        vnc = _vnc_url()
        return json.dumps({
            "success": False,
            "captcha_escalation": {
                "vnc_url": vnc or "VNC not available",
                "hint": "CAPTCHA detected but JS eval unavailable — use VNC to solve manually",
                "screenshot": _screenshot(),
            },
        })

    raw_inner = eval_result.get("result", "")
    if isinstance(raw_inner, str):
        sitekey, subtype = _parse_sitekey_response(raw_inner)
    elif isinstance(raw_inner, dict):
        sitekey = raw_inner.get("sitekey")
        subtype = raw_inner.get("subtype", "unknown")
    else:
        sitekey, subtype = None, "unknown"

    if not sitekey:
        vnc = _vnc_url()
        return json.dumps({
            "success": False,
            "captcha_escalation": {
                "vnc_url": vnc or "VNC not available",
                "hint": "CAPTCHA detected but could not extract sitekey — use VNC",
                "screenshot": _screenshot(),
            },
        })

    # Step 2: Try CapSolver
    page_url = ""
    try:
        tabs_resp = requests.get(f"{camofox}/tabs", timeout=5)
        if tabs_resp.status_code == 200:
            tabs = tabs_resp.json()
            if tabs and isinstance(tabs, list):
                page_url = tabs[0].get("url", "")
    except Exception:
        pass

    token = _capsolver_solve(sitekey, page_url, subtype)
    if not token:
        vnc = _vnc_url()
        has_key = bool(os.environ.get("CAPSOLVER_API_KEY", "").strip())
        return json.dumps({
            "success": False,
            "captcha_escalation": {
                "vnc_url": vnc or "VNC not available",
                "hint": f"{subtype} detected — CapSolver {'failed' if has_key else 'unavailable (no API key)'}",
                "screenshot": _screenshot(),
            },
        })

    # Step 3: Inject token
    inject_js = _inject_token_js(subtype, token)
    if inject_js:
        _camofox_eval(inject_js, task_id)
        time.sleep(2)

    return json.dumps({
        "success": True,
        "captcha_solved": True,
        "method": "capsolver",
        "subtype": subtype,
    })


# ---------------------------------------------------------------------------
# Plugin registration
# ---------------------------------------------------------------------------

def register(ctx):
    """Register the captcha_solve tool."""
    if not requests:
        logger.warning("captcha-cascade: 'requests' not installed, plugin disabled")
        return

    if not _camofox_url():
        logger.info("captcha-cascade: CAMOFOX_URL not set, plugin inactive (will activate if set later)")

    ctx.register_tool(
        name="captcha_solve",
        toolset="browser",
        schema={
            "type": "function",
            "function": {
                "name": "captcha_solve",
                "description": (
                    "Attempt to solve a CAPTCHA on the current browser page. "
                    "Call this when browser_navigate returns a bot_detection_warning. "
                    "Uses CapSolver API for automated solving if configured, "
                    "otherwise returns a VNC link for manual human intervention."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "task_id": {
                            "type": "string",
                            "description": "Browser task ID (default: 'default')",
                        },
                    },
                    "required": [],
                },
            },
        },
        handler=_handle_captcha_solve,
    )
    logger.info("captcha-cascade: registered captcha_solve tool (CAPSOLVER=%s)",
                "configured" if os.environ.get("CAPSOLVER_API_KEY") else "not set")
