"""person-memory — per-person adaptive context for Hermes agents.

Recognizes the current sender by ``<platform>:<user_id>`` and, via the
``pre_llm_call`` plugin hook, appends a short adaptation directive to the
user message so the agent matches that person's technical level and
communication style — while keeping every fact and the shared context
identical for everyone.

**Slice 2 — the card set maintains itself.** Slice 1 was read-only, which
meant the layer only adapted to people someone had hand-written a markdown
file for; in practice it adapted to nobody. Now:

* every sender is auto-seeded on first contact from *observed* platform
  facts (display name, id forms, dates) — nothing about them is inferred;
* id aliases are learned from interaction, because ``pre_llm_call`` supplies
  both id forms per turn (Signal: phone number AND ACI UUID), so a card
  written under one form still fires when the sender presents the other,
  with no admin configuration;
* the agent records what it *learns* about communicating with someone via
  the ``remember_person`` tool, rather than a human editing frontmatter.

Reads never touch the system prompt (so the prompt cache prefix is
preserved). Every path is strictly fail-open: any error injects nothing,
writes nothing, and never breaks a turn.

Design note — the return contract is the hermes-agent-mt ``pre_llm_call``
interface (verified in ``agent/turn_context.py`` / ``hermes_cli/plugins.py``):
a handler may return ``{"context": "..."}`` (or a plain string) and the text
is appended to the current turn's user message, ephemerally, never persisted.

Kill switches: ``PERSON_MEMORY_DISABLED`` turns the plugin off entirely;
``PERSON_MEMORY_READONLY`` keeps the adaptation layer but disables every
write, restoring slice-1 behavior.
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Any, Dict, List, Optional

from .identity import (  # noqa: F401 (re-export)
    WRITABLE_FIELDS,
    observe_sender,
    resolve_card,
    update_person_fields,
)
from .profiles import build_directive, load_alias_ids, load_profile, parse_frontmatter  # noqa: F401

logger = logging.getLogger(__name__)

__version__ = "0.3.0"

# ``pre_gateway_dispatch`` is the only hook carrying the sender's platform
# display name and DM-vs-group context; ``pre_llm_call`` is the only one
# carrying both sender id forms. Neither sees what the other sees, so the
# dispatch hook parks what it learned for the turn hook to collect.
# Bounded so a busy group can never grow this without limit.
_MAX_PENDING = 256
_pending_names: "Dict[str, str]" = {}
_pending_lock = threading.Lock()


def _env_truthy(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def writes_enabled() -> bool:
    return not _env_truthy("PERSON_MEMORY_READONLY")


def data_dir() -> str:
    """The agent's data dir — where Swarm Map drops ``resolved-identities.json``."""
    return os.getenv("HERMES_DATA_DIR", "/opt/data").strip() or "/opt/data"


def memory_dir() -> str:
    """Resolve the agent's memory dir. Override with ``PERSON_MEMORY_DIR``;
    otherwise ``<HERMES_DATA_DIR or /opt/data>/memories``."""
    explicit = os.getenv("PERSON_MEMORY_DIR", "").strip()
    if explicit:
        return explicit
    return os.path.join(data_dir(), "memories")


def _remember_name(ids: List[str], name: str) -> None:
    if not name:
        return
    with _pending_lock:
        if len(_pending_names) >= _MAX_PENDING:
            _pending_names.clear()
        for key in ids:
            if key:
                _pending_names[key] = name


def _take_name(ids: List[str]) -> str:
    with _pending_lock:
        for key in ids:
            if key and key in _pending_names:
                return _pending_names.pop(key)
    return ""


# Set by pre_llm_call so remember_person knows who the current turn is with.
# The tool handler receives no sender identity of its own.
_current_sender: "Dict[str, Any]" = {}
_current_lock = threading.Lock()


def _set_current(platform: str, ids: List[str]) -> None:
    with _current_lock:
        _current_sender["platform"] = platform
        _current_sender["ids"] = list(ids)


def _get_current() -> "tuple[str, List[str]]":
    with _current_lock:
        return _current_sender.get("platform", ""), list(_current_sender.get("ids") or [])


def handle_pre_gateway_dispatch(**kwargs: Any) -> None:
    """Capture the sender's platform display name for this turn.

    Observer only — never returns an action, so it can never affect whether a
    message is dispatched.
    """
    try:
        event = kwargs.get("event")
        source = getattr(event, "source", None)
        if source is None:
            return None
        ids = [
            str(getattr(source, "user_id", "") or "").strip(),
            str(getattr(source, "user_id_alt", "") or "").strip(),
        ]
        _remember_name(ids, str(getattr(source, "user_name", "") or "").strip())
    except Exception:
        logger.debug("person_memory: dispatch capture failed", exc_info=True)
    return None


def handle_pre_llm_call(
    sender_id: str = "", platform: str = "", **kwargs: Any
) -> Optional[Dict[str, str]]:
    """pre_llm_call handler. Returns ``{"context": <directive>}`` when a
    profile exists for the sender, else ``None`` (no injection). Fail-open."""
    try:
        sid = str(sender_id or "").strip()
        alt = str(kwargs.get("sender_id_alt") or "").strip()
        ids = [i for i in (sid, alt) if i]
        if not ids:
            return None
        plat = str(platform or "slack").strip() or "slack"
        mem = memory_dir()

        _set_current(plat, ids)

        # Seed/refresh the card before reading, so a first-time sender is
        # recognized on their very first turn rather than the second.
        if writes_enabled():
            try:
                observe_sender(mem, plat, ids[0], alt, _take_name(ids))
            except Exception:
                logger.debug("person_memory: observe failed", exc_info=True)

        profile = _load_for(mem, plat, ids)
        if not profile:
            return None
        directive = build_directive(profile)
        if not directive:
            return None
        return {"context": directive}
    except Exception:
        logger.warning("person_memory: pre_llm_call failed", exc_info=True)
        return None


def _load_for(mem: str, plat: str, ids: List[str]) -> Optional[Dict[str, Any]]:
    """Find this sender's profile by any id form they're known under."""
    for candidate in ids:
        profile = load_profile(mem, plat, candidate)
        if profile:
            return profile
    # Card written under an id form this sender isn't presenting right now.
    filename = resolve_card(mem, plat, ids)
    if filename:
        key = filename[len(plat) + 1:-3]
        profile = load_profile(mem, plat, key)
        if profile:
            return profile
    # Last resort: aliases Swarm Map resolved from admin-entered identities.
    for candidate in ids:
        for alias in load_alias_ids(data_dir(), plat, candidate):
            profile = load_profile(mem, plat, alias)
            if profile:
                return profile
    return None


REMEMBER_SCHEMA = {
    "type": "object",
    "properties": {
        "comm_style": {
            "type": "string",
            "description": (
                "How this person prefers to be communicated with — e.g. "
                "'warm, narrative, analogy-first; avoid jargon' or 'dense and "
                "direct, no preamble'. Describe delivery, not the person."
            ),
        },
        "technical_level": {
            "type": "string",
            "description": (
                "How much technical depth to use with them, e.g. 'concept', "
                "'practitioner', 'expert'."
            ),
        },
        "role": {
            "type": "string",
            "description": "Their working role, if they've stated it.",
        },
        "display_name": {
            "type": "string",
            "description": "What they want to be called, if they've said.",
        },
        "note": {
            "type": "string",
            "description": (
                "One short durable fact about working with them. Optional."
            ),
        },
    },
    "additionalProperties": False,
}

REMEMBER_DESCRIPTION = (
    "Record what you've learned about how to communicate with the person you "
    "are currently talking to, so future conversations start adapted instead "
    "of starting over. Use it when someone tells you (or clearly shows) how "
    "they want to be talked to — asks for less jargon, says they're an "
    "engineer, asks you to be blunt.\n\n"
    "Store HOW to talk to them, never WHO they are: no phone numbers, "
    "emails, addresses, IDs, or sensitive personal details. What you write "
    "here is shown to everyone in a shared group session, so keep it to "
    "something you'd be comfortable saying in front of them — because you "
    "will be. Facts and decisions stay identical for everyone; this changes "
    "tone and depth only."
)


def handle_remember_person(args: Dict[str, Any], **_kw: Any) -> str:
    """``remember_person`` tool handler. Returns a short status string."""
    try:
        if not writes_enabled():
            return "person memory is read-only (PERSON_MEMORY_READONLY); nothing recorded."
        platform, ids = _get_current()
        if not ids:
            return "no active sender for this turn; nothing recorded."
        args = args or {}
        note = str(args.get("note") or "")
        fields = {k: v for k, v in args.items() if k in WRITABLE_FIELDS}
        ok, message = update_person_fields(memory_dir(), platform, ids, fields, note)
        if not ok:
            return "Not recorded: %s" % message
        return "Recorded for next time (%s)." % message
    except Exception:
        logger.warning("person_memory: remember_person failed", exc_info=True)
        return "Could not record that right now."


def register(ctx: Any) -> Dict[str, Any]:
    """Hermes plugin entry point. Never raises — a broken plugin must never
    take the host agent down."""
    if _env_truthy("PERSON_MEMORY_DISABLED"):
        logger.info("person_memory: disabled via PERSON_MEMORY_DISABLED")
        return {"enabled": False}
    registered = []
    try:
        ctx.register_hook("pre_llm_call", handle_pre_llm_call)
        registered.append("pre_llm_call")
    except Exception:
        logger.warning("person_memory: pre_llm_call registration failed", exc_info=True)
        return {"enabled": False}

    # Display-name capture and the write tool are enhancements: if either is
    # unavailable on this runtime, the adaptation layer still works.
    try:
        ctx.register_hook("pre_gateway_dispatch", handle_pre_gateway_dispatch)
        registered.append("pre_gateway_dispatch")
    except Exception:
        logger.info("person_memory: pre_gateway_dispatch unavailable; display names will be learned from the agent instead", exc_info=True)

    if writes_enabled():
        try:
            ctx.register_tool(
                name="remember_person",
                toolset="person_memory",
                schema=REMEMBER_SCHEMA,
                handler=handle_remember_person,
                description=REMEMBER_DESCRIPTION,
                emoji="👤",
            )
            registered.append("remember_person")
        except Exception:
            logger.info("person_memory: remember_person tool unavailable", exc_info=True)

    logger.info(
        "person_memory %s: registered %s (memory_dir=%s, writes=%s)",
        __version__, ", ".join(registered), memory_dir(), writes_enabled(),
    )
    return {"enabled": True}
