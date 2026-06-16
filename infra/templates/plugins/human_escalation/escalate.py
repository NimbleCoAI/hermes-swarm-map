"""Chat-send helpers for escalate_to_human + check_pending_escalation handlers.

Approach A' (no-patch async): escalate_to_human posts a prompt to the user's chat
and RETURNS -- the turn ends. The reply resolves via check_pending_escalation on the
next turn, nudged by the pre_gateway_dispatch hook (dispatch_hook.py).

This module intentionally contains ONLY the three primitive helpers. The tool
handlers (escalate_to_human, check_pending_escalation) live in Tasks 3 and 4.
"""

import json
import os
from typing import Optional

try:
    from gateway.session_context import get_session_env
except ImportError:  # outside the hermes runtime (unit tests)
    def get_session_env(name: str, default: str = "") -> str:
        return os.environ.get(name, default)

try:
    # Preferred: package-style import when the plugin dir is a proper package
    # on sys.path (runtime) or when the module is registered in sys.modules
    # as a package (some test harnesses do this).
    from store import EscalationStore  # type: ignore[assignment]
except ModuleNotFoundError:
    # Fallback: load store.py relative to this file via importlib. This handles
    # the importlib.util.spec_from_file_location + submodule_search_locations
    # test pattern where the plugin dir is not on sys.path but __file__ is set.
    import importlib.util as _ilu
    import sys as _sys
    _store_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "store.py")
    _store_spec = _ilu.spec_from_file_location("_he_store", _store_path)
    _store_mod = _ilu.module_from_spec(_store_spec)
    _store_spec.loader.exec_module(_store_mod)
    EscalationStore = _store_mod.EscalationStore


def _session_target() -> str:
    """Return the send_message target string for the active session.

    Format: ``platform:chat_id`` or ``platform:chat_id:thread_id`` when a
    thread is present. Returns an empty string when platform or chat_id are
    not available in the session environment (e.g. CLI context).
    """
    platform = get_session_env("HERMES_SESSION_PLATFORM", "")
    chat_id = get_session_env("HERMES_SESSION_CHAT_ID", "")
    thread_id = get_session_env("HERMES_SESSION_THREAD_ID", "")
    if not platform or not chat_id:
        return ""
    target = f"{platform}:{chat_id}"
    if thread_id:
        target = f"{target}:{thread_id}"
    return target


def _dispatch_send_message(target: str, message: str) -> str:
    """Dispatch the built-in send_message tool directly.

    Implementation note: ``send_message_tool`` (tools/send_message_tool.py,
    line 150) is a plain synchronous function with signature
    ``send_message_tool(args, **kw) -> str``. It accepts ``action``, ``target``,
    and ``message`` in the args dict and returns a JSON string. Calling it
    directly avoids needing the tool to be registered in the registry (which
    requires full agent startup) while remaining fully correct at runtime.

    This function is isolated so tests can monkeypatch it without importing any
    gateway code.
    """
    try:
        from tools.send_message_tool import send_message_tool
    except ImportError as exc:
        raise RuntimeError(
            "_dispatch_send_message: tools.send_message_tool is unavailable in this runtime context"
        ) from exc
    return send_message_tool({"action": "send", "target": target, "message": message})


def _send_to_chat(target: str, message: str) -> str:
    """Send *message* to *target* via the built-in send_message tool."""
    return _dispatch_send_message(target, message)


_DEFAULT_TIMEOUT_S = 300

_RESUME_INSTRUCTION = (
    "I have sent your request to the user and recorded a pending escalation. "
    "END YOUR TURN NOW and wait for their reply -- do not poll or loop. When they "
    "respond, call check_pending_escalation to retrieve and clear it, then continue "
    "from where you left off."
)


def _render_message(kind: str, prompt: str, payload: Optional[dict]) -> str:
    payload = payload or {}
    parts = [prompt]
    if kind == "confirmation":
        items = payload.get("line_items") or []
        if items:
            parts.append("")
            parts.extend(f"  • {it}" for it in items)
        total = payload.get("total")
        if total:
            parts.append("")
            parts.append(f"TOTAL: {total}")
        parts.append("")
        parts.append("Reply YES to confirm and charge, or anything else to cancel.")
    elif kind == "link_handoff":
        url = payload.get("url")
        if url:
            parts.append("")
            parts.append(url)
        media = payload.get("media_path")
        if media:
            parts.append(f"MEDIA:{media}")
        parts.append("")
        parts.append("Reply DONE when finished.")
    elif kind == "code_request":
        parts.append("")
        parts.append("Reply with the code.")
    return "\n".join(parts)


def escalate_to_human(args: dict, **_kw) -> str:
    kind = (args.get("kind") or "freeform").strip()
    prompt = args.get("prompt") or ""
    payload = args.get("payload") or {}
    try:
        timeout_s = int(args.get("timeout_s") or _DEFAULT_TIMEOUT_S)
    except (ValueError, TypeError):
        timeout_s = _DEFAULT_TIMEOUT_S

    if kind not in {"code_request", "confirmation", "link_handoff", "freeform"}:
        return json.dumps({"error": f"unknown kind: {kind}"})
    if not prompt:
        return json.dumps({"error": "prompt is required"})

    target = _session_target()
    if not target:
        return json.dumps({"error": "no active chat session (HERMES_SESSION_PLATFORM/CHAT_ID unset)"})

    platform = get_session_env("HERMES_SESSION_PLATFORM", "")
    chat_id = get_session_env("HERMES_SESSION_CHAT_ID", "")
    user_id = get_session_env("HERMES_SESSION_USER_ID", "")

    store = EscalationStore()
    escal_id = store.create(platform, chat_id, user_id, kind, prompt, timeout_s=timeout_s)

    message = _render_message(kind, prompt, payload)
    send_result = _send_to_chat(target, message)

    return json.dumps({
        "status": "awaiting",
        "escal_id": escal_id,
        "kind": kind,
        "instruction": _RESUME_INSTRUCTION,
        "send_result": send_result,
    })


def check_pending_escalation(args: dict, **_kw) -> str:
    platform = get_session_env("HERMES_SESSION_PLATFORM", "")
    chat_id = get_session_env("HERMES_SESSION_CHAT_ID", "")
    if not platform or not chat_id:
        return json.dumps({"status": "none"})

    store = EscalationStore()
    rec = store.get_active(platform, chat_id)
    if rec is None:
        return json.dumps({"status": "none"})
    store.resolve(platform, chat_id)  # clear it; the user's latest message is the answer
    return json.dumps({
        "status": "found",
        "kind": rec["kind"],
        "prompt": rec["prompt"],
        "escal_id": rec["escal_id"],
        "note": ("The user's most recent message is the answer to this escalation. "
                 "For kind=confirmation, proceed to submit/charge ONLY if the reply is "
                 "affirmative (yes/confirm/y); otherwise abort and report nothing was charged."),
    })
