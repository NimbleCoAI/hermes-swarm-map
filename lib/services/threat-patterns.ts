// TS port of the image-side `tools/threat_patterns.py` prompt-injection /
// promptware / exfiltration library. Kept faithful to that module so HSM's
// pre-install gate for git-sourced artifacts matches the runtime backstop.
//
// Scope semantics mirror the Python module:
//   "all"     — applied everywhere (classic prompt injection, exfiltration)
//   "context" — context files / memory / tool results (promptware / C2 / hijack)
//   "strict"  — memory writes + skill installs only (aggressive checks)
// A pattern with scope "all" is included in all+context+strict; "context" in
// context+strict; "strict" in strict only.
//
// NOTE: this is the EARLY gate. The authoritative scanner remains the Python
// library in the agent image (defense in depth) — keep the two in sync when
// upstream patterns change.

export type ThreatScope = 'all' | 'context' | 'strict'

interface PatternEntry {
  re: RegExp
  id: string
  scope: ThreatScope
}

const R = (src: string): RegExp => new RegExp(src, 'i')

const PATTERNS: PatternEntry[] = [
  // ── Classic prompt injection (all) ──────────────────────────────
  { re: R(String.raw`ignore\s+(?:\w+\s+)*(previous|all|above|prior)\s+(?:\w+\s+)*instructions`), id: 'prompt_injection', scope: 'all' },
  { re: R(String.raw`system\s+prompt\s+override`), id: 'sys_prompt_override', scope: 'all' },
  { re: R(String.raw`disregard\s+(?:\w+\s+)*(your|all|any)\s+(?:\w+\s+)*(instructions|rules|guidelines)`), id: 'disregard_rules', scope: 'all' },
  { re: R(String.raw`act\s+as\s+(if|though)\s+(?:\w+\s+)*you\s+(?:\w+\s+)*(have\s+no|don't\s+have)\s+(?:\w+\s+)*(restrictions|limits|rules)`), id: 'bypass_restrictions', scope: 'all' },
  { re: R(String.raw`<!--[^>]*(?:ignore|override|system|secret|hidden)[^>]*-->`), id: 'html_comment_injection', scope: 'all' },
  { re: R(String.raw`<\s*div\s+style\s*=\s*["'][\s\S]*?display\s*:\s*none`), id: 'hidden_div', scope: 'all' },
  { re: R(String.raw`translate\s+.*\s+into\s+.*\s+and\s+(execute|run|eval)`), id: 'translate_execute', scope: 'all' },
  { re: R(String.raw`do\s+not\s+(?:\w+\s+)*tell\s+(?:\w+\s+)*the\s+user`), id: 'deception_hide', scope: 'all' },

  // ── Role-play / identity hijack (context) ───────────────────────
  { re: R(String.raw`you\s+are\s+(?:\w+\s+)*now\s+(?:a|an|the)\s+`), id: 'role_hijack', scope: 'context' },
  { re: R(String.raw`pretend\s+(?:\w+\s+)*(you\s+are|to\s+be)\s+`), id: 'role_pretend', scope: 'context' },
  { re: R(String.raw`output\s+(?:\w+\s+)*(system|initial)\s+prompt`), id: 'leak_system_prompt', scope: 'context' },
  { re: R(String.raw`(respond|answer|reply)\s+without\s+(?:\w+\s+)*(restrictions|limitations|filters|safety)`), id: 'remove_filters', scope: 'context' },
  { re: R(String.raw`you\s+have\s+been\s+(?:\w+\s+)*(updated|upgraded|patched)\s+to`), id: 'fake_update', scope: 'context' },
  { re: R(String.raw`\bname\s+yourself\s+\w+`), id: 'identity_override', scope: 'context' },

  // ── C2 / promptware (context) ───────────────────────────────────
  { re: R(String.raw`register\s+(as\s+)?a?\s*node`), id: 'c2_node_registration', scope: 'context' },
  { re: R(String.raw`(heartbeat|beacon|check[\s-]?in)\s+(to|with)\s+`), id: 'c2_heartbeat', scope: 'context' },
  { re: R(String.raw`pull\s+(down\s+)?(?:new\s+)?task(?:ing|s)?\b`), id: 'c2_task_pull', scope: 'context' },
  { re: R(String.raw`connect\s+to\s+the\s+network\b`), id: 'c2_network_connect', scope: 'context' },
  { re: R(String.raw`you\s+must\s+(?:\w+\s+){0,3}(register|connect|report|beacon)\b`), id: 'forced_action', scope: 'context' },
  { re: R(String.raw`only\s+use\s+one[\s-]?liners?\b`), id: 'anti_forensic_oneliner', scope: 'context' },
  { re: R(String.raw`never\s+(?:\w+\s+)*(?:create|write)\s+(?:\w+\s+)*(?:script|file)\s+(?:\w+\s+)*disk`), id: 'anti_forensic_disk', scope: 'context' },
  { re: R(String.raw`unset\s+\w*(?:CLAUDE|CODEX|HERMES|AGENT|OPENAI|ANTHROPIC)\w*`), id: 'env_var_unset_agent', scope: 'context' },
  { re: R(String.raw`\b(?:praxis|cobalt\s*strike|sliver|havoc|mythic|metasploit|brainworm)\b`), id: 'known_c2_framework', scope: 'context' },
  { re: R(String.raw`\bc2\s+(?:server|channel|infrastructure|beacon)\b`), id: 'c2_explicit', scope: 'context' },
  { re: R(String.raw`\bcommand\s+and\s+control\b`), id: 'c2_explicit_long', scope: 'context' },

  // ── Exfiltration (all / strict) ─────────────────────────────────
  { re: R(String.raw`curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)`), id: 'exfil_curl', scope: 'all' },
  { re: R(String.raw`wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)`), id: 'exfil_wget', scope: 'all' },
  { re: R(String.raw`cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)`), id: 'read_secrets', scope: 'all' },
  { re: R(String.raw`(send|post|upload|transmit)\s+.*\s+(to|at)\s+https?://`), id: 'send_to_url', scope: 'strict' },
  { re: R(String.raw`(include|output|print|share)\s+(?:\w+\s+)*(conversation|chat\s+history|previous\s+messages|full\s+context|entire\s+context)`), id: 'context_exfil', scope: 'strict' },

  // ── Persistence / SSH backdoor (strict) ─────────────────────────
  { re: R(String.raw`authorized_keys`), id: 'ssh_backdoor', scope: 'strict' },
  { re: R(String.raw`\$HOME/\.ssh|~/\.ssh`), id: 'ssh_access', scope: 'strict' },
  { re: R(String.raw`\$HOME/\.hermes/\.env|~/\.hermes/\.env`), id: 'hermes_env', scope: 'strict' },
  { re: R(String.raw`(update|modify|edit|write|change|append|add\s+to)\s+.*(?:AGENTS\.md|CLAUDE\.md|\.cursorrules|\.clinerules)`), id: 'agent_config_mod', scope: 'strict' },
  { re: R(String.raw`(update|modify|edit|write|change|append|add\s+to)\s+.*\.hermes/(config\.yaml|SOUL\.md)`), id: 'hermes_config_mod', scope: 'strict' },

  // ── Hardcoded secrets (strict) ──────────────────────────────────
  { re: R(String.raw`(?:api[_-]?key|token|secret|password)\s*[=:]\s*["'][A-Za-z0-9+/=_-]{20,}`), id: 'hardcoded_secret', scope: 'strict' },
]

// Invisible / bidirectional unicode characters used in injection attacks.
// Aligned with the Python INVISIBLE_CHARS set.
const INVISIBLE_CHARS = new Set([
  '​', '‌', '‍', '⁠', '⁢', '⁣', '⁤', '﻿',
  '‪', '‫', '‬', '‭', '‮',
  '⁦', '⁧', '⁨', '⁩',
])

function includesScope(pattern: ThreatScope, requested: ThreatScope): boolean {
  if (requested === 'all') return pattern === 'all'
  if (requested === 'context') return pattern === 'all' || pattern === 'context'
  // strict: every scope applies
  return true
}

/**
 * Scan `content` for prompt-injection / promptware / exfiltration patterns.
 * Returns the list of matched pattern ids (deduped). Empty array = clean.
 */
export function scanForThreats(content: string, scope: ThreatScope = 'context'): string[] {
  const findings = new Set<string>()

  for (const ch of content) {
    if (INVISIBLE_CHARS.has(ch)) {
      findings.add('invisible_unicode')
      break
    }
  }

  for (const { re, id, scope: pscope } of PATTERNS) {
    if (!includesScope(pscope, scope)) continue
    if (re.test(content)) findings.add(id)
  }

  return [...findings]
}
