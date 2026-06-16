"""File-based pending-escalation store.

One active escalation per conversation (keyed platform:chat_id). Records persist
under HERMES_HOME so a process restart mid-wait does not lose the pending state.
Mirrors the atomic-write + 0600 pattern used by gateway/pairing.py.
"""

import json
import os
import tempfile
import time
import uuid
from pathlib import Path
from typing import Optional, Dict, Any

try:
    from hermes_constants import get_hermes_dir
    _ESCALATION_DIR = get_hermes_dir("escalations", "escalations")
    _HAS_HERMES_CONSTANTS = True
except Exception:
    # Fallback when imported outside the hermes runtime (e.g. unit tests that
    # only set HERMES_HOME). Keeps the store self-contained and testable.
    _ESCALATION_DIR = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))) / "escalations"
    _HAS_HERMES_CONSTANTS = False


def _key(platform: str, chat_id: str) -> str:
    return f"{platform}:{chat_id}"


class EscalationStore:
    def __init__(self, base_dir: Optional[Path] = None):
        if base_dir is not None:
            self._dir = Path(base_dir)
        elif not _HAS_HERMES_CONSTANTS and os.environ.get("HERMES_HOME"):
            # Re-resolve from HERMES_HOME only when hermes_constants was not
            # importable (e.g. unit tests that set HERMES_HOME for isolation).
            # When constants ARE available, honor get_hermes_dir's path, which
            # may legitimately differ from $HERMES_HOME/escalations in prod.
            self._dir = Path(os.environ["HERMES_HOME"]) / "escalations"
        else:
            self._dir = _ESCALATION_DIR
        self._path = self._dir / "pending.json"

    def _load(self) -> Dict[str, Any]:
        if self._path.exists():
            try:
                return json.loads(self._path.read_text())
            except (json.JSONDecodeError, OSError):
                return {}
        return {}

    def _write(self, data: Dict[str, Any]) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(self._dir), suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(data, f, indent=2)
            # Restrict perms before the file becomes visible at the target
            # path — chmod-after-replace leaves a TOCTOU window where the
            # record (user_id/prompt) is world-readable under a lax umask.
            os.chmod(tmp, 0o600)
            os.replace(tmp, self._path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    def create(self, platform: str, chat_id: str, user_id: str, kind: str,
               prompt: str, timeout_s: int = 300) -> str:
        escal_id = uuid.uuid4().hex
        data = self._load()
        data[_key(platform, chat_id)] = {
            "escal_id": escal_id,
            "platform": platform,
            "chat_id": chat_id,
            "user_id": user_id,
            "kind": kind,
            "prompt": prompt,
            "created_at": time.time(),
            "timeout_s": timeout_s,
            "status": "pending",
        }
        self._write(data)
        return escal_id

    def get_active(self, platform: str, chat_id: str) -> Optional[Dict[str, Any]]:
        data = self._load()
        rec = data.get(_key(platform, chat_id))
        if not rec or rec.get("status") != "pending":
            return None
        if time.time() - rec["created_at"] > rec["timeout_s"]:
            return None
        return rec

    def resolve(self, platform: str, chat_id: str) -> Optional[Dict[str, Any]]:
        data = self._load()
        rec = data.pop(_key(platform, chat_id), None)
        if rec is not None:
            self._write(data)
        return rec
