"""Tests for the HSM base-package sanitization gate.

Two layers: a deterministic regex layer (secrets / keys / PII — no API key needed,
zero false negatives for known shapes) and an LLM semantic layer (use-case-specific
particulars). The gate fails closed. These tests cover the deterministic layer and
the orchestration; the LLM call is injected.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import check_sanitization as cs  # noqa: E402


class TestScanSecretsDeterministic:
    def test_clean_generic_content(self):
        assert cs.scan_secrets("This skill explains how to structure a session handoff.") == []

    def test_flags_anthropic_key(self):
        assert cs.scan_secrets("ANTHROPIC_API_KEY=sk-ant-api03-aB3dEf7hJk9mNp2qRs5tUv8wXy1z") != []

    def test_flags_github_tokens(self):
        for tok in [
            "ghp_aB3dEf7hJk9mNp2qRs5tUv8wXy1z0AbCd",
            "ghu_9mNp2qRs5tUv8wXy1z0AbCdEf7hJk3d",
            "github_pat_11ABCDEF0_aB3dEf7hJk9mNp2qRs5tUv",
        ]:
            assert cs.scan_secrets(f"token: {tok}") != [], tok

    def test_flags_aws_access_key(self):
        assert cs.scan_secrets("AKIA2E3F4G5H6J7K8L9M") != []

    def test_flags_private_key_block(self):
        assert cs.scan_secrets("-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----") != []

    def test_flags_google_oauth_secret(self):
        assert cs.scan_secrets("client_secret: GOCSPX-aB3dEf7hJk9mNp2qRs5tUv") != []

    def test_flags_jwt(self):
        assert cs.scan_secrets("auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNr") != []

    def test_flags_generic_assigned_credential(self):
        assert cs.scan_secrets('password = "S3cr3tP4ssw0rdLongEnough"') != []

    def test_flags_real_email_not_placeholder(self):
        assert cs.scan_secrets("contact jane.doe@realcorp.io for details") != []
        assert cs.scan_secrets("use analyst@example.com as a placeholder") == []
        assert cs.scan_secrets("noreply@anthropic.com") == []

    def test_flags_phone_number(self):
        assert cs.scan_secrets("call +1 415-555-0132 today") != []

    def test_ignores_obvious_placeholder_token_runs(self):
        # A run of identical chars is a documentation placeholder, not a secret.
        assert cs.scan_secrets("# GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx") == []


class TestLLMLayer:
    class _FakeClient:
        def __init__(self, payload):
            self._payload = payload
            self.messages = self

        def create(self, **_kw):
            text = self._payload
            return type("M", (), {"content": [type("B", (), {"text": text})()]})()

    def test_assess_parses_flagged(self):
        c = self._FakeClient('{"flagged": true, "reasons": ["subject name"]}')
        v = cs.assess("Subject A is John Q. Realname", c, "SKILL.md")
        assert v["flagged"] is True
        assert v["reasons"] == ["subject name"]

    def test_assess_parses_clean(self):
        c = self._FakeClient('Sure. {"flagged": false, "reasons": []}')
        v = cs.assess("generic methodology", c, "SKILL.md")
        assert v["flagged"] is False


class TestSelectFiles:
    def test_hsm_sensitive_prefixes(self):
        sel = cs.select_sensitive_files([
            "infra/templates/skills/x/SKILL.md",
            "infra/templates/plugins/y/__init__.py",
            "lib/services/foo.ts",
            "README.md",
            "docs/runbooks/z.md",
        ])
        assert "infra/templates/skills/x/SKILL.md" in sel
        assert "infra/templates/plugins/y/__init__.py" in sel
        assert "docs/runbooks/z.md" in sel
        assert "README.md" in sel
        assert "lib/services/foo.ts" not in sel


class TestMainFailClosed:
    def _write(self, tmp_path, rel, content):
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        return rel

    def test_deterministic_blocks_even_without_llm(self, tmp_path):
        rel = self._write(tmp_path, "infra/templates/skills/x/SKILL.md",
                          "token: ghp_aB3dEf7hJk9mNp2qRs5tUv8wXy1z0AbCd")
        rc = cs.main([rel], root=str(tmp_path), client_factory=lambda: None, require_llm=False)
        assert rc == 1

    def test_clean_passes_without_llm(self, tmp_path):
        rel = self._write(tmp_path, "infra/templates/skills/x/SKILL.md",
                          "Generic methodology for structuring a handoff.")
        rc = cs.main([rel], root=str(tmp_path), client_factory=lambda: None, require_llm=False)
        assert rc == 0

    def test_missing_llm_when_required_fails_closed(self, tmp_path):
        rel = self._write(tmp_path, "infra/templates/skills/x/SKILL.md", "clean text")

        def boom():
            raise RuntimeError("ANTHROPIC_API_KEY not set")

        rc = cs.main([rel], root=str(tmp_path), client_factory=boom, require_llm=True)
        assert rc == 1

    def test_llm_flag_fails(self, tmp_path):
        rel = self._write(tmp_path, "infra/templates/skills/x/SKILL.md", "clean-looking text")
        c = TestLLMLayer._FakeClient('{"flagged": true, "reasons": ["case detail"]}')
        rc = cs.main([rel], root=str(tmp_path), client_factory=lambda: c, require_llm=True)
        assert rc == 1
