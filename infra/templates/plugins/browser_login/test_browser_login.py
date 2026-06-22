"""Tests for the browser_login HSM plugin.

All Camofox interactions are mocked via requests — no hermes-agent-mt imports
needed. Tests are self-sufficient with respect to the optional `requests`
dependency: anything that depends on `requests` truthiness patches it
explicitly, so the suite is green whether or not `requests` is installed.
"""

import json
import os
import sys
from unittest.mock import MagicMock

import pytest

# Add plugin directory to path so we can import the module directly
sys.path.insert(0, os.path.dirname(__file__))

from __init__ import (  # noqa: E402
    DEFAULT_DESCRIPTORS,
    _camofox_url,
    _vnc_url,
    _screenshot,
    _get_descriptors,
    _get_descriptor,
    _snapshot_text,
    _navigate,
    _probe_session,
    _handle_browser_login,
    _handle_check_login_status,
    register,
)


# ---------------------------------------------------------------------------
# Camofox / VNC helpers (copied from captcha_cascade — same contract)
# ---------------------------------------------------------------------------


class TestCamofoxUrl:
    def test_returns_env_var(self, monkeypatch):
        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377/")
        assert _camofox_url() == "http://localhost:9377"

    def test_returns_empty_when_not_set(self, monkeypatch):
        monkeypatch.delenv("CAMOFOX_URL", raising=False)
        assert _camofox_url() == ""


class TestVncUrl:
    def test_prefers_vnc_external_url_env(self, monkeypatch):
        monkeypatch.setenv("VNC_EXTERNAL_URL", "http://100.64.0.5:10642")
        monkeypatch.setenv("CAMOFOX_URL", "http://host.docker.internal:9377")
        import __init__ as mod
        monkeypatch.setattr(
            mod, "requests",
            MagicMock(get=MagicMock(side_effect=AssertionError("should not call /health"))),
        )
        assert _vnc_url() == "http://100.64.0.5:10642"

    def test_strips_trailing_slash_on_external_url(self, monkeypatch):
        monkeypatch.setenv("VNC_EXTERNAL_URL", "http://100.64.0.5:10642/")
        assert _vnc_url() == "http://100.64.0.5:10642"

    def test_returns_none_when_nothing_configured(self, monkeypatch):
        monkeypatch.delenv("VNC_EXTERNAL_URL", raising=False)
        monkeypatch.delenv("CAMOFOX_URL", raising=False)
        assert _vnc_url() is None


# ---------------------------------------------------------------------------
# Descriptor resolution (D3 — env over bundled defaults)
# ---------------------------------------------------------------------------


class TestGetDescriptors:
    def test_defaults_when_no_env(self, monkeypatch):
        monkeypatch.delenv("BROWSER_LOGIN_DESCRIPTORS", raising=False)
        d = _get_descriptors()
        assert d == DEFAULT_DESCRIPTORS

    def test_env_merges_over_defaults(self, monkeypatch):
        override = {
            "example": {
                "login_url": "https://example.test/login",
                "authed_probe_url": "https://example.test/home",
                "authed_signal": "Sign out",
                "login_form_signal": "Password",
            }
        }
        monkeypatch.setenv("BROWSER_LOGIN_DESCRIPTORS", json.dumps(override))
        d = _get_descriptors()
        assert d["example"]["login_url"] == "https://example.test/login"
        # bundled defaults still present
        for k in DEFAULT_DESCRIPTORS:
            assert k in d

    def test_env_overrides_a_default_platform(self, monkeypatch):
        # Pick whatever the first bundled default is and override its login_url
        if not DEFAULT_DESCRIPTORS:
            pytest.skip("no bundled defaults to override")
        name = next(iter(DEFAULT_DESCRIPTORS))
        override = {name: {**DEFAULT_DESCRIPTORS[name], "login_url": "https://overridden/login"}}
        monkeypatch.setenv("BROWSER_LOGIN_DESCRIPTORS", json.dumps(override))
        d = _get_descriptors()
        assert d[name]["login_url"] == "https://overridden/login"

    def test_malformed_env_falls_back_to_defaults(self, monkeypatch):
        monkeypatch.setenv("BROWSER_LOGIN_DESCRIPTORS", "{not valid json")
        d = _get_descriptors()
        assert d == DEFAULT_DESCRIPTORS

    def test_non_object_env_falls_back_to_defaults(self, monkeypatch):
        monkeypatch.setenv("BROWSER_LOGIN_DESCRIPTORS", json.dumps(["not", "an", "object"]))
        d = _get_descriptors()
        assert d == DEFAULT_DESCRIPTORS


class TestGetDescriptor:
    def test_known_platform(self, monkeypatch):
        override = {"acme": {"login_url": "https://acme/login",
                             "authed_probe_url": "https://acme/account",
                             "authed_signal": "Log out",
                             "login_form_signal": "Password"}}
        monkeypatch.setenv("BROWSER_LOGIN_DESCRIPTORS", json.dumps(override))
        desc = _get_descriptor("acme")
        assert desc is not None
        assert desc["authed_probe_url"] == "https://acme/account"

    def test_unknown_platform_returns_none(self, monkeypatch):
        monkeypatch.delenv("BROWSER_LOGIN_DESCRIPTORS", raising=False)
        assert _get_descriptor("does-not-exist-platform") is None


# ---------------------------------------------------------------------------
# Snapshot + navigate (Camofox REST)
# ---------------------------------------------------------------------------


def _mock_requests_with(tabs=None, snapshot=None, navigate_ok=True):
    """Build a MagicMock requests with GET /tabs, GET /snapshot, POST /navigate."""
    tabs = tabs if tabs is not None else [{"tabId": "t1", "userId": "u1"}]

    tabs_resp = MagicMock(status_code=200)
    tabs_resp.json.return_value = tabs

    snap_resp = MagicMock(status_code=200)
    snap_resp.json.return_value = snapshot if snapshot is not None else {"snapshot": ""}

    nav_resp = MagicMock(status_code=200 if navigate_ok else 500)
    nav_resp.raise_for_status = MagicMock()

    mock = MagicMock()

    def _get(url, *a, **k):
        if url.endswith("/tabs"):
            return tabs_resp
        if "/snapshot" in url:
            return snap_resp
        return MagicMock(status_code=404)

    def _post(url, *a, **k):
        if "/navigate" in url:
            return nav_resp
        if "/tabs" in url:
            return tabs_resp
        return MagicMock(status_code=404)

    mock.get.side_effect = _get
    mock.post.side_effect = _post
    return mock


class TestSnapshotText:
    def test_extracts_text_from_snapshot(self, monkeypatch):
        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        import __init__ as mod
        snap = {"snapshot": "Welcome back. Sign out menu visible."}
        monkeypatch.setattr(mod, "requests", _mock_requests_with(snapshot=snap))
        text = _snapshot_text("task-1")
        assert "Sign out" in text

    def test_handles_arbitrary_shape(self, monkeypatch):
        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        import __init__ as mod
        snap = {"tree": [{"role": "button", "name": "Log out"}]}
        monkeypatch.setattr(mod, "requests", _mock_requests_with(snapshot=snap))
        text = _snapshot_text("task-1")
        assert "Log out" in text  # whole response stringified, robust to shape

    def test_no_camofox_returns_empty(self, monkeypatch):
        monkeypatch.delenv("CAMOFOX_URL", raising=False)
        assert _snapshot_text("task-1") == ""


class TestNavigate:
    def test_navigate_success(self, monkeypatch):
        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        import __init__ as mod
        monkeypatch.setattr(mod, "requests", _mock_requests_with(navigate_ok=True))
        assert _navigate("https://example.com/login", "task-1") is True

    def test_navigate_no_camofox(self, monkeypatch):
        monkeypatch.delenv("CAMOFOX_URL", raising=False)
        assert _navigate("https://example.com/login", "task-1") is False


# ---------------------------------------------------------------------------
# Session probe
# ---------------------------------------------------------------------------


DESC = {
    "login_url": "https://example.com/login",
    "authed_probe_url": "https://example.com/account",
    "authed_signal": "Sign out",
    "login_form_signal": "Password",
}


class TestProbeSession:
    def test_authenticated_when_authed_signal_present(self, monkeypatch):
        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        import __init__ as mod
        monkeypatch.setattr(mod, "_navigate", lambda url, tid: True)
        monkeypatch.setattr(mod, "_snapshot_text", lambda tid: "Account home — Sign out")
        assert _probe_session(DESC, "task-1") == "authenticated"

    def test_login_required_when_authed_signal_absent(self, monkeypatch):
        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        import __init__ as mod
        monkeypatch.setattr(mod, "_navigate", lambda url, tid: True)
        monkeypatch.setattr(mod, "_snapshot_text", lambda tid: "Please log in. Password field.")
        assert _probe_session(DESC, "task-1") == "login_required"

    def test_login_required_on_navigate_failure(self, monkeypatch):
        # If we cannot even navigate to confirm auth, fail safe to login_required.
        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        import __init__ as mod
        monkeypatch.setattr(mod, "_navigate", lambda url, tid: False)
        monkeypatch.setattr(mod, "_snapshot_text", lambda tid: "")
        assert _probe_session(DESC, "task-1") == "login_required"

    def test_passive_probe_does_not_navigate(self, monkeypatch):
        # navigate=False must observe the current page WITHOUT navigating — it
        # would otherwise yank a human's tab mid-login (the single shared tab).
        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        import __init__ as mod

        def _boom(url, tid):
            raise AssertionError("passive probe must not navigate")

        monkeypatch.setattr(mod, "_navigate", _boom)
        monkeypatch.setattr(mod, "_snapshot_text", lambda tid: "Dashboard — Sign out")
        assert _probe_session(DESC, "task-1", navigate=False) == "authenticated"

    def test_passive_probe_login_required_when_signal_absent(self, monkeypatch):
        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        import __init__ as mod
        monkeypatch.setattr(mod, "_navigate", lambda u, t: (_ for _ in ()).throw(
            AssertionError("must not navigate")))
        monkeypatch.setattr(mod, "_snapshot_text", lambda tid: "Password login form")
        assert _probe_session(DESC, "task-1", navigate=False) == "login_required"


# ---------------------------------------------------------------------------
# browser_login handler
# ---------------------------------------------------------------------------


class TestHandleBrowserLogin:
    def test_no_camofox_returns_error(self, monkeypatch):
        monkeypatch.delenv("CAMOFOX_URL", raising=False)
        result = json.loads(_handle_browser_login("acme", "task-1"))
        assert result["status"] == "error"
        assert "Camofox" in result["error"]

    def test_unknown_platform_returns_error(self, monkeypatch):
        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        monkeypatch.delenv("BROWSER_LOGIN_DESCRIPTORS", raising=False)
        result = json.loads(_handle_browser_login("no-such-platform", "task-1"))
        assert result["status"] == "error"
        assert "platform" in result["error"].lower()

    def test_authenticated_path(self, monkeypatch):
        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        monkeypatch.setenv("BROWSER_LOGIN_DESCRIPTORS", json.dumps({"acme": DESC}))
        import __init__ as mod
        monkeypatch.setattr(mod, "_probe_session", lambda d, tid: "authenticated")
        result = json.loads(_handle_browser_login("acme", "task-1"))
        assert result["status"] == "authenticated"
        assert result["platform"] == "acme"
        assert "login_escalation" not in result

    def test_login_required_emits_escalation(self, monkeypatch):
        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        monkeypatch.setenv("BROWSER_LOGIN_DESCRIPTORS", json.dumps({"acme": DESC}))
        import __init__ as mod
        monkeypatch.setattr(mod, "_probe_session", lambda d, tid: "login_required")
        monkeypatch.setattr(mod, "_navigate", lambda url, tid: True)
        monkeypatch.setattr(mod, "_vnc_url", lambda: "http://100.64.0.5:10642")
        monkeypatch.setattr(mod, "_screenshot", lambda: "base64shot")
        result = json.loads(_handle_browser_login("acme", "task-1"))
        assert result["status"] == "login_required"
        assert result["platform"] == "acme"
        esc = result["login_escalation"]
        assert esc["vnc_url"] == "http://100.64.0.5:10642"
        assert esc["screenshot"] == "base64shot"
        assert "hint" in esc

    def test_login_required_navigates_to_login_url(self, monkeypatch):
        # The human must land on the login page in the VNC view.
        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        monkeypatch.setenv("BROWSER_LOGIN_DESCRIPTORS", json.dumps({"acme": DESC}))
        import __init__ as mod
        monkeypatch.setattr(mod, "_probe_session", lambda d, tid: "login_required")
        navigated = {}
        monkeypatch.setattr(mod, "_navigate", lambda url, tid: navigated.update(url=url) or True)
        monkeypatch.setattr(mod, "_vnc_url", lambda: None)
        monkeypatch.setattr(mod, "_screenshot", lambda: "")
        json.loads(_handle_browser_login("acme", "task-1"))
        assert navigated.get("url") == DESC["login_url"]

    def test_login_required_handles_missing_vnc(self, monkeypatch):
        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        monkeypatch.setenv("BROWSER_LOGIN_DESCRIPTORS", json.dumps({"acme": DESC}))
        import __init__ as mod
        monkeypatch.setattr(mod, "_probe_session", lambda d, tid: "login_required")
        monkeypatch.setattr(mod, "_navigate", lambda url, tid: True)
        monkeypatch.setattr(mod, "_vnc_url", lambda: None)
        monkeypatch.setattr(mod, "_screenshot", lambda: "")
        result = json.loads(_handle_browser_login("acme", "task-1"))
        assert result["status"] == "login_required"
        assert result["login_escalation"]["vnc_url"]  # non-empty fallback string


# ---------------------------------------------------------------------------
# check_login_status handler
# ---------------------------------------------------------------------------


class TestHandleCheckLoginStatus:
    def test_no_camofox_returns_error(self, monkeypatch):
        monkeypatch.delenv("CAMOFOX_URL", raising=False)
        result = json.loads(_handle_check_login_status("acme", "task-1"))
        assert result["status"] == "error"

    def test_unknown_platform_returns_error(self, monkeypatch):
        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        monkeypatch.delenv("BROWSER_LOGIN_DESCRIPTORS", raising=False)
        result = json.loads(_handle_check_login_status("no-such", "task-1"))
        assert result["status"] == "error"

    def test_poll_transitions_login_required_to_authenticated(self, monkeypatch):
        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        monkeypatch.setenv("BROWSER_LOGIN_DESCRIPTORS", json.dumps({"acme": DESC}))
        import __init__ as mod

        # Pass navigate kwarg through so we also assert it's invoked passively.
        states = iter(["login_required", "authenticated"])
        seen_navigate = []

        def fake_probe(d, tid, navigate=True):
            seen_navigate.append(navigate)
            return next(states)

        monkeypatch.setattr(mod, "_probe_session", fake_probe)

        first = json.loads(_handle_check_login_status("acme", "task-1"))
        assert first["status"] == "login_required"
        second = json.loads(_handle_check_login_status("acme", "task-1"))
        assert second["status"] == "authenticated"
        assert second["platform"] == "acme"
        # check_login_status must always probe passively (navigate=False)
        assert seen_navigate == [False, False]

    def test_check_status_does_not_navigate_end_to_end(self, monkeypatch):
        # Without stubbing _probe_session: prove check_login_status never calls
        # _navigate (the HIGH-severity race fix). Only _snapshot_text is read.
        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        monkeypatch.setenv("BROWSER_LOGIN_DESCRIPTORS", json.dumps({"acme": DESC}))
        import __init__ as mod

        def _boom(url, tid):
            raise AssertionError("check_login_status must not navigate")

        monkeypatch.setattr(mod, "_navigate", _boom)
        monkeypatch.setattr(mod, "_snapshot_text", lambda tid: "Welcome — Sign out")
        result = json.loads(_handle_check_login_status("acme", "task-1"))
        assert result["status"] == "authenticated"


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


class TestRegister:
    def test_registers_both_tools(self, monkeypatch):
        monkeypatch.setenv("CAMOFOX_URL", "http://localhost:9377")
        import __init__ as mod
        monkeypatch.setattr(mod, "requests", MagicMock())  # ensure truthy regardless of env
        ctx = MagicMock()
        register(ctx)
        names = {c.kwargs.get("name") or c.args[0] for c in ctx.register_tool.call_args_list}
        assert "browser_login" in names
        assert "check_login_status" in names
        assert ctx.register_tool.call_count == 2

    def test_registers_without_camofox(self, monkeypatch):
        monkeypatch.delenv("CAMOFOX_URL", raising=False)
        import __init__ as mod
        monkeypatch.setattr(mod, "requests", MagicMock())
        ctx = MagicMock()
        register(ctx)
        # Still registers — tools check Camofox at call time
        assert ctx.register_tool.call_count == 2

    def test_skips_when_no_requests(self, monkeypatch):
        import __init__ as mod
        monkeypatch.setattr(mod, "requests", None)
        ctx = MagicMock()
        register(ctx)
        ctx.register_tool.assert_not_called()
