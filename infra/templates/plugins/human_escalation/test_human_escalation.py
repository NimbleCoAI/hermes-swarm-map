"""Co-located tests for the human_escalation HSM plugin.

Consolidates the four source suites (store / escalate / hook / integration)
from hermes-agent. In this standalone location the plugin dir IS this test
file's own directory, so modules are loaded by __file__ via importlib --
matching the captcha_cascade test convention (no hermes-agent imports needed).
"""

import importlib.util
import json
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

# The plugin dir is this test file's own directory.
_PKG = Path(__file__).parent
_STORE_PATH = _PKG / "store.py"


# ---------------------------------------------------------------------------
# store.py
# ---------------------------------------------------------------------------


def _load_store(monkeypatch, tmp_path):
    """Import store.py fresh with HERMES_HOME pointed at a temp dir."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    spec = importlib.util.spec_from_file_location("he_store_under_test", _STORE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.EscalationStore()


def test_create_then_get_active_returns_record(monkeypatch, tmp_path):
    store = _load_store(monkeypatch, tmp_path)
    escal_id = store.create("signal", "chat1", "user1", "code_request",
                            "Reply with the SMS code", timeout_s=300)
    assert escal_id
    rec = store.get_active("signal", "chat1")
    assert rec is not None
    assert rec["kind"] == "code_request"
    assert rec["prompt"] == "Reply with the SMS code"
    assert rec["status"] == "pending"


def test_get_active_none_when_no_record(monkeypatch, tmp_path):
    store = _load_store(monkeypatch, tmp_path)
    assert store.get_active("signal", "nope") is None


def test_expired_record_is_not_active(monkeypatch, tmp_path):
    store = _load_store(monkeypatch, tmp_path)
    store.create("signal", "chat1", "user1", "confirmation", "Confirm $5", timeout_s=1)
    data = store._load()
    data["signal:chat1"]["created_at"] = time.time() - 10
    store._write(data)
    assert store.get_active("signal", "chat1") is None


def test_resolve_clears_record_and_returns_it(monkeypatch, tmp_path):
    store = _load_store(monkeypatch, tmp_path)
    store.create("signal", "chat1", "user1", "code_request", "code?", timeout_s=300)
    rec = store.resolve("signal", "chat1")
    assert rec is not None and rec["kind"] == "code_request"
    assert store.get_active("signal", "chat1") is None


def test_new_create_overwrites_prior_active_for_same_conversation(monkeypatch, tmp_path):
    store = _load_store(monkeypatch, tmp_path)
    store.create("signal", "chat1", "user1", "code_request", "first", timeout_s=300)
    store.create("signal", "chat1", "user1", "confirmation", "second", timeout_s=300)
    rec = store.get_active("signal", "chat1")
    assert rec["prompt"] == "second"


# ---------------------------------------------------------------------------
# escalate.py
# ---------------------------------------------------------------------------


def _load_escalate(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    spec = importlib.util.spec_from_file_location(
        "he_escalate_under_test", _PKG / "escalate.py",
        submodule_search_locations=[str(_PKG)],
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestSessionTarget:
    def test_target_from_platform_and_chat(self, monkeypatch, tmp_path):
        mod = _load_escalate(monkeypatch, tmp_path)
        monkeypatch.setenv("HERMES_SESSION_PLATFORM", "signal")
        monkeypatch.setenv("HERMES_SESSION_CHAT_ID", "group:abc")
        monkeypatch.delenv("HERMES_SESSION_THREAD_ID", raising=False)
        assert mod._session_target() == "signal:group:abc"

    def test_target_includes_thread_when_present(self, monkeypatch, tmp_path):
        mod = _load_escalate(monkeypatch, tmp_path)
        monkeypatch.setenv("HERMES_SESSION_PLATFORM", "telegram")
        monkeypatch.setenv("HERMES_SESSION_CHAT_ID", "-100123")
        monkeypatch.setenv("HERMES_SESSION_THREAD_ID", "17")
        assert mod._session_target() == "telegram:-100123:17"

    def test_target_empty_when_no_session(self, monkeypatch, tmp_path):
        mod = _load_escalate(monkeypatch, tmp_path)
        for k in ("HERMES_SESSION_PLATFORM", "HERMES_SESSION_CHAT_ID"):
            monkeypatch.delenv(k, raising=False)
        assert mod._session_target() == ""


class TestSendToChat:
    def test_send_dispatches_send_message(self, monkeypatch, tmp_path):
        mod = _load_escalate(monkeypatch, tmp_path)
        calls = {}
        monkeypatch.setattr(mod, "_dispatch_send_message",
                            lambda target, message: calls.update(target=target, message=message) or '{"ok":true}')
        out = mod._send_to_chat("signal:c1", "hello")
        assert calls["target"] == "signal:c1"
        assert calls["message"] == "hello"
        assert out == '{"ok":true}'


class TestEscalateToHuman:
    def _prep(self, mod, monkeypatch):
        monkeypatch.setenv("HERMES_SESSION_PLATFORM", "signal")
        monkeypatch.setenv("HERMES_SESSION_CHAT_ID", "c1")
        monkeypatch.setenv("HERMES_SESSION_USER_ID", "u1")
        sent = {}
        monkeypatch.setattr(mod, "_send_to_chat",
                            lambda target, message: sent.update(target=target, message=message) or '{"ok":true}')
        return sent

    def test_code_request_writes_record_and_sends(self, monkeypatch, tmp_path):
        mod = _load_escalate(monkeypatch, tmp_path)
        sent = self._prep(mod, monkeypatch)
        out = json.loads(mod.escalate_to_human({"kind": "code_request", "prompt": "Reply with the SMS code"}))
        assert out["status"] == "awaiting"
        assert out["escal_id"]
        assert "SMS code" in sent["message"]
        rec = mod.EscalationStore().get_active("signal", "c1")
        assert rec["kind"] == "code_request"

    def test_confirmation_renders_line_items_and_total(self, monkeypatch, tmp_path):
        mod = _load_escalate(monkeypatch, tmp_path)
        sent = self._prep(mod, monkeypatch)
        mod.escalate_to_human({
            "kind": "confirmation",
            "prompt": "Confirm this purchase",
            "payload": {"line_items": ["2x GA"], "total": "$94.50"},
        })
        assert "2x GA" in sent["message"]
        assert "$94.50" in sent["message"]

    def test_link_handoff_includes_url(self, monkeypatch, tmp_path):
        mod = _load_escalate(monkeypatch, tmp_path)
        sent = self._prep(mod, monkeypatch)
        mod.escalate_to_human({
            "kind": "link_handoff",
            "prompt": "Finish this step here",
            "payload": {"url": "https://vnc.example/x"},
        })
        assert "https://vnc.example/x" in sent["message"]

    def test_errors_when_no_session(self, monkeypatch, tmp_path):
        mod = _load_escalate(monkeypatch, tmp_path)
        for k in ("HERMES_SESSION_PLATFORM", "HERMES_SESSION_CHAT_ID"):
            monkeypatch.delenv(k, raising=False)
        out = json.loads(mod.escalate_to_human({"kind": "freeform", "prompt": "hi"}))
        assert "error" in out

    def test_non_numeric_timeout_falls_back_to_default(self, monkeypatch, tmp_path):
        mod = _load_escalate(monkeypatch, tmp_path)
        self._prep(mod, monkeypatch)
        out = json.loads(mod.escalate_to_human({"kind": "freeform", "prompt": "hi", "timeout_s": "fast"}))
        assert out["status"] == "awaiting"  # did not crash
        rec = mod.EscalationStore().get_active("signal", "c1")
        assert rec["timeout_s"] == 300


class TestCheckPending:
    def test_returns_found_and_clears(self, monkeypatch, tmp_path):
        mod = _load_escalate(monkeypatch, tmp_path)
        monkeypatch.setenv("HERMES_SESSION_PLATFORM", "signal")
        monkeypatch.setenv("HERMES_SESSION_CHAT_ID", "c1")
        mod.EscalationStore().create("signal", "c1", "u1", "code_request", "code?", timeout_s=300)
        out = json.loads(mod.check_pending_escalation({}))
        assert out["status"] == "found"
        assert out["kind"] == "code_request"
        out2 = json.loads(mod.check_pending_escalation({}))
        assert out2["status"] == "none"

    def test_none_when_nothing_pending(self, monkeypatch, tmp_path):
        mod = _load_escalate(monkeypatch, tmp_path)
        monkeypatch.setenv("HERMES_SESSION_PLATFORM", "signal")
        monkeypatch.setenv("HERMES_SESSION_CHAT_ID", "c1")
        out = json.loads(mod.check_pending_escalation({}))
        assert out["status"] == "none"


# ---------------------------------------------------------------------------
# dispatch_hook.py
# ---------------------------------------------------------------------------


def _load_hook(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    spec = importlib.util.spec_from_file_location(
        "he_hook_under_test", _PKG / "dispatch_hook.py",
        submodule_search_locations=[str(_PKG)],
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _event(platform="signal", chat_id="c1", text="123456"):
    """Mirror the real gateway MessageEvent shape: platform/chat_id live on a
    nested ``source`` (SessionSource), and ``source.platform`` is an enum whose
    ``.value`` is the platform string used as the EscalationStore key.
    """
    source = SimpleNamespace(
        platform=SimpleNamespace(value=platform),
        chat_id=chat_id,
    )
    return SimpleNamespace(source=source, text=text)


def test_no_pending_returns_none(monkeypatch, tmp_path):
    mod = _load_hook(monkeypatch, tmp_path)
    assert mod.pre_gateway_dispatch(event=_event(), gateway=None, session_store=None) is None


def test_pending_rewrites_text_with_resume_prefix(monkeypatch, tmp_path):
    mod = _load_hook(monkeypatch, tmp_path)
    mod.EscalationStore().create("signal", "c1", "u1", "code_request",
                                 "Reply with the SMS code", timeout_s=300)
    out = mod.pre_gateway_dispatch(event=_event(text="123456"), gateway=None, session_store=None)
    assert out is not None and out["action"] == "rewrite"
    assert "123456" in out["text"]
    assert "check_pending_escalation" in out["text"]
    assert "Reply with the SMS code" in out["text"]


def test_pending_for_other_conversation_is_ignored(monkeypatch, tmp_path):
    mod = _load_hook(monkeypatch, tmp_path)
    mod.EscalationStore().create("signal", "OTHER", "u1", "code_request", "x", timeout_s=300)
    assert mod.pre_gateway_dispatch(event=_event(chat_id="c1"), gateway=None, session_store=None) is None


def test_none_event_returns_none(monkeypatch, tmp_path):
    mod = _load_hook(monkeypatch, tmp_path)
    assert mod.pre_gateway_dispatch(event=None, gateway=None, session_store=None) is None


def test_missing_source_returns_none(monkeypatch, tmp_path):
    mod = _load_hook(monkeypatch, tmp_path)
    mod.EscalationStore().create("signal", "c1", "u1", "code_request", "x", timeout_s=300)
    bad = SimpleNamespace(text="hi")  # no .source attribute
    assert mod.pre_gateway_dispatch(event=bad, gateway=None, session_store=None) is None


def test_plain_string_platform_also_supported(monkeypatch, tmp_path):
    """Defensive: if a future/synthetic event carries a plain string platform
    (no ``.value``), the hook should still resolve it correctly."""
    mod = _load_hook(monkeypatch, tmp_path)
    mod.EscalationStore().create("signal", "c1", "u1", "code_request",
                                 "Reply with the SMS code", timeout_s=300)
    source = SimpleNamespace(platform="signal", chat_id="c1")
    event = SimpleNamespace(source=source, text="123456")
    out = mod.pre_gateway_dispatch(event=event, gateway=None, session_store=None)
    assert out is not None and out["action"] == "rewrite"
    assert "123456" in out["text"]


# ---------------------------------------------------------------------------
# integration: full A' cycle (escalate -> hook rewrite -> check_pending)
# ---------------------------------------------------------------------------


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, _PKG / file,
                                                  submodule_search_locations=[str(_PKG)])
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _reply_event(platform="signal", chat_id="c1", text="445566"):
    # Mirror the real MessageEvent shape the hook reads: event.source.platform.value / .chat_id
    return SimpleNamespace(
        text=text,
        source=SimpleNamespace(platform=SimpleNamespace(value=platform), chat_id=chat_id),
    )


def test_full_escalate_reply_resume_cycle(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("HERMES_SESSION_PLATFORM", "signal")
    monkeypatch.setenv("HERMES_SESSION_CHAT_ID", "c1")
    monkeypatch.setenv("HERMES_SESSION_USER_ID", "u1")

    escalate = _load("he_e", "escalate.py")
    hook = _load("he_h", "dispatch_hook.py")
    monkeypatch.setattr(escalate, "_send_to_chat", lambda target, message: '{"ok":true}')

    # Confirm both separately-loaded modules share the same pending.json path.
    e_path = escalate.EscalationStore()._path
    h_path = hook.EscalationStore()._path
    assert e_path == h_path, (
        f"Store-path mismatch: escalate resolves {e_path}, hook resolves {h_path}. "
        "The cross-module store-path is inconsistent — the plugin's store path is "
        "unstable in the real runtime too."
    )

    # 1. Agent escalates for a code.
    out = json.loads(escalate.escalate_to_human({"kind": "code_request", "prompt": "Reply with the SMS code"}))
    assert out["status"] == "awaiting"

    # 2. User replies "445566" -- hook rewrites it with a resume nudge.
    ev = _reply_event(text="445566")
    rewritten = hook.pre_gateway_dispatch(event=ev, gateway=None, session_store=None)
    assert rewritten is not None and rewritten["action"] == "rewrite"
    assert "445566" in rewritten["text"]
    assert "check_pending_escalation" in rewritten["text"]

    # 3. Resumed turn: check_pending_escalation returns the code request and clears it.
    found = json.loads(escalate.check_pending_escalation({}))
    assert found["status"] == "found"
    assert found["kind"] == "code_request"

    # 4. Idempotent: a second check finds nothing pending.
    assert json.loads(escalate.check_pending_escalation({}))["status"] == "none"


def test_confirmation_decline_path_records_then_resolves(monkeypatch, tmp_path):
    """A confirmation escalation is recorded, the hook nudges on reply, and check_pending
    returns kind=confirmation so the skill can enforce the affirmative-only gate."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("HERMES_SESSION_PLATFORM", "signal")
    monkeypatch.setenv("HERMES_SESSION_CHAT_ID", "c1")
    monkeypatch.setenv("HERMES_SESSION_USER_ID", "u1")

    escalate = _load("he_e2", "escalate.py")
    hook = _load("he_h2", "dispatch_hook.py")
    monkeypatch.setattr(escalate, "_send_to_chat", lambda target, message: '{"ok":true}')

    out = json.loads(escalate.escalate_to_human({
        "kind": "confirmation", "prompt": "Confirm this purchase",
        "payload": {"line_items": ["2x GA"], "total": "$94.50"},
    }))
    assert out["status"] == "awaiting" and out["kind"] == "confirmation"

    ev = _reply_event(text="no")
    rewritten = hook.pre_gateway_dispatch(event=ev, gateway=None, session_store=None)
    assert rewritten["action"] == "rewrite" and "no" in rewritten["text"]

    found = json.loads(escalate.check_pending_escalation({}))
    assert found["status"] == "found" and found["kind"] == "confirmation"
    # The skill is responsible for interpreting "no" as non-affirmative -> abort.
