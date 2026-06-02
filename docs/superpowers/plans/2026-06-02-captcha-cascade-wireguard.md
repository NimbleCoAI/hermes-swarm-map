# CAPTCHA Cascade + WireGuard Sidecar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Hermes agents to auto-solve CAPTCHAs via CapSolver, escalate unsolvable challenges to the user via VNC DM, and route browser traffic through a WireGuard VPN sidecar for clean IPs.

**Architecture:** Three independent components — (1) a `captcha_cascade` module in hermes-agent-mt that hooks into the browser tool's bot-detection path, tries CapSolver auto-solve, and falls back to VNC escalation; (2) a WireGuard Docker sidecar in hermes-swarm-map's compose generation that routes Camofox traffic through Mullvad VPN; (3) an agent skill that teaches the escalation DM pattern.

**Tech Stack:** Python (hermes-agent-mt), TypeScript/Next.js (hermes-swarm-map), Docker Compose, WireGuard, CapSolver API, Camofox REST API

**Spec:** `docs/superpowers/specs/2026-06-02-captcha-cascade-wireguard-design.md`

---

## File Structure

### hermes-agent-mt (Python)

| File | Responsibility |
|------|----------------|
| `tools/captcha_cascade.py` | **New.** CapSolver client, sitekey extraction, token injection, cascade orchestrator |
| `tools/browser_tool.py` | **Modify ~5 lines.** Hook cascade into bot-detection-warning path at line ~2449 |
| `tests/tools/test_captcha_cascade.py` | **New.** Unit tests for cascade module |

### hermes-swarm-map (TypeScript)

| File | Responsibility |
|------|----------------|
| `lib/services/harness.ts` | **Modify.** Add WireGuard sidecar + Camofox service to `generateStandaloneCompose()` |
| `app/api/harnesses/[id]/settings/route.ts` | **Modify.** Add `vpnEnabled` boolean setting (read/write `.env`) |
| `components/harness/settings-tab.tsx` | **Modify.** Add VPN toggle in settings UI |
| `lib/templates/config-yaml.ts` | No change needed |

### Per-agent

| File | Responsibility |
|------|----------------|
| `skills/captcha-escalation/SKILL.md` | **New.** Teaches agent the VNC escalation DM pattern |

---

## Task 1: captcha_cascade module — sitekey extraction + CapSolver client

**Repo:** hermes-agent-mt
**Files:**
- Create: `tools/captcha_cascade.py`
- Create: `tests/tools/test_captcha_cascade.py`

- [ ] **Step 1: Write failing tests for sitekey extraction**

Create `tests/tools/test_captcha_cascade.py`:

```python
"""Tests for the CAPTCHA cascade — CapSolver auto-solve + VNC escalation."""

import json
import os
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Sitekey extraction
# ---------------------------------------------------------------------------

class TestExtractSitekey:
    """Test JS-based sitekey extraction via Camofox evaluate endpoint."""

    def test_recaptcha_sitekey_from_div(self):
        """Extract sitekey from .g-recaptcha div."""
        from tools.captcha_cascade import _extract_sitekey_js

        # The JS should look for .g-recaptcha[data-sitekey]
        js = _extract_sitekey_js()
        assert "g-recaptcha" in js
        assert "data-sitekey" in js

    def test_hcaptcha_sitekey_from_div(self):
        from tools.captcha_cascade import _extract_sitekey_js

        js = _extract_sitekey_js()
        assert "h-captcha" in js

    def test_turnstile_sitekey_from_div(self):
        from tools.captcha_cascade import _extract_sitekey_js

        js = _extract_sitekey_js()
        assert "cf-turnstile" in js

    def test_parse_eval_response_recaptcha(self):
        from tools.captcha_cascade import _parse_sitekey_response

        raw = json.dumps({"sitekey": "6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-", "subtype": "recaptcha"})
        sitekey, subtype = _parse_sitekey_response(raw)
        assert sitekey == "6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-"
        assert subtype == "recaptcha"

    def test_parse_eval_response_none(self):
        from tools.captcha_cascade import _parse_sitekey_response

        raw = json.dumps({"sitekey": None, "subtype": "unknown"})
        sitekey, subtype = _parse_sitekey_response(raw)
        assert sitekey is None
        assert subtype == "unknown"

    def test_parse_eval_response_malformed(self):
        from tools.captcha_cascade import _parse_sitekey_response

        sitekey, subtype = _parse_sitekey_response("not json")
        assert sitekey is None
        assert subtype == "unknown"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-agent-mt && python -m pytest tests/tools/test_captcha_cascade.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'tools.captcha_cascade'`

- [ ] **Step 3: Implement sitekey extraction**

Create `tools/captcha_cascade.py`:

```python
"""CAPTCHA cascade — CapSolver auto-solve with VNC escalation fallback.

Hooks into browser_tool's bot-detection-warning path. When a CAPTCHA is
detected, attempts automated solving via CapSolver API. Falls back to
providing a VNC escalation response for human intervention.
"""

import json
import logging
import os
import time
from typing import Optional, Tuple

import requests

logger = logging.getLogger(__name__)

# CapSolver API
CAPSOLVER_API_URL = "https://api.capsolver.com"
CAPSOLVER_POLL_INTERVAL = 3  # seconds
CAPSOLVER_TIMEOUT = 120  # seconds

# Task types per CAPTCHA subtype
CAPSOLVER_TASK_TYPES = {
    "recaptcha": "ReCaptchaV2TaskProxyLess",
    "hcaptcha": "HCaptchaTaskProxyLess",
    "turnstile": "AntiTurnstileTaskProxyLess",
}


def _extract_sitekey_js() -> str:
    """Return JavaScript that extracts the CAPTCHA sitekey and subtype from the page."""
    return """
    (() => {
        const grc = document.querySelector('.g-recaptcha');
        if (grc) return JSON.stringify({sitekey: grc.getAttribute('data-sitekey'), subtype: 'recaptcha'});
        const iframe_rc = document.querySelector('iframe[src*="recaptcha"]');
        if (iframe_rc) {
            const m = iframe_rc.src.match(/[?&]k=([^&]+)/);
            if (m) return JSON.stringify({sitekey: m[1], subtype: 'recaptcha'});
        }
        const hc = document.querySelector('.h-captcha');
        if (hc) return JSON.stringify({sitekey: hc.getAttribute('data-sitekey'), subtype: 'hcaptcha'});
        const iframe_hc = document.querySelector('iframe[src*="hcaptcha"]');
        if (iframe_hc) {
            const m = iframe_hc.src.match(/[?&]sitekey=([^&]+)/);
            if (m) return JSON.stringify({sitekey: m[1], subtype: 'hcaptcha'});
        }
        const cf = document.querySelector('.cf-turnstile');
        if (cf) return JSON.stringify({sitekey: cf.getAttribute('data-sitekey'), subtype: 'turnstile'});
        return JSON.stringify({sitekey: null, subtype: 'unknown'});
    })()
    """


def _parse_sitekey_response(raw: str) -> Tuple[Optional[str], str]:
    """Parse the JSON result from sitekey extraction JS."""
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
        return data.get("sitekey"), data.get("subtype", "unknown")
    except (json.JSONDecodeError, ValueError, TypeError, AttributeError):
        return None, "unknown"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-agent-mt && python -m pytest tests/tools/test_captcha_cascade.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/juniperbevensee/Documents/GitHub/hermes-agent-mt
git add tools/captcha_cascade.py tests/tools/test_captcha_cascade.py
git commit -m "feat: captcha_cascade module — sitekey extraction"
```

---

## Task 2: captcha_cascade — CapSolver API client + token injection

**Repo:** hermes-agent-mt
**Files:**
- Modify: `tools/captcha_cascade.py`
- Modify: `tests/tools/test_captcha_cascade.py`

- [ ] **Step 1: Write failing tests for CapSolver client**

Append to `tests/tools/test_captcha_cascade.py`:

```python
# ---------------------------------------------------------------------------
# CapSolver client
# ---------------------------------------------------------------------------

class TestCapsolverSolve:
    """Test CapSolver API interactions (mocked)."""

    def test_no_api_key_returns_none(self, monkeypatch):
        from tools.captcha_cascade import _capsolver_solve

        monkeypatch.delenv("CAPSOLVER_API_KEY", raising=False)
        result = _capsolver_solve("sitekey123", "https://example.com", "recaptcha")
        assert result is None

    @patch("tools.captcha_cascade.requests.post")
    def test_successful_solve(self, mock_post, monkeypatch):
        from tools.captcha_cascade import _capsolver_solve

        monkeypatch.setenv("CAPSOLVER_API_KEY", "test-key")

        # First call: createTask
        create_resp = MagicMock()
        create_resp.json.return_value = {"errorId": 0, "taskId": "task-abc"}
        # Second call: getTaskResult
        result_resp = MagicMock()
        result_resp.json.return_value = {
            "errorId": 0,
            "status": "ready",
            "solution": {"gRecaptchaResponse": "solved-token-xyz"},
        }
        mock_post.side_effect = [create_resp, result_resp]

        token = _capsolver_solve("sitekey123", "https://example.com", "recaptcha")
        assert token == "solved-token-xyz"

    @patch("tools.captcha_cascade.requests.post")
    def test_create_task_error(self, mock_post, monkeypatch):
        from tools.captcha_cascade import _capsolver_solve

        monkeypatch.setenv("CAPSOLVER_API_KEY", "test-key")

        resp = MagicMock()
        resp.json.return_value = {"errorId": 1, "errorDescription": "bad request"}
        mock_post.return_value = resp

        token = _capsolver_solve("sitekey123", "https://example.com", "recaptcha")
        assert token is None

    def test_unknown_subtype_returns_none(self, monkeypatch):
        from tools.captcha_cascade import _capsolver_solve

        monkeypatch.setenv("CAPSOLVER_API_KEY", "test-key")
        result = _capsolver_solve("sitekey123", "https://example.com", "unknown")
        assert result is None

    @patch("tools.captcha_cascade.requests.post")
    def test_turnstile_uses_token_key(self, mock_post, monkeypatch):
        from tools.captcha_cascade import _capsolver_solve

        monkeypatch.setenv("CAPSOLVER_API_KEY", "test-key")

        create_resp = MagicMock()
        create_resp.json.return_value = {"errorId": 0, "taskId": "task-abc"}
        result_resp = MagicMock()
        result_resp.json.return_value = {
            "errorId": 0,
            "status": "ready",
            "solution": {"token": "turnstile-token-xyz"},
        }
        mock_post.side_effect = [create_resp, result_resp]

        token = _capsolver_solve("sitekey123", "https://example.com", "turnstile")
        assert token == "turnstile-token-xyz"
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-agent-mt && python -m pytest tests/tools/test_captcha_cascade.py::TestCapsolverSolve -v`
Expected: FAIL — `ImportError: cannot import name '_capsolver_solve'`

- [ ] **Step 3: Implement CapSolver client**

Append to `tools/captcha_cascade.py`:

```python
def _capsolver_solve(
    sitekey: str,
    page_url: str,
    subtype: str,
) -> Optional[str]:
    """Call CapSolver API to solve a CAPTCHA. Returns token string or None."""
    api_key = os.environ.get("CAPSOLVER_API_KEY", "").strip()
    if not api_key:
        logger.debug("No CAPSOLVER_API_KEY — skipping auto-solve")
        return None

    task_type = CAPSOLVER_TASK_TYPES.get(subtype)
    if not task_type:
        logger.debug("Unknown CAPTCHA subtype %s — skipping CapSolver", subtype)
        return None

    solution_key = "token" if subtype == "turnstile" else "gRecaptchaResponse"

    try:
        # Create task
        create_resp = requests.post(
            f"{CAPSOLVER_API_URL}/createTask",
            json={
                "appId": "AF0F7B0A-6042-48AE-A940-D7A0B2E1A70E",
                "clientKey": api_key,
                "task": {
                    "type": task_type,
                    "websiteURL": page_url,
                    "websiteKey": sitekey,
                },
            },
            timeout=30,
        )
        create_data = create_resp.json()
        if create_data.get("errorId", 1) != 0:
            logger.warning("CapSolver createTask error: %s", create_data)
            return None

        task_id = create_data["taskId"]
        logger.info("CapSolver task created: %s (%s)", task_id, task_type)

        # Poll for result
        start = time.time()
        while time.time() - start < CAPSOLVER_TIMEOUT:
            time.sleep(CAPSOLVER_POLL_INTERVAL)
            result_resp = requests.post(
                f"{CAPSOLVER_API_URL}/getTaskResult",
                json={"clientKey": api_key, "taskId": task_id},
                timeout=30,
            )
            result_data = result_resp.json()
            if result_data.get("errorId", 1) != 0:
                logger.warning("CapSolver poll error: %s", result_data)
                return None
            if result_data.get("status") == "ready":
                token = result_data.get("solution", {}).get(solution_key)
                if token:
                    logger.info("CapSolver solved %s in %.1fs", subtype, time.time() - start)
                    return token
                return None

        logger.warning("CapSolver timeout after %ds", CAPSOLVER_TIMEOUT)
        return None
    except Exception as e:
        logger.warning("CapSolver error: %s", e)
        return None


def _inject_token_js(subtype: str, token: str) -> str:
    """Return JavaScript that injects a solved CAPTCHA token into the page."""
    escaped = json.dumps(token)
    if subtype == "recaptcha":
        return f"""
        (() => {{
            const el = document.getElementById('g-recaptcha-response');
            if (el) {{ el.value = {escaped}; el.style.display = 'block'; }}
            try {{
                if (typeof ___grecaptcha_cfg !== 'undefined') {{
                    Object.values(___grecaptcha_cfg.clients).forEach(c => {{
                        Object.values(c).forEach(v => {{
                            if (v && typeof v === 'object') Object.values(v).forEach(inner => {{
                                if (inner && inner.callback) inner.callback({escaped});
                            }});
                        }});
                    }});
                }}
            }} catch(e) {{}}
        }})()
        """
    elif subtype == "hcaptcha":
        return f"""
        (() => {{
            const el = document.querySelector('[name="h-captcha-response"]');
            if (el) el.value = {escaped};
        }})()
        """
    elif subtype == "turnstile":
        return f"""
        (() => {{
            const el = document.querySelector('[name="cf-turnstile-response"]');
            if (el) el.value = {escaped};
            try {{
                const w = document.querySelector('.cf-turnstile');
                if (w) {{
                    const cb = w.getAttribute('data-callback');
                    if (cb && typeof window[cb] === 'function') window[cb]({escaped});
                }}
            }} catch(e) {{}}
        }})()
        """
    return ""
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-agent-mt && python -m pytest tests/tools/test_captcha_cascade.py -v`
Expected: 11 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/juniperbevensee/Documents/GitHub/hermes-agent-mt
git add tools/captcha_cascade.py tests/tools/test_captcha_cascade.py
git commit -m "feat: captcha_cascade — CapSolver client + token injection JS"
```

---

## Task 3: captcha_cascade — try_solve orchestrator

**Repo:** hermes-agent-mt
**Files:**
- Modify: `tools/captcha_cascade.py`
- Modify: `tests/tools/test_captcha_cascade.py`

- [ ] **Step 1: Write failing tests for try_solve**

Append to `tests/tools/test_captcha_cascade.py`:

```python
# ---------------------------------------------------------------------------
# try_solve orchestrator
# ---------------------------------------------------------------------------

class TestTrySolve:
    """Test the full cascade: extract → solve → inject → escalate."""

    @patch("tools.captcha_cascade._camofox_eval")
    def test_no_sitekey_found_escalates(self, mock_eval, monkeypatch):
        from tools.captcha_cascade import try_solve

        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        # Sitekey extraction returns null
        mock_eval.return_value = json.dumps({"success": True, "result": '{"sitekey": null, "subtype": "unknown"}'})

        result = try_solve("default")
        assert result is not None
        assert "captcha_escalation" in result

    @patch("tools.captcha_cascade._capsolver_solve")
    @patch("tools.captcha_cascade._camofox_eval")
    def test_capsolver_success(self, mock_eval, mock_solve, monkeypatch):
        from tools.captcha_cascade import try_solve

        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        monkeypatch.setenv("CAPSOLVER_API_KEY", "test-key")

        # First call: sitekey extraction
        mock_eval.side_effect = [
            json.dumps({"success": True, "result": '{"sitekey": "sk123", "subtype": "recaptcha"}'}),
            json.dumps({"success": True, "result": None}),  # token injection
        ]
        mock_solve.return_value = "solved-token"

        result = try_solve("default")
        assert result is not None
        assert result.get("captcha_solved") is True
        assert result.get("method") == "capsolver"

    @patch("tools.captcha_cascade._capsolver_solve")
    @patch("tools.captcha_cascade._camofox_eval")
    def test_capsolver_fails_escalates(self, mock_eval, mock_solve, monkeypatch):
        from tools.captcha_cascade import try_solve

        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        monkeypatch.setenv("CAPSOLVER_API_KEY", "test-key")

        mock_eval.return_value = json.dumps({"success": True, "result": '{"sitekey": "sk123", "subtype": "recaptcha"}'})
        mock_solve.return_value = None  # CapSolver failed

        result = try_solve("default")
        assert result is not None
        assert "captcha_escalation" in result
        assert "vnc_url" in result["captcha_escalation"]

    @patch("tools.captcha_cascade._camofox_eval")
    def test_eval_not_supported_escalates(self, mock_eval, monkeypatch):
        from tools.captcha_cascade import try_solve

        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        # Eval returns error (404)
        mock_eval.return_value = json.dumps({"success": False, "error": "404 not supported"})

        result = try_solve("default")
        assert result is not None
        assert "captcha_escalation" in result

    def test_no_camofox_returns_none(self, monkeypatch):
        from tools.captcha_cascade import try_solve

        monkeypatch.delenv("CAMOFOX_URL", raising=False)
        result = try_solve("default")
        assert result is None
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-agent-mt && python -m pytest tests/tools/test_captcha_cascade.py::TestTrySolve -v`
Expected: FAIL — `ImportError: cannot import name 'try_solve'`

- [ ] **Step 3: Implement try_solve orchestrator**

Append to `tools/captcha_cascade.py`:

```python
def _camofox_eval(expression: str, task_id: str = "default") -> str:
    """Evaluate JS in the Camofox page context via the /evaluate endpoint.

    Calls the Camofox REST API directly (not the private browser_tool helper)
    to keep this module self-contained.
    """
    from tools.browser_camofox import _ensure_tab, _post, get_camofox_url
    if not get_camofox_url():
        return json.dumps({"success": False, "error": "Camofox not configured"})

    try:
        tab_info = _ensure_tab(task_id)
        tab_id = tab_info.get("tab_id") or tab_info.get("id")
        resp = _post(
            f"/tabs/{tab_id}/evaluate",
            body={"expression": expression, "userId": tab_info["user_id"]},
        )
        raw_result = resp.get("result") if isinstance(resp, dict) else resp
        parsed = raw_result
        if isinstance(raw_result, str):
            try:
                parsed = json.loads(raw_result)
            except (json.JSONDecodeError, ValueError):
                pass
        return json.dumps({"success": True, "result": parsed}, ensure_ascii=False, default=str)
    except Exception as e:
        error_msg = str(e)
        if any(code in error_msg for code in ("404", "405", "501")):
            return json.dumps({"success": False, "error": f"JS eval not supported: {error_msg}"})
        return json.dumps({"success": False, "error": error_msg})


def _get_page_url(task_id: str) -> str:
    """Get the current page URL from Camofox."""
    try:
        from tools.browser_camofox import _ensure_tab, get_camofox_url
        if not get_camofox_url():
            return ""
        tab_info = _ensure_tab(task_id)
        return tab_info.get("url", "")
    except Exception:
        return ""


def try_solve(task_id: str = "default") -> Optional[dict]:
    """Attempt to solve a detected CAPTCHA. Returns result dict or None.

    Returns:
        None — Camofox not available, nothing to do
        {"captcha_solved": True, "method": "capsolver"} — auto-solved
        {"captcha_escalation": {"vnc_url": ..., "hint": ..., "screenshot": ...}} — needs human
    """
    from tools.browser_camofox import get_camofox_url, get_vnc_url, check_camofox_available

    if not get_camofox_url():
        return None

    # Step 1: Extract sitekey via JS eval
    eval_result_raw = _camofox_eval(_extract_sitekey_js(), task_id)
    try:
        eval_result = json.loads(eval_result_raw)
    except (json.JSONDecodeError, ValueError):
        eval_result = {"success": False}

    if not eval_result.get("success"):
        # JS eval not supported or failed — escalate to VNC
        return _escalation_response(
            "CAPTCHA detected but JS eval unavailable — use VNC to solve manually",
            task_id,
        )

    # Parse the sitekey extraction result
    raw_inner = eval_result.get("result", "")
    if isinstance(raw_inner, str):
        sitekey, subtype = _parse_sitekey_response(raw_inner)
    elif isinstance(raw_inner, dict):
        sitekey = raw_inner.get("sitekey")
        subtype = raw_inner.get("subtype", "unknown")
    else:
        sitekey, subtype = None, "unknown"

    if not sitekey:
        return _escalation_response(
            "CAPTCHA detected but could not extract sitekey — use VNC to solve manually",
            task_id,
        )

    # Step 2: Try CapSolver
    page_url = _get_page_url(task_id)
    token = _capsolver_solve(sitekey, page_url, subtype)

    if not token:
        return _escalation_response(
            f"{subtype} detected — CapSolver {'failed' if os.environ.get('CAPSOLVER_API_KEY') else 'unavailable (no API key)'}",
            task_id,
        )

    # Step 3: Inject token
    inject_js = _inject_token_js(subtype, token)
    if inject_js:
        _camofox_eval(inject_js, task_id)
        # Brief wait for page to react
        time.sleep(2)

    return {"captcha_solved": True, "method": "capsolver"}


def _escalation_response(hint: str, task_id: str) -> dict:
    """Build a VNC escalation response for the agent."""
    from tools.browser_camofox import get_vnc_url

    vnc_url = get_vnc_url()
    screenshot = ""
    try:
        from tools.browser_camofox import camofox_snapshot
        snap_raw = camofox_snapshot(task_id)
        snap = json.loads(snap_raw) if isinstance(snap_raw, str) else {}
        screenshot = snap.get("screenshot", "")
    except Exception:
        pass

    return {
        "captcha_escalation": {
            "vnc_url": vnc_url or "VNC not available",
            "hint": hint,
            "screenshot": screenshot,
        }
    }
```

- [ ] **Step 4: Run all cascade tests**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-agent-mt && python -m pytest tests/tools/test_captcha_cascade.py -v`
Expected: 16 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/juniperbevensee/Documents/GitHub/hermes-agent-mt
git add tools/captcha_cascade.py tests/tools/test_captcha_cascade.py
git commit -m "feat: captcha_cascade — try_solve orchestrator with VNC escalation"
```

---

## Task 4: Hook cascade into browser_tool.py

**Repo:** hermes-agent-mt
**Files:**
- Modify: `tools/browser_tool.py:2449-2455`

- [ ] **Step 1: Write failing integration test**

Create `tests/tools/test_captcha_cascade_integration.py`:

```python
"""Integration test: browser_tool bot-detection hooks into captcha_cascade."""

import json
from unittest.mock import patch, MagicMock

import pytest


class TestBotDetectionCascadeHook:
    """Verify browser_tool calls captcha_cascade when bot detection triggers."""

    @patch("tools.captcha_cascade.try_solve")
    @patch("tools.browser_camofox.is_camofox_mode", return_value=True)
    def test_cascade_called_on_bot_detection(self, mock_camofox, mock_cascade):
        """When bot_detection_warning is set, try_solve should be called."""
        mock_cascade.return_value = {"captcha_solved": True, "method": "capsolver"}

        # Import the hook function
        from tools.captcha_cascade import _maybe_run_cascade

        response = {"bot_detection_warning": "Page title 'captcha' suggests bot detection."}
        _maybe_run_cascade(response, "default")

        mock_cascade.assert_called_once_with("default")
        assert response.get("captcha_solved") is True
        assert "bot_detection_warning" not in response

    @patch("tools.captcha_cascade.try_solve")
    def test_cascade_not_called_without_warning(self, mock_cascade):
        from tools.captcha_cascade import _maybe_run_cascade

        response = {"success": True}
        _maybe_run_cascade(response, "default")

        mock_cascade.assert_not_called()

    @patch("tools.captcha_cascade.try_solve")
    @patch("tools.browser_camofox.is_camofox_mode", return_value=True)
    def test_escalation_added_to_response(self, mock_camofox, mock_cascade):
        from tools.captcha_cascade import _maybe_run_cascade

        mock_cascade.return_value = {
            "captcha_escalation": {"vnc_url": "http://100.1.2.3:6080", "hint": "reCAPTCHA", "screenshot": ""}
        }

        response = {"bot_detection_warning": "Page title 'captcha' suggests bot detection."}
        _maybe_run_cascade(response, "default")

        assert "captcha_escalation" in response
        assert response["captcha_escalation"]["vnc_url"] == "http://100.1.2.3:6080"
        # Warning kept when escalation happens (agent needs both signals)
        assert "bot_detection_warning" in response
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-agent-mt && python -m pytest tests/tools/test_captcha_cascade_integration.py -v`
Expected: FAIL — `ImportError: cannot import name '_maybe_run_cascade'`

- [ ] **Step 3: Add _maybe_run_cascade to captcha_cascade.py**

Add at the end of `tools/captcha_cascade.py`:

```python
def _maybe_run_cascade(response: dict, task_id: str = "default") -> None:
    """Hook for browser_tool — runs cascade if bot detection triggered.

    Mutates ``response`` in-place: removes bot_detection_warning on success,
    adds captcha_escalation on failure.
    """
    if "bot_detection_warning" not in response:
        return

    result = try_solve(task_id)
    if result is None:
        return  # Camofox not available, leave warning as-is

    if result.get("captcha_solved"):
        response.pop("bot_detection_warning", None)
        response["captcha_solved"] = True
        response["captcha_method"] = result.get("method", "unknown")
    elif result.get("captcha_escalation"):
        response["captcha_escalation"] = result["captcha_escalation"]
```

- [ ] **Step 4: Hook into browser_tool.py**

In `tools/browser_tool.py`, after line 2455 (after the `bot_detection_warning` block closes), add:

```python
        # CAPTCHA cascade — try auto-solve or escalate to VNC
        try:
            from tools.captcha_cascade import _maybe_run_cascade
            _maybe_run_cascade(response, task_id)
        except Exception:
            pass  # cascade is best-effort, never block navigation
```

This goes right after the existing block:
```python
        if any(pattern in title_lower for pattern in blocked_patterns):
            response["bot_detection_warning"] = (
                ...
            )

        # CAPTCHA cascade — try auto-solve or escalate to VNC   <-- NEW
        try:                                                       <-- NEW
            from tools.captcha_cascade import _maybe_run_cascade   <-- NEW
            _maybe_run_cascade(response, task_id)                  <-- NEW
        except Exception:                                          <-- NEW
            pass                                                   <-- NEW
```

- [ ] **Step 5: Run all tests**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-agent-mt && python -m pytest tests/tools/test_captcha_cascade.py tests/tools/test_captcha_cascade_integration.py -v`
Expected: 19 passed

- [ ] **Step 6: Commit**

```bash
cd /Users/juniperbevensee/Documents/GitHub/hermes-agent-mt
git add tools/captcha_cascade.py tools/browser_tool.py tests/tools/test_captcha_cascade_integration.py
git commit -m "feat: hook captcha_cascade into browser_tool bot-detection path"
```

---

## Task 5: WireGuard sidecar in compose generation

**Repo:** hermes-swarm-map
**Files:**
- Modify: `lib/services/harness.ts:71-115`

- [ ] **Step 1: Write failing test**

Check if a test file exists for harness compose generation. If not, create `lib/services/harness-compose.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

// We'll test the compose output by importing the function
// Since generateStandaloneCompose is module-private, we test via the public API
// or extract it. For now, test the output pattern.

describe('generateStandaloneCompose with VPN', () => {
  it('includes wireguard sidecar when vpnEnabled', async () => {
    // Import the module — the function is not exported, so we'll
    // need to either export it or test through createOverlay.
    // For now, verify the compose template string pattern.
    const { generateStandaloneCompose } = await import('./harness-compose')
    const compose = generateStandaloneCompose('test-agent', 8642, '/home/user/.hermes-test', { vpnEnabled: true })
    expect(compose).toContain('wireguard')
    expect(compose).toContain('network_mode: "service:wireguard"')
    expect(compose).toContain('NET_ADMIN')
    expect(compose).toContain('camofox')
  })

  it('excludes wireguard when vpnEnabled is false', async () => {
    const { generateStandaloneCompose } = await import('./harness-compose')
    const compose = generateStandaloneCompose('test-agent', 8642, '/home/user/.hermes-test', { vpnEnabled: false })
    expect(compose).not.toContain('wireguard')
    expect(compose).not.toContain('NET_ADMIN')
  })

  it('includes camofox with VNC when vpnEnabled', async () => {
    const { generateStandaloneCompose } = await import('./harness-compose')
    const compose = generateStandaloneCompose('test-agent', 8642, '/home/user/.hermes-test', { vpnEnabled: true })
    expect(compose).toContain('ENABLE_VNC=1')
    expect(compose).toContain('6080')
    expect(compose).toContain('9377')
  })
})
```

**Note:** The `generateStandaloneCompose` function is currently private (not exported). To test it cleanly, extract it to a new file `lib/services/harness-compose.ts` and export it, then import it in both `harness.ts` and the test. This follows the existing pattern where `config-yaml.ts` is a separate template file.

- [ ] **Step 2: Extract compose generation to `lib/services/harness-compose.ts`**

Create `lib/services/harness-compose.ts`:

```typescript
/**
 * Docker Compose generation for standalone Hermes agent deployments.
 * Supports optional WireGuard VPN sidecar + Camofox browser.
 */

export interface ComposeOptions {
  imageOrBuild?: { image: string } | { build: string }
  defaultImage?: string
  vpnEnabled?: boolean
  camofoxImage?: string
}

export function generateStandaloneCompose(
  agentName: string,
  port: number,
  agentDataDir: string,
  options: ComposeOptions = {},
): string {
  const { imageOrBuild, defaultImage, vpnEnabled, camofoxImage } = options
  const resolved = imageOrBuild ?? { image: defaultImage || 'ghcr.io/nimblecoai/hermes-agent:latest' }
  const sourceBlock = 'image' in resolved
    ? `    image: ${resolved.image}`
    : `    build:\n      context: ${resolved.build}\n      dockerfile: Dockerfile`

  const camofoxImg = camofoxImage || 'camofox-browser:latest'

  if (vpnEnabled) {
    return `# Generated by hermes-swarm-map — agent: ${agentName} (VPN + Camofox)
services:
  wireguard:
    image: lscr.io/linuxserver/wireguard:latest
    container_name: wg-${agentName}
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    sysctls:
      - net.ipv4.conf.all.src_valid_mark=1
    volumes:
      - ${agentDataDir}/wg-config:/config
    ports:
      - published: ${port}
        target: 8642
      - published: ${port + 1000}
        target: 9377
      - published: ${port + 2000}
        target: 6080
    restart: unless-stopped

  camofox:
    image: ${camofoxImg}
    container_name: camofox-${agentName}
    network_mode: "service:wireguard"
    depends_on:
      - wireguard
    environment:
      - CAMOFOX_PORT=9377
      - ENABLE_VNC=1
      - VNC_BIND=0.0.0.0
      - VNC_RESOLUTION=1920x1080
    volumes:
      - ${agentDataDir}/.camofox:/root/.camofox
    restart: unless-stopped

  hermes-${agentName}:
${sourceBlock}
    container_name: hermes-${agentName}
    user: "10000:10000"
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"
    env_file:
      - ${agentDataDir}/.env
    volumes:
      - ${agentDataDir}:/opt/data
    command: gateway
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    security_opt:
      - no-new-privileges
    read_only: true
    tmpfs:
      - /tmp
      - /var/tmp
      - /run
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '2.0'

networks:
  default:
    name: hermes-${agentName}
`
  }

  // Non-VPN: original compose (no Camofox, no WireGuard)
  return `# Generated by hermes-swarm-map — agent: ${agentName}
services:
  hermes-${agentName}:
${sourceBlock}
    container_name: hermes-${agentName}
    user: "10000:10000"
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"
    env_file:
      - ${agentDataDir}/.env
    ports:
      - published: ${port}
        target: 8642
    volumes:
      - ${agentDataDir}:/opt/data
    command: gateway
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    security_opt:
      - no-new-privileges
    read_only: true
    tmpfs:
      - /tmp
      - /var/tmp
      - /run
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '2.0'

networks:
  default:
    name: hermes-${agentName}
`
}
```

- [ ] **Step 3: Update harness.ts to use the extracted function**

In `lib/services/harness.ts`, replace the private `generateStandaloneCompose` function (lines 71-115) with an import:

```typescript
import { generateStandaloneCompose, type ComposeOptions } from './harness-compose'
```

Update all call sites of `generateStandaloneCompose()` to pass an options object:
- Line 837: `generateStandaloneCompose(newName, port, newDataDir, { imageOrBuild: resolveImageOrBuild(settings), defaultImage: settings?.defaultImage })`
- Line 893: `generateStandaloneCompose(input.name, port, agentDir, { imageOrBuild: resolveImageOrBuild(settings), defaultImage: settings?.defaultImage })`
- Line 1035: `generateStandaloneCompose(slug, port, workDir, { imageOrBuild: resolveImageOrBuild(settings), defaultImage: settings?.defaultImage })`

- [ ] **Step 4: Run tests**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map && npx vitest run lib/services/harness-compose.test.ts`
Expected: 3 passed

- [ ] **Step 5: Run existing tests to verify no regression**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map && npx vitest run lib/templates/config-yaml.test.ts`
Expected: 23 passed (existing tests still pass)

- [ ] **Step 6: Commit**

```bash
cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map
git add lib/services/harness-compose.ts lib/services/harness-compose.test.ts lib/services/harness.ts
git commit -m "feat: extract compose generation, add WireGuard + Camofox sidecar support"
```

---

## Task 6: VPN settings in HSM API + UI

**Repo:** hermes-swarm-map
**Files:**
- Modify: `app/api/harnesses/[id]/settings/route.ts`
- Modify: `components/harness/settings-tab.tsx`

- [ ] **Step 1: Add vpnEnabled to settings API (GET)**

In `app/api/harnesses/[id]/settings/route.ts`, add after the existing `COMMAND_APPROVAL_VAR` constant (~line 63):

```typescript
const VPN_ENABLED_VAR = 'VPN_ENABLED'
const CAPSOLVER_KEY_VAR = 'CAPSOLVER_API_KEY'
```

In the GET handler, after reading `commandApprovalAdminOnly` (~line 129), add:

```typescript
const vpnEnabled = env[VPN_ENABLED_VAR] === 'true'
const capsolverConfigured = !!env[CAPSOLVER_KEY_VAR]
```

Add to the response object:

```typescript
vpnEnabled,
capsolverConfigured,
```

- [ ] **Step 2: Add vpnEnabled to settings API (PUT)**

In the PUT handler, after the mention-gating write block (~line 231), add:

```typescript
// VPN toggle
if (body.vpnEnabled !== undefined) {
  const vpnValue = body.vpnEnabled ? 'true' : 'false'
  const vpnRegex = new RegExp(`^${VPN_ENABLED_VAR}=.*$`, 'm')
  if (vpnRegex.test(content)) {
    content = content.replace(vpnRegex, `${VPN_ENABLED_VAR}=${vpnValue}`)
  } else {
    content = content.trimEnd() + `\n${VPN_ENABLED_VAR}=${vpnValue}\n`
  }
}
```

- [ ] **Step 3: Add VPN toggle to settings UI**

In `components/harness/settings-tab.tsx`, after the mention-gating section (~line 263), add:

```tsx
{/* VPN / Browser Privacy */}
<div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
  <div className="flex items-center gap-2">
    <Shield className="h-4 w-4 text-muted-foreground" />
    <h3 className="font-medium text-sm">Browser VPN (WireGuard)</h3>
  </div>
  <div className="flex gap-3">
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input
        type="radio"
        name="vpnEnabled"
        checked={settings.vpnEnabled === true}
        onChange={() => { setSettings({ ...settings, vpnEnabled: true }); setDirty(true); setSaved(false) }}
        className="accent-[var(--accent)]"
      />
      Enabled
    </label>
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input
        type="radio"
        name="vpnEnabled"
        checked={settings.vpnEnabled !== true}
        onChange={() => { setSettings({ ...settings, vpnEnabled: false }); setDirty(true); setSaved(false) }}
        className="accent-[var(--accent)]"
      />
      Disabled
    </label>
  </div>
  <p className="text-xs text-muted-foreground">
    {settings.vpnEnabled
      ? 'Camofox browser traffic routes through WireGuard VPN for residential IP. Requires wg-config/wg0.conf in agent data dir.'
      : 'Browser uses host IP directly. Enable VPN for sites with aggressive bot detection.'}
  </p>
  {settings.capsolverConfigured && (
    <p className="text-xs text-green-500">CapSolver API key configured — CAPTCHAs will be auto-solved.</p>
  )}
</div>
```

- [ ] **Step 4: Verify UI builds**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map && npx next build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map
git add app/api/harnesses/\[id\]/settings/route.ts components/harness/settings-tab.tsx
git commit -m "feat: VPN toggle + CapSolver status in settings API and UI"
```

---

## Task 7: CAPTCHA escalation skill for agents

**Repo:** Per-agent (installed via HSM baseline templates)
**Files:**
- Create: Agent skill file (installed by `installBaselineTemplates`)

- [ ] **Step 1: Create the skill template**

The skill needs to be added to the HSM baseline templates so it's installed for all new agents. Check where templates live:

In `lib/services/templates.ts` (the `installBaselineTemplates` function), add the captcha-escalation skill to the template set.

Create the skill content as a constant in templates or as a file in a templates directory:

```markdown
# CAPTCHA Escalation

When `browser_navigate` or `browser_click` returns a response containing `captcha_escalation`, a CAPTCHA or bot-detection challenge was detected that couldn't be auto-solved.

## What to Do

1. **Send the user a DM** on your primary connected platform (Signal, Telegram, or Mattermost):
   - Include the VNC link from `captcha_escalation.vnc_url`
   - If a screenshot is available in `captcha_escalation.screenshot`, describe what you see
   - Explain what you were trying to do and what blocked you
   - Example: "I'm trying to buy tickets on Moshtix but hit a CAPTCHA I can't solve. You can take over the browser here: [VNC link]. Let me know when you're done."

2. **Wait for the user** to reply "done", "finished", "ok", or similar confirmation.

3. **Verify the page advanced** by calling `browser_snapshot` to check if the challenge is gone.

4. **If still blocked**, tell the user and offer the VNC link again.

5. **Once clear**, continue your original task from where you left off.

## When `captcha_solved` Appears Instead

If the response contains `captcha_solved: true`, the CAPTCHA was auto-solved (via CapSolver). No action needed — continue normally.

## Tips

- Don't retry the navigation immediately after escalation — the user needs time to solve it
- If `vnc_url` says "VNC not available", tell the user you can't provide a live browser link and ask them to solve it another way
- For payment pages (Apple Pay, credit card forms), extract the payment URL if visible and send it to the user instead of the VNC link
```

- [ ] **Step 2: Wire into installBaselineTemplates**

In `lib/services/templates.ts`, add the skill to the set of files installed for new agents. The skill should be written to `{dataDir}/skills/captcha-escalation/SKILL.md`.

- [ ] **Step 3: Commit**

```bash
cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map
git add lib/services/templates.ts
git commit -m "feat: add captcha-escalation skill to baseline agent templates"
```

---

## Task 8: End-to-end verification

- [ ] **Step 1: Run all hermes-agent-mt cascade tests**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-agent-mt && python -m pytest tests/tools/test_captcha_cascade.py tests/tools/test_captcha_cascade_integration.py -v`
Expected: All pass

- [ ] **Step 2: Run all hermes-swarm-map tests**

Run: `cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map && npx vitest run`
Expected: All existing + new tests pass

- [ ] **Step 3: Verify compose output manually**

Generate a compose with VPN enabled and inspect:

```bash
cd /Users/juniperbevensee/Documents/GitHub/hermes-swarm-map
node -e "
const { generateStandaloneCompose } = require('./lib/services/harness-compose');
console.log(generateStandaloneCompose('test', 8642, '/home/user/.hermes-test', { vpnEnabled: true }));
"
```

Verify: wireguard service present, camofox uses `network_mode: "service:wireguard"`, ports on wireguard container.

- [ ] **Step 4: Manual test with a real agent (via HSM)**

1. Set `CAPSOLVER_API_KEY` in personal agent's `.env`
2. Set `VPN_ENABLED=true` in personal agent's `.env`
3. Place a Mullvad `wg0.conf` in `~/.hermes/wg-config/`
4. Rebuild and restart via HSM
5. Ask the agent to browse a reCAPTCHA test page (e.g., Google's reCAPTCHA demo)
6. Verify: CapSolver solves it, or VNC escalation DM arrives

- [ ] **Step 5: Commit any fixes from manual testing**
