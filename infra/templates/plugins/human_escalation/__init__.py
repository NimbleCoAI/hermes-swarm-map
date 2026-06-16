"""human_escalation plugin -- registers the escalation-bus tools and the resume hook.

Standalone HSM artifact. Installed by HSM into a plugin directory (e.g.
``/opt/data/.../plugins/human_escalation/`` or ``~/.hermes/plugins/human_escalation/``)
where there is NO ``plugins.human_escalation`` parent package. The real loader
(hermes-agent's ``PluginManager._load_directory_module``) imports this file as
``hermes_plugins.human_escalation`` with ``submodule_search_locations=[plugin_dir]``
and does NOT put plugin_dir on ``sys.path`` -- so ``register()`` resolves its
siblings with a loader-agnostic importlib-by-__file__ fallback (the same pattern
escalate.py / dispatch_hook.py already use to import store.py).
"""

import logging

logger = logging.getLogger(__name__)

_ESCALATE_SCHEMA = {
    "name": "escalate_to_human",
    "description": (
        "Ask the human (over the current chat) for something the agent cannot do alone, "
        "then END THE TURN and wait for their reply. Use kind='code_request' to relay an "
        "SMS/2FA/email code, kind='confirmation' to get explicit go-ahead before charging "
        "(payload: {line_items:[...], total:'$X'}), kind='link_handoff' to send a VNC/QR/link "
        "to finish a step (payload: {url, media_path?}), kind='freeform' for an open question. "
        "Returns immediately with status='awaiting'; the reply is retrieved next turn via "
        "check_pending_escalation."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": ["code_request", "confirmation", "link_handoff", "freeform"]},
            "prompt": {"type": "string", "description": "The message to show the human."},
            "payload": {"type": "object", "description": "kind-specific: confirmation={line_items,total}; link_handoff={url,media_path?}."},
            "timeout_s": {"type": "integer", "description": "Seconds the escalation stays valid (default 300)."},
        },
        "required": ["kind", "prompt"],
    },
}

_CHECK_SCHEMA = {
    "name": "check_pending_escalation",
    "description": (
        "Call this at the START of a turn when you may be resuming a checkout. Returns the "
        "pending escalation (kind + original prompt) for this chat and clears it; the user's "
        "most recent message is the answer. Returns status='none' if nothing is pending."
    ),
    "parameters": {"type": "object", "properties": {}, "required": []},
}


def register(ctx):
    # Loader-agnostic sibling imports. The real HSM loader imports this package as
    # ``hermes_plugins.human_escalation`` with submodule_search_locations set but
    # does NOT add the plugin dir to sys.path, so a bare ``from escalate import``
    # works only when the dir happens to be importable. When it is not (the
    # standalone install location), fall back to loading escalate.py /
    # dispatch_hook.py directly by __file__ -- the same self-contained importlib
    # pattern escalate.py and dispatch_hook.py use for store.py. This makes the
    # plugin load regardless of the package name the loader assigns and with NO
    # dependency on a ``plugins.human_escalation`` parent package.
    try:
        from escalate import escalate_to_human, check_pending_escalation
        from dispatch_hook import pre_gateway_dispatch
    except ImportError:
        import importlib.util
        from pathlib import Path

        def _load(modname):
            spec = importlib.util.spec_from_file_location(
                modname, Path(__file__).with_name(modname + ".py")
            )
            m = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(m)
            return m

        _esc = _load("escalate")
        _dh = _load("dispatch_hook")
        escalate_to_human = _esc.escalate_to_human
        check_pending_escalation = _esc.check_pending_escalation
        pre_gateway_dispatch = _dh.pre_gateway_dispatch

    ctx.register_tool(
        name="escalate_to_human",
        toolset="escalation",
        schema=_ESCALATE_SCHEMA,
        handler=escalate_to_human,
        description="Escalate to the human over chat and wait for their reply.",
        emoji="🙋",
    )
    ctx.register_tool(
        name="check_pending_escalation",
        toolset="escalation",
        schema=_CHECK_SCHEMA,
        handler=check_pending_escalation,
        description="Retrieve and clear a pending escalation when resuming.",
        emoji="📥",
    )
    ctx.register_hook("pre_gateway_dispatch", pre_gateway_dispatch)
    logger.info("human_escalation: registered escalate_to_human + check_pending_escalation + resume hook")
