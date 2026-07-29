# Runtimes: Hermes and Letta

Swarm Map manages two kinds of agent. They are different shapes, not two skins on one
model, and they are **not at feature parity**. This page states the line precisely and
shows the evidence, so nobody has to discover the gap after deploying.

## The two shapes

**Hermes — container per agent.** An agent is a Docker container with its own data
directory, `.env`, `SOUL.md`, memory files, plugins, and messaging surfaces. You can
start it, stop it, restart it, rebuild it, read its logs, and attach it to Signal,
Telegram, Mattermost or Discord. Container verbs mean something here.

**Letta — memory-first agents as rows on one server.** The Letta *server* is a container.
The agents are rows in that server's Postgres. There is no per-agent container, so there
is nothing to restart, no CPU or memory to graph, no per-agent logs. You reach an agent
over the server's REST API.

Swarm Map keeps these separate on purpose. `ContainerRuntimeAdapter`
(`lib/services/runtime-adapter.ts`) is the seam for container runtimes; Letta is
deliberately *not* registered there and goes through its own REST provider
(`lib/services/letta-agent-provider.ts`, `lib/services/letta.ts`). The agent detail page
renders a dedicated view (`components/harness/letta-agent-detail.tsx`) rather than
threading `runtime === 'letta'` branches through the Hermes page.

## What ships today

| Capability | Hermes | Letta |
|---|---|---|
| Deploy from the wizard | yes | yes — brings the shared server up and creates the agent |
| Appears in the fleet list | yes | yes |
| Start / stop / restart / rebuild / purge | yes | **n/a** — no container. The *server* has these. |
| Container logs | yes | **n/a** |
| CPU / memory / health | yes | **n/a** — the detail view shows model handle + identity instead |
| Read agent state over the API | yes | yes |
| Read core memory | yes (files) | yes — core-memory blocks, read-only |
| Git-backed memory files (memfs) | n/a | **not enabled** (see below) |
| Send a message from the UI | yes | yes |
| Edit memory / reconfigure / delete agent | yes | **not shipped** (see below) |
| Messaging surfaces | yes, direct | only via a Hermes front that proxies a group conversation |
| Group approval policy | yes | inherited through a Hermes front |
| Audit log | yes | inherited through a Hermes front |
| Budget enforcement | yes | **partial** — non-streaming path only (see below) |
| Model cascade / fallback provider | yes | no — single model handle, no per-agent fallback |
| Bundled Ollama | yes | no |

## Three things that are easy to overclaim

### 1. The Letta API surface is read-only plus send-message

Swarm Map's Letta routes are exactly these five:

| Method | Route |
|---|---|
| `GET` | `app/api/letta/harnesses/route.ts` |
| `GET` | `app/api/letta/agents/route.ts` |
| `GET` | `app/api/letta/agents/[id]/blocks/route.ts` |
| `GET` | `app/api/letta/agents/[id]/files/route.ts` |
| `POST` | `app/api/letta/agents/[id]/messages/route.ts` |

Four reads and one message send. There is **no** `PATCH`, `PUT` or `DELETE` anywhere under
`app/api/letta/`. Verify it yourself:

```bash
for f in $(find app/api/letta -name route.ts); do
  echo "--- $f"
  grep -nE '^export (async )?(function|const) (GET|POST|PATCH|PUT|DELETE)' "$f"
done
```

So: editing memory blocks, changing an agent's model or configuration, and deleting an
agent are **not shipped**. Creation is not part of this surface either — it happens through
`POST /api/setup/deploy` with the Letta runtime selected, which calls `deployLettaAgent`
(`lib/services/letta-deploy-templates.ts`). The one delete call in the codebase
(`services.letta.deleteAgent`) exists solely to roll back an orphaned agent when a deploy
fails partway; it is not a user-facing delete.

Anything that describes Swarm Map as offering Hermes-equivalent lifecycle or memory
management for Letta agents is wrong.

### 2. memfs / git-backed "Context files" is not enabled

Letta's modern agents can keep memory as a git-backed file tree (memfs), with `system/`
files pinned into the prompt and the rest opened on demand. Swarm Map reads that view
(`GET /v1/agents/{id}/files`) and will render it if a server exposes one — but **we do not
enable it**:

- `git_enabled` has **zero** occurrences in this repository, executable code or otherwise.
- Agents created by our deploy path come up with `git_enabled: false`.

Consequence: for every agent Swarm Map creates, the "Context files (memfs)" panel is
empty. It is labelled **not enabled** in the UI, with core memory identified as the live
memory surface, so the panel does not read as an empty promise. Enabling memfs, and the
memfs↔REST write/live-sync semantics, are unshipped.

If you are writing copy about Letta memory in this product, say **core-memory blocks**.
Say memfs only with "not enabled yet" attached.

### 3. Budget does not inherit on the default path

A Hermes front can proxy a group conversation to a Letta agent. Two of the door's three
guarantees carry over cleanly, and one does not:

- **Group approval — inherits.** The policy check gates the turn *before* it runs, so a
  proxied turn passes through the same approval gate as any other.
- **Audit — inherits.** The turn is recorded on the same audit path.
- **Budget — does not inherit on the default path.** Streaming is on by default, and a
  streamed turn reports **zero tokens** back to the enforcement hook. Zero tokens means
  zero recorded spend, which means the soft budget cap is never approached, let alone
  tripped. Budget enforcement for proxied turns is only meaningful on the blocking /
  non-streaming path.

Do not write "the bridge inherits the door's approval, audit and budget". Write the first
two, then qualify the third.

## Related

- [Getting Started](getting-started.md)
- [Image vs HSM Boundary](architecture/image-vs-hsm-boundary.md)
- [Roadmap](ROADMAP.md)
