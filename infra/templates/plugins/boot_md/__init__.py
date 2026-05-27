"""
Boot.md startup plugin — executes BOOT.md on first session start.

Reads ~/.hermes/BOOT.md (or HERMES_HOME/BOOT.md) and spawns a one-shot
background agent to execute the instructions. If nothing needs attention,
the agent replies with [SILENT] and no message is sent.
"""

import os
import threading
from pathlib import Path

_boot_executed = False


def _get_boot_md_path():
    """Resolve BOOT.md location from HERMES_HOME."""
    hermes_home = os.environ.get("HERMES_HOME", os.path.expanduser("~/.hermes"))
    return Path(hermes_home) / "BOOT.md"


def _build_boot_prompt(content: str) -> str:
    return f"""You are running a startup boot checklist. Follow the BOOT.md instructions below exactly.

---
{content}
---

Execute each instruction. If you need to send a message to a platform, use the send_message tool.
If nothing needs attention and there is nothing to report, reply with ONLY: [SILENT]"""


def _run_boot(agent_factory, content: str):
    """Run boot checklist in background thread."""
    try:
        prompt = _build_boot_prompt(content)
        agent = agent_factory(
            quiet_mode=True,
            skip_context_files=True,
            skip_memory=True,
            max_iterations=20,
        )
        response = agent.run(prompt)
        if response and "[SILENT]" not in response:
            # Boot had something to report — it will have used send_message
            pass
    except Exception as e:
        # Boot failures are non-fatal
        import logging
        logging.getLogger(__name__).warning(f"Boot.md execution failed: {e}")


def on_session_start(context):
    """Hook: execute BOOT.md on first session start."""
    global _boot_executed
    if _boot_executed:
        return
    _boot_executed = True

    boot_path = _get_boot_md_path()
    if not boot_path.exists():
        return

    content = boot_path.read_text().strip()
    if not content:
        return

    # Get agent factory from context if available
    agent_factory = getattr(context, "create_agent", None)
    if agent_factory is None:
        return

    # Run in background thread to not block startup
    thread = threading.Thread(target=_run_boot, args=(agent_factory, content), daemon=True)
    thread.start()
