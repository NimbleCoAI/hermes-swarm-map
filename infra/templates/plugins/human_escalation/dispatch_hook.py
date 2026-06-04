"""pre_gateway_dispatch hook: when a reply arrives for a conversation with a pending
escalation, rewrite the inbound text to nudge the agent to resume the checkout.

Zero-divergence resume mechanism -- lives entirely in the plugin, patches no gateway
source. Registered against the ``pre_gateway_dispatch`` hook (hermes_cli/plugins.py),
which fires once per inbound MessageEvent before auth/dispatch with kwargs
``event``, ``gateway``, ``session_store``. Returning ``{"action":"rewrite","text":...}``
replaces ``event.text``; returning ``None`` means normal flow.

Runtime event shape (gateway/platforms/base.py::MessageEvent +
gateway/session.py::SessionSource):

    event.text                    -> str (message body)
    event.source                  -> SessionSource
    event.source.platform         -> Platform enum; ``.value`` is the platform string
    event.source.chat_id          -> str

The EscalationStore is keyed ``platform:chat_id`` where ``platform`` is the
enum's ``.value`` string (gateway/run.py::_set_session_env stores
``context.source.platform.value``), so we read ``source.platform.value`` here to
match the key written by escalate_to_human.
"""

import os

try:
    # Preferred: package-style import when the plugin dir is on sys.path
    # (runtime) or registered as a package in sys.modules (some harnesses).
    from store import EscalationStore  # type: ignore[assignment]
except ModuleNotFoundError:
    # Fallback: load store.py relative to this file via importlib. Handles the
    # importlib.util.spec_from_file_location + submodule_search_locations test
    # pattern where the plugin dir is not on sys.path but __file__ is set.
    import importlib.util as _ilu
    _store_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "store.py")
    _store_spec = _ilu.spec_from_file_location("_he_store", _store_path)
    _store_mod = _ilu.module_from_spec(_store_spec)
    _store_spec.loader.exec_module(_store_mod)
    EscalationStore = _store_mod.EscalationStore


def _platform_value(source) -> str:
    """Return the platform string for a SessionSource.

    ``source.platform`` is a ``Platform`` enum at runtime; its ``.value`` is the
    string used as the EscalationStore key. Tolerates a plain-string platform
    (synthetic/future events) by falling back to ``str``.
    """
    platform = getattr(source, "platform", None)
    if platform is None:
        return ""
    value = getattr(platform, "value", None)
    if value:
        return str(value)
    return str(platform) if platform else ""


def _conversation(event):
    """Resolve (platform, chat_id) from the inbound event.

    The real MessageEvent carries these on a nested ``source`` (SessionSource).
    Returns ("", "") safely when the shape is unexpected so the hook no-ops
    rather than raising inside the gateway dispatch path.
    """
    source = getattr(event, "source", None)
    if source is None:
        return "", ""
    platform = _platform_value(source)
    chat_id = getattr(source, "chat_id", None) or ""
    return platform, str(chat_id) if chat_id else ""


def pre_gateway_dispatch(event=None, gateway=None, session_store=None, **_kw):
    if event is None:
        return None

    platform, chat_id = _conversation(event)
    if not platform or not chat_id:
        return None

    rec = EscalationStore().get_active(platform, chat_id)
    if rec is None:
        return None

    text = getattr(event, "text", "") or ""
    prefix = (
        f"[RESUME CHECKOUT] You previously asked the user: \"{rec['prompt']}\". "
        f"Their reply follows. First call check_pending_escalation to clear the pending "
        f"state, then continue the checkout skill using their answer below.\n\n"
    )
    return {"action": "rewrite", "text": prefix + text}
