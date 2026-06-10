# Pattern: Use-Case Packages

A **use-case package** is a self-contained agent capability — plugin + skill + soul
+ (optionally) a domain engine — built on top of `hermes-agent-mt` and consumed by
HSM as an artifact. `osint-engine` is the worked example; the reusable scaffold is
[`usecase-package-template`](https://github.com/NimbleCoAI/usecase-package-template)
(fork it to start a new one — it ships the sanitization gate, the instance overlay,
and the contribution docs pre-wired).

This doc covers how HSM consumes such a package, how the privacy boundaries line up,
and the **upstream contribution policy** for the base package.

## How HSM consumes a package

The package separates cleanly into two halves:

- **The image** — runtime + system binaries only. Built once, pinned, rebuilt only
  when binaries change. It carries no package code.
- **The data dir** (`/opt/data`, `HERMES_HOME`) — the package `git clone`, the
  operator's private skills/soul/memory, and per-engagement data. Hot-mounted; the
  package updates via `git pull` + restart, no rebuild.

HSM owns the orchestration the operator would otherwise do by hand: it writes the
compose, injects the package's `requires_env` keys from the encrypted env store at
runtime (never into git), manages the mount, and exposes plugin enable/disable in the
UI. The operator does not `docker compose` directly when HSM manages the harness — use
the HSM API. The data layout is identical to standalone use; only the orchestrator
differs.

A package's `hermes-plugin/plugin.yaml` declares `name`, `kind`, `requires_env`, and
`provides_tools`; its `register(ctx)` is called once by the plugin loader at startup.
That manifest is the contract HSM installs against.

## Two privacy boundaries

A use-case package sits inside both of HSM's privacy boundaries; keep them distinct.

**Repository visibility** — the package source is private by default, optionally
per-artifact (`git:<org>/<repo>#<tag>`), flipped to public only by choice. When HSM
installs a git-sourced artifact it runs the inbound trust gate first: pin-enforced
fetch, threat-pattern scan, and (where declared) a capability allow-list, before the
artifact reaches an agent. See `docs/specs/2026-06-03-artifact-commons-design.md` and
the git-sourced-artifacts runbook.

**Cross-context visibility** — within one running deployment, an agent serving many
contexts must not leak skills, working files, or memory across them. Structured memory
is already scoped via `MemoryStore(context_id=)`; the working filesystem and skills are
governed by the glocal read floor. Per the
[image/HSM boundary](../architecture/image-vs-hsm-boundary.md): the enforcement layers
live in the `hermes-agent-mt` image (L1 in-process read-deny + L2 terminal command-guard,
both defense-in-depth) and the only true boundary is L3 — secrets not mounted into the
agent namespace, owned by HSM compose. Do not present L1/L2 as walls.

## Upstream contribution policy (read before accepting base-package PRs)

The base package ships to **every** deployed agent. An injected line therefore carries
fleet-wide blast radius. The policy that keeps the commons trustworthy as it opens:

**Inbound contributions to the base are proposals, not merges.** A contributor opens a
PR describing a generic capability and providing the generalized artifact as a reference.
The sanitization gate runs on the diff (deterministic secrets/PII + semantic particulars).
But maintainers do **not** merge the submitted bytes — they **close the PR and re-author**
the capability from the described pattern, against trusted code. The contributor gets
credit and the capability lands; their exact bytes do not enter the base.

This is the supply-chain defense for the commons: the gate makes *sharing* safe, the
rewrite makes *accepting* safe. Until `pull_request_target` trusted-scanner hardening is
in place (so the build-time key is un-stealable by an injected PR), the gate's semantic
layer runs only on trusted branches — another reason inbound code is never trusted as-is.

Promotion to an operator's *own* package is different: that is autonomous, gated by the
same sanitization check, and merged at the operator's discretion. Only the **base** —
the shared substrate — carries the close-and-rewrite rule.
