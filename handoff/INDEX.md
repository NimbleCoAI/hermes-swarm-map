# Hermes Swarm Map — Handoff Package

## Quick start

1. Open **`CLAUDE_CODE_PROMPT.md`** — paste into Claude Code as initial instructions
2. Read **`README.md`** — full implementation spec
3. Open **`design_reference/Swarm Map Redesign.html`** in a browser to see the working prototype
4. Browse **`design_reference/DESIGN_NOTES.md`** for the conceptual model

## What's inside

```
handoff/
├── INDEX.md                   ← you are here
├── CLAUDE_CODE_PROMPT.md      ← paste into Claude Code
├── README.md                  ← extensive build spec
└── design_reference/
    ├── Swarm Map Redesign.html   ← live prototype (open in browser)
    ├── DESIGN_NOTES.md           ← model, principles, v1/v2/v3 roadmap
    ├── mock-data.js              ← canonical data shape
    ├── theme.css                 ← design tokens
    └── *.jsx                     ← prototype source (reference, do not copy)
```

## Repo context

- Original repo: `nimblecoai/swarm-Map` (Next.js app router)
- Lives alongside Hermes runtime in a pnpm workspace
- This handoff supersedes the prior `swarm-Map` admin UI scope
