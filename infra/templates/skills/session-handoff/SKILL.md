# Session Handoff

Write a structured handoff at the end of any significant session so the next
session — or a different agent — can resume without re-deriving context.

A handoff is not a status report. It is a compressed transfer of working memory:
what decisions were made and why, what is still live, and where to pick up.
Keeping it current is the discipline that makes multi-session work tractable.

## When to write a handoff

- At the end of any session with 3+ meaningful actions or decisions
- Before handing work to another agent or human
- When a thread is being deliberately parked (record *why*, not just *that*)
- Whenever you discover a tool quirk, dead end, or approach that failed — so
  the next session doesn't repeat it

## Structure

Use the fill-in template at `docs/templates/session-handoff.md`. The required
sections are:

### 1. What happened and why it matters
One to three sentences. What was the session's primary outcome? Why does it
matter to the broader goal? Skip if nothing significant happened.

### 2. Key decisions
For each non-trivial choice made this session:
- **Decision:** what was decided
- **Rationale:** why (not just what — the reasoning is what transfers)
- **Alternatives considered:** what was ruled out and why (prevents re-opening
  settled questions)

### 3. Current state
A quick status snapshot of the work:

| Thread | Status | Notes |
|--------|--------|-------|
| `<topic A>` | ✅ done | merged, deployed, closed |
| `<topic B>` | 🔄 in progress | mid-way, next step is X |
| `<topic C>` | 🚧 blocked | waiting on Y before proceeding |
| `<topic D>` | ⏸ parked | deprioritized — reason: Z |

### 4. Open threads
For each thread still live, give enough context to resume cold:
- What the thread is about
- What has been tried / ruled out
- What the concrete next step is (a specific command, file, API call, or
  decision — not "continue working on X")
- Any relevant file paths, branch names, or tool state

### 5. Closed threads — why they closed
Record threads that were *deliberately* closed this session. This section
prevents future sessions from re-opening dead ends.

- `<topic>` — closed because: `<reason>`. Do not revisit unless `<condition>`.

### 6. Next session entry point
One paragraph. If a fresh session reads nothing else, what is the one thing
it needs to know to start useful work immediately?

## Rules

**Be specific about next steps.** "Continue the migration" is useless.
"Run `<command>` in `<directory>`, then open PR against `<branch>`" is useful.

**Record dead ends explicitly.** If you tried approach A and it failed for
reason X, write that. The cost of re-deriving a dead end is high.

**Don't inflate.** A handoff that is too long gets skimmed and misses the
essential parts. Aim for the minimum that lets a cold session resume without
asking clarifying questions.

**Decisions need rationale.** A decision without rationale is just a fact.
Rationale is what prevents the decision from being revisited every session.

**Timestamps matter.** Always include the session date so staleness is visible.

## Example (abbreviated)

```
## Session: <YYYY-MM-DD> — <one-line summary>

### What happened
Migrated <topic> from the old pipeline to the new one. All tests pass.
This unblocks the work that was waiting on the pipeline change.

### Key decisions
- **Kept old schema column**: removing it would require a coordinated deploy;
  added a migration note instead. Revisit in Q3.
- **Chose approach B over A**: approach A would have required changes to three
  other services; B is self-contained.

### Current state
| Thread | Status | Notes |
|--------|--------|-------|
| Pipeline migration | ✅ done | merged to main |
| API client update | 🔄 in progress | branch: feature/<topic>-client |
| Auth refactor | ⏸ parked | blocked on external dependency |

### Open threads
**API client update** — branch `feature/<topic>-client`. Next step: add the
retry logic in `<path/to/file>` then open PR against `main`. The mock in
`<path/to/test>` needs updating first or tests will fail.

### Closed threads
- Schema cleanup — closed: deferred to Q3 (see decision above).

### Next session entry point
Start by pulling `feature/<topic>-client` and running the test suite. The
API client is the only live thread; everything else is done or parked.
```

## Multi-agent handoffs

When passing work between agents (e.g. from an orchestrator to a worker, or
between Hermes instances in a swarm):

- Include the **platform and channel context** if the next agent needs to
  send messages or read history
- Note any **tool or credential state** the receiving agent needs to
  bootstrap (e.g. which keys are configured, which services are live)
- Specify the **delivery format** — should the next agent reply in-thread,
  open a PR, or write to a shared file?
