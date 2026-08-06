"""Self-seeding identity capture for person_memory (slice 2).

Slice 1 was read-only: a person card had to be written by hand before the
agent could adapt to anyone. That made the adaptation layer only as good as
somebody's willingness to hand-maintain a directory of markdown files, which
in practice meant it adapted to nobody.

This module makes the card set populate itself from ordinary interaction:

* **Auto-seed on first contact.** The first time a sender is seen, a card is
  written from *observed* platform facts only — their platform display name,
  the id forms they present, first/last seen dates. Nothing is inferred about
  them, so nothing socially loaded is ever invented by the machine.

* **Self-learned id aliases.** ``pre_llm_call`` hands the plugin *both* id
  forms for the same person on every turn (Signal: phone number AND ACI UUID).
  Recording both on the card means the plugin learns the mapping itself, for
  arbitrary senders, with zero admin configuration — Swarm Map's
  ``resolved-identities.json`` only ever covers admin-entered identities, so
  it cannot cover a stranger who joins a group.

Adaptive fields (``technical_level``, ``comm_style``, ``role``) are NOT
inferred here. They are written only when the agent explicitly records
something it learned, via the ``remember_person`` tool — see ``__init__``.

Everything is strictly fail-open and never raises: a write failure degrades
to "no memory of this person", never to a broken turn.
"""
from __future__ import annotations

import datetime
import logging
import os
import re
import tempfile
from typing import Any, Dict, List, Optional, Tuple

from .profiles import _ID_RE, parse_frontmatter, profile_path

logger = logging.getLogger(__name__)

# Frontmatter key order. Stable ordering makes the rendered card
# byte-comparable, which is what lets us skip a write when nothing changed.
_FIELD_ORDER = (
    "display_name",
    "role",
    "technical_level",
    "comm_style",
    "platform",
    "alias_ids",
    "first_seen",
    "last_seen",
    "last_updated",
    "source",
)

# Fields the agent is allowed to write through remember_person. Deliberately
# excludes alias_ids/platform/first_seen (machine-owned) and anything that
# could carry an identifier.
WRITABLE_FIELDS = ("display_name", "role", "technical_level", "comm_style")

# A display name reaches us from an untrusted platform profile field and is
# echoed into the model's context, so it is length-capped and stripped of
# newlines/control characters. This does not make a hostile name harmless —
# it bounds how much of one can be smuggled in.
_MAX_NAME = 64
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")

# Reject anything identifier-shaped in an agent-written field. These fields are
# echoed verbatim into shared group sessions where everyone can see them, so a
# phone number or email landing here would leak it to the whole room.
_IDENTIFIER_RE = re.compile(
    r"(\+?\d[\d\s().-]{6,}\d)"        # phone-number-like run
    r"|([\w.+-]+@[\w-]+\.[\w.]+)"      # email
    r"|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"  # uuid
)

# Cache of the people/ directory index, invalidated on directory mtime change.
# {(memory_dir, platform): (mtime, {id: filename})}
_index_cache: Dict[Tuple[str, str], Tuple[float, Dict[str, str]]] = {}


def today() -> str:
    return datetime.date.today().isoformat()


def sanitize_name(value: Any) -> str:
    """Bound an untrusted platform display name."""
    text = _CONTROL_RE.sub(" ", str(value or "")).strip()
    text = re.sub(r"\s+", " ", text)
    return text[:_MAX_NAME].strip()


def looks_like_identifier(value: str) -> bool:
    return bool(_IDENTIFIER_RE.search(value or ""))


def render_card(meta: Dict[str, Any], body: str = "") -> str:
    """Serialize a card back to markdown. Inverse of ``parse_frontmatter``."""
    lines = ["---"]
    for key in _FIELD_ORDER:
        if key not in meta:
            continue
        value = meta[key]
        if value is None or value == "" or value == []:
            continue
        if isinstance(value, (list, tuple)):
            rendered = "[%s]" % ", ".join(str(v) for v in value)
        else:
            rendered = str(value)
        lines.append("%s: %s" % (key, rendered))
    # Preserve any keys we don't know about rather than silently dropping
    # somebody's hand-authored field.
    for key in sorted(meta):
        if key in _FIELD_ORDER or key == "_body":
            continue
        value = meta[key]
        if isinstance(value, (list, tuple)):
            value = "[%s]" % ", ".join(str(v) for v in value)
        lines.append("%s: %s" % (key, value))
    lines.append("---")
    text = "\n".join(lines)
    body = (body or "").strip()
    return text + ("\n\n" + body + "\n" if body else "\n")


def _atomic_write(path: str, content: str) -> bool:
    """Write via temp file + rename so a card is never half-written."""
    try:
        directory = os.path.dirname(path)
        os.makedirs(directory, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=directory, prefix=".pm-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(content)
            os.replace(tmp, path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        return True
    except (OSError, ValueError):
        logger.warning("person_memory: could not write %s", path, exc_info=True)
        return False


def _people_dir(memory_dir: str) -> str:
    return os.path.join(memory_dir, "people")


def _build_index(memory_dir: str, platform: str) -> Dict[str, str]:
    """Map every id a card claims (filename id + alias_ids) → its filename."""
    index: Dict[str, str] = {}
    people = _people_dir(memory_dir)
    prefix = "%s:" % platform
    try:
        names = os.listdir(people)
    except OSError:
        return index
    for name in names:
        if not name.startswith(prefix) or not name.endswith(".md"):
            continue
        index[name[len(prefix):-3]] = name
        try:
            with open(os.path.join(people, name), "r", encoding="utf-8") as fh:
                meta = parse_frontmatter(fh.read())
        except (OSError, ValueError):
            continue
        aliases = meta.get("alias_ids")
        if isinstance(aliases, str):
            aliases = [aliases]
        for alias in aliases or []:
            alias = str(alias).strip()
            if alias and _ID_RE.match(alias):
                index.setdefault(alias, name)
    return index


def card_index(memory_dir: str, platform: str) -> Dict[str, str]:
    """Cached id→filename index, rebuilt when people/ changes."""
    people = _people_dir(memory_dir)
    try:
        mtime = os.stat(people).st_mtime
    except OSError:
        return {}
    key = (memory_dir, platform)
    cached = _index_cache.get(key)
    if cached and cached[0] == mtime:
        return cached[1]
    index = _build_index(memory_dir, platform)
    _index_cache[key] = (mtime, index)
    return index


def invalidate_index(memory_dir: str, platform: str) -> None:
    _index_cache.pop((memory_dir, platform), None)


def resolve_card(memory_dir: str, platform: str, ids: List[str]) -> Optional[str]:
    """Filename of the card matching any of ``ids``, or None."""
    index = card_index(memory_dir, platform)
    for candidate in ids:
        candidate = (candidate or "").strip()
        if candidate and candidate in index:
            return index[candidate]
    return None


def observe_sender(
    memory_dir: str,
    platform: str,
    sender_id: str,
    sender_id_alt: str = "",
    display_name: str = "",
) -> bool:
    """Record that this sender was seen, creating their card if new.

    Writes only observed platform facts. Returns True when the card changed
    on disk. Date-granular ``last_seen`` bounds this to at most one write per
    person per day, so it is not a per-turn disk cost.
    """
    ids = [i for i in (sender_id, sender_id_alt) if i and _ID_RE.match(i)]
    if not ids or not platform or not _ID_RE.match(platform):
        return False

    existing = resolve_card(memory_dir, platform, ids)
    people = _people_dir(memory_dir)
    now = today()

    if existing:
        path = os.path.join(people, existing)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                original = fh.read()
        except OSError:
            return False
        meta = parse_frontmatter(original)
        body = str(meta.pop("_body", "") or "")
    else:
        # Key a new card by the primary presented id.
        path = profile_path(memory_dir, platform, ids[0])
        original = ""
        meta = {"first_seen": now, "source": "observed"}
        body = ""

    updated = dict(meta)
    updated["platform"] = platform
    updated["last_seen"] = now

    known = updated.get("alias_ids")
    if isinstance(known, str):
        known = [known]
    merged = list(known or [])
    for candidate in ids:
        if candidate not in merged:
            merged.append(candidate)
    if merged:
        updated["alias_ids"] = merged

    # Only adopt a platform display name if the card doesn't already have one.
    # A name the agent or a human recorded deliberately outranks whatever the
    # platform profile currently says.
    clean_name = sanitize_name(display_name)
    if clean_name and not str(updated.get("display_name") or "").strip():
        updated["display_name"] = clean_name

    rendered = render_card(updated, body)
    if rendered == original:
        return False
    if not _atomic_write(path, rendered):
        return False
    invalidate_index(memory_dir, platform)
    return True


def update_person_fields(
    memory_dir: str,
    platform: str,
    ids: List[str],
    fields: Dict[str, str],
    note: str = "",
) -> Tuple[bool, str]:
    """Apply agent-supplied adaptation fields to a person's card.

    Returns ``(ok, message)``. Rejects unknown fields and any value that looks
    like an identifier, because these fields are echoed into shared sessions.
    """
    clean: Dict[str, str] = {}
    for key, value in (fields or {}).items():
        if key not in WRITABLE_FIELDS:
            return False, "field %r is not writable (allowed: %s)" % (
                key, ", ".join(WRITABLE_FIELDS))
        text = sanitize_name(value) if key == "display_name" else _CONTROL_RE.sub(" ", str(value or "")).strip()
        if not text:
            continue
        if looks_like_identifier(text):
            return False, (
                "refusing to store %r: it contains something identifier-shaped "
                "(phone/email/UUID). These fields are shown to everyone in a "
                "shared session — describe how to communicate, not who someone is."
            ) % key
        clean[key] = text

    note = _CONTROL_RE.sub(" ", str(note or "")).strip()
    if note and looks_like_identifier(note):
        return False, "refusing to store that note: it contains an identifier."

    if not clean and not note:
        return False, "nothing to record"

    valid = [i for i in ids if i and _ID_RE.match(i)]
    if not valid or not _ID_RE.match(platform or ""):
        return False, "no usable sender id for this turn"

    existing = resolve_card(memory_dir, platform, valid)
    people = _people_dir(memory_dir)
    if existing:
        path = os.path.join(people, existing)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                original = fh.read()
        except OSError:
            return False, "could not read the existing card"
        meta = parse_frontmatter(original)
        body = str(meta.pop("_body", "") or "")
    else:
        path = profile_path(memory_dir, platform, valid[0])
        original = ""
        meta = {"first_seen": today(), "platform": platform, "alias_ids": valid}
        body = ""

    updated = dict(meta)
    updated.update(clean)
    updated["last_updated"] = today()
    updated["source"] = "learned"

    if note:
        section = "## Notable context"
        entry = "- %s" % note
        if section in body:
            if entry not in body:
                body = body.replace(section, "%s\n%s" % (section, entry), 1)
        else:
            body = (body + "\n\n%s\n%s" % (section, entry)).strip()

    rendered = render_card(updated, body)
    if rendered == original:
        return True, "already recorded"
    if not _atomic_write(path, rendered):
        return False, "could not write the card"
    invalidate_index(memory_dir, platform)
    return True, "recorded"
