"""person-memory — per-person adaptive context for Hermes agents (slice 1).

Recognizes the current sender by ``<platform>:<user_id>`` and, via the
``pre_llm_call`` plugin hook, appends a short adaptation directive to the
user message so the agent matches that person's technical level and
communication style — while keeping every fact and the shared context
identical for everyone.

Slice 1 is READ-ONLY: it loads image-only profiles from
``<memory_dir>/people/<platform>:<id>.md`` and injects. It never writes a
profile and never touches the system prompt (so the prompt cache prefix is
preserved). It is strictly fail-open: any error injects nothing and never
breaks a turn.

Design note — the return contract is the hermes-agent-mt ``pre_llm_call``
interface (verified in ``agent/turn_context.py`` /
``hermes_cli/plugins.py``): a handler may return ``{"context": "..."}`` (or
a plain string) and the text is appended to the current turn's user
message, ephemerally, never persisted.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from .profiles import build_directive, load_profile  # noqa: F401 (re-export)

logger = logging.getLogger(__name__)

__version__ = "0.1.0"


def _env_truthy(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def memory_dir() -> str:
    """Resolve the agent's memory dir. Override with ``PERSON_MEMORY_DIR``;
    otherwise ``<HERMES_DATA_DIR or /opt/data>/memories``."""
    explicit = os.getenv("PERSON_MEMORY_DIR", "").strip()
    if explicit:
        return explicit
    return os.path.join(os.getenv("HERMES_DATA_DIR", "/opt/data").strip() or "/opt/data", "memories")


def handle_pre_llm_call(
    sender_id: str = "", platform: str = "", **kwargs: Any
) -> Optional[Dict[str, str]]:
    """pre_llm_call handler. Returns ``{"context": <directive>}`` when a
    profile exists for the sender, else ``None`` (no injection). Fail-open."""
    try:
        sid = str(sender_id or kwargs.get("sender_id_alt") or "").strip()
        if not sid:
            return None
        plat = str(platform or "slack").strip() or "slack"
        profile = load_profile(memory_dir(), plat, sid)
        if not profile:
            return None
        directive = build_directive(profile)
        if not directive:
            return None
        return {"context": directive}
    except Exception:
        logger.warning("person_memory: pre_llm_call failed", exc_info=True)
        return None


def register(ctx: Any) -> Dict[str, Any]:
    """Hermes plugin entry point. Registers the pre_llm_call hook. Never
    raises — a broken plugin must never take the host agent down."""
    if _env_truthy("PERSON_MEMORY_DISABLED"):
        logger.info("person_memory: disabled via PERSON_MEMORY_DISABLED")
        return {"enabled": False}
    try:
        ctx.register_hook("pre_llm_call", handle_pre_llm_call)
        logger.info("person_memory: registered pre_llm_call (memory_dir=%s)", memory_dir())
    except Exception:
        logger.warning("person_memory: hook registration failed", exc_info=True)
        return {"enabled": False}
    return {"enabled": True}
