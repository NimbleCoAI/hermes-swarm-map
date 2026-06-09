"""Sanitization gate for the hermes-swarm-map base package.

The base package (``infra/templates/**``, base skills/soul/docs) ships to EVERY
agent HSM creates, so it must contain only use-case-agnostic methodology and
tooling — never secrets, PII, or particulars of a specific deployment /
investigation / customer. This gate is built so that even an AUTOMATED
contribution (e.g. an agent opening a PR) cannot land such material.

Two layers, both must pass — fail closed:

1. **Deterministic layer** (`scan_secrets`) — regex detection of secret/API keys,
   private-key blocks, JWTs, hardcoded credentials, real email addresses, and
   phone numbers. No API key required; runs always; zero false negatives for
   known shapes. Obvious documentation placeholders (runs of one repeated char)
   are ignored.
2. **Semantic layer** (`assess`) — an LLM judges whether the content carries
   use-case-specific particulars (subject names, org names tied to a case,
   document/dataset IDs, case codenames, specific dates/locations/customers).
   Required by default: if it cannot run, the gate fails closed.

A flag is a hard stop for an automated PR; a human maintainer can clear a
false positive.
"""
from __future__ import annotations

import json
import os
import re
import sys

# ── File selection ────────────────────────────────────────────────────────────
# Content surfaces that can leak particulars in the base package.
SENSITIVE_PREFIXES = (
    "infra/templates/",  # base plugins / skills / hooks shipped to every agent
    "docs/",             # docs + runbooks + templates
    "SOUL",              # any base soul template
)


def select_sensitive_files(paths):
    """Subset of changed paths whose *content* could leak: base templates, docs,
    soul, and any top-level prose ``.md`` (README/CONTRIBUTING)."""
    out = []
    for p in paths:
        if p.startswith(SENSITIVE_PREFIXES):
            out.append(p)
        elif p.endswith(".md") and "/" not in p:
            out.append(p)
    return out


def gather_base_files(root="."):
    """Full-tree scan target: every file under the base artefact surface, so a
    pre-existing leak can't hide in an untouched file (the diff-only gap)."""
    out = []
    for base in ("infra/templates", "docs"):
        for dirpath, _dirs, files in os.walk(os.path.join(root, base)):
            for f in files:
                rel = os.path.relpath(os.path.join(dirpath, f), root)
                out.append(rel)
    for top in ("README.md", "CONTRIBUTING.md"):
        if os.path.exists(os.path.join(root, top)):
            out.append(top)
    return sorted(out)


# ── Deterministic layer ───────────────────────────────────────────────────────
_PLACEHOLDER_EMAIL_DOMAINS = {
    "example.com", "example.org", "example.net", "email.com", "test.com",
    "domain.com", "anthropic.com", "yourdomain.com", "company.com",
}

# (regex, label, prefix-to-strip-for-placeholder-check or None)
_SECRET_PATTERNS = [
    (re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"), "Anthropic API key", "sk-ant-"),
    (re.compile(r"\bsk-[A-Za-z0-9]{20,}\b"), "OpenAI-style secret key", "sk-"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"), "GitHub token", None),
    (re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"), "GitHub fine-grained PAT", "github_pat_"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "AWS access key id", "AKIA"),
    (re.compile(r"\bGOCSPX-[A-Za-z0-9_-]{10,}\b"), "Google OAuth client secret", "GOCSPX-"),
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"), "Slack token", None),
    (re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----"), "private key block", None),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}"), "JWT", None),
    # Quoted value only: a real hardcoded secret is a string literal. Requiring
    # quotes avoids flagging `token = some_function(...)` / `token: str` in code,
    # while unquoted key SHAPES (ghp_, sk-, …) are still caught by the patterns above.
    (re.compile(
        r"(?i)(?:api[_-]?key|secret|token|password|passwd|pwd|client[_-]?secret)"
        r"\s*[=:]\s*[\"']([A-Za-z0-9/+=_\-]{16,})[\"']"
    ), "hardcoded credential", "ASSIGN"),
]

_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b")
_PHONE = re.compile(r"(?<![\w.])(?:\+\d{1,3}[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}(?![\w.])")


def _is_placeholder(body: str) -> bool:
    """A run dominated by one character (xxxx…, 0000…) is a documentation
    placeholder, never a real high-entropy secret."""
    b = body.strip("\"'")
    if len(b) >= 6 and len(set(b)) <= 2:
        return True
    return bool(re.search(r"(.)\1{6,}", b))  # a long run of one char, e.g. ghp_xxxxxxx…


def scan_secrets(content: str) -> list[str]:
    """Deterministic secret / PII detection. Returns a deduped list of findings."""
    findings: list[str] = []
    for pat, label, strip in _SECRET_PATTERNS:
        for m in pat.finditer(content):
            if strip == "ASSIGN":
                body = m.group(1)
            elif strip is not None:
                body = m.group(0)[len(strip):]
            else:
                # strip a leading scheme like gh*_ / xox*- before the entropy check
                body = re.sub(r"^(gh[pousr]_|xox[baprs]-)", "", m.group(0))
            if _is_placeholder(body):
                continue
            findings.append(f"possible {label}")
            break
    for m in _EMAIL.finditer(content):
        if m.group(1).lower() not in _PLACEHOLDER_EMAIL_DOMAINS:
            findings.append(f"email address ({m.group(0)})")
    if _PHONE.search(content):
        findings.append("phone-number-like sequence")

    seen, out = set(), []
    for f in findings:
        if f not in seen:
            seen.add(f)
            out.append(f)
    return out


# ── Semantic layer ────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You review proposed content for a SHARED, use-case-agnostic \
agent base package that ships to EVERY deployment. It must contain only generic \
methodology and tooling. It must NOT contain particulars of any specific \
deployment, investigation, customer, or case.

Flag the content if it contains any of:
- personal names of real individuals (subjects, suspects, targets, customers, staff);
- specific organization / company names tied to a particular case or deployment;
- document IDs, file names, dataset names, case numbers, or URLs specific to one use case;
- a codename or label identifying a particular investigation / customer / deployment
  (e.g. used as a skill name, heading, or example);
- dates, locations, or details that only make sense for one specific use case.

Do NOT flag generic methodology ("how to corroborate a leaked dataset", "structure
of a handoff"), tool/API names, well-known public reference material, or clearly
fictional placeholders (Subject A, <case>, example.com). When uncertain whether
something is a particular vs. generic, lean toward flagging so a human can decide.

Respond with ONLY a JSON object: {"flagged": <bool>, "reasons": [<short strings>]}.
"""


def _extract_json(text):
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError(f"no JSON object in model reply: {text!r}")
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        start2 = text.rfind("{")
        if start2 != -1 and start2 < end:
            return json.loads(text[start2:end + 1])
        raise


def assess(content, client, filename):
    """Ask the model whether ``content`` carries use-case-specific particulars."""
    msg = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"File: {filename}\n\n---\n{content}\n---"}],
    )
    verdict = _extract_json(msg.content[0].text)
    if "flagged" not in verdict:
        raise ValueError(f"model response missing 'flagged' key: {verdict!r}")
    reasons = verdict.get("reasons", [])
    if isinstance(reasons, str):
        reasons = [reasons]
    return {"flagged": bool(verdict["flagged"]), "reasons": list(reasons)}


def _make_client():  # pragma: no cover - thin wrapper, injected in tests
    import anthropic
    return anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def _read(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def main(argv, root=".", client_factory=_make_client, require_llm=True):
    files = select_sensitive_files(list(argv))
    if not files:
        print("sanitization: no sensitive files changed — skipping.")
        return 0

    # Layer 1 — deterministic (always runs, no API key needed).
    det_failed = False
    for rel in files:
        path = os.path.join(root, rel)
        if not os.path.exists(path):
            continue
        hits = scan_secrets(_read(path))
        if hits:
            det_failed = True
            print(f"BLOCKED {rel} (secrets/PII):")
            for h in hits:
                print(f"  - {h}")

    # Layer 2 — semantic (LLM). Required by default → fail closed if unavailable.
    client = None
    try:
        client = client_factory()
    except Exception as exc:  # noqa: BLE001
        print(f"LLM layer unavailable: {exc}")
    if client is None:
        if require_llm:
            print("sanitization: semantic layer required but unavailable — FAILING CLOSED.")
            return 1
        print("sanitization: semantic layer skipped (not required).")

    llm_failed = False
    if client is not None:
        for rel in files:
            path = os.path.join(root, rel)
            if not os.path.exists(path):
                continue
            verdict = assess(_read(path), client, rel)
            if verdict["flagged"]:
                llm_failed = True
                print(f"FLAGGED {rel} (particulars):")
                for r in verdict["reasons"]:
                    print(f"  - {r}")
            else:
                print(f"ok      {rel}")

    if det_failed or llm_failed:
        print("\nsanitization: FAIL — possible secrets, PII, or use-case particulars.")
        return 1
    print("\nsanitization: clean.")
    return 0


if __name__ == "__main__":  # pragma: no cover
    args = sys.argv[1:]
    base_root = os.environ.get("SANITIZE_ROOT", ".")
    if args and args[0] == "--all":
        args = gather_base_files(base_root)
    sys.exit(main(args, root=base_root))
