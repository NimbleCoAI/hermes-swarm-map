# Claude Code — Hermes Swarm Map

See **AGENTS.md** for architecture, patterns, service layer, and what not to do. Read it before touching any code.

---

## Session Rules

1. **Read AGENTS.md first.** Every session. It contains the canonical architecture decisions. Don't infer patterns from the codebase without reading it first — some behaviors (port allocation, encryption, compose file rules) are non-obvious.

2. **Run tests before committing.**
   ```bash
   pnpm vitest run
   ```
   71 tests must pass. If you break any, fix them before committing. Don't skip or comment out tests.

3. **This is NOT an Egregore instance.** There is no `memory/`, no `/save`, no `/handoff`, no `/wrap`. Don't reference Egregore commands or infrastructure. This is a standalone open-source project.

4. **Next.js version warning.** See the notice at the top of AGENTS.md — this runs a newer Next.js than most training data covers. Check `node_modules/next/dist/docs/` when in doubt about API behavior.

5. **No secrets in commits.** API keys, tokens, and `.env` files are gitignored. Keep them that way.
