# Platform Setup Guides

Hermes agents connect to messaging platforms to serve users. This guide covers setup for each supported platform.

> **Security default:** All platforms deny access by default. You must explicitly approve users, groups, and channels before an agent will respond.

---

## Telegram

1. Message [@BotFather](https://t.me/BotFather) on Telegram and run `/newbot`
2. Copy the bot token it gives you
3. Paste it in the HSM wizard (Step 2) or add to `.env`:

```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
```

| Env Var | Default | Description |
|---------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | — | Bot token from BotFather |
| `TELEGRAM_ALLOWED_USERS` | *(empty = deny all)* | Comma-separated Telegram user IDs |
| `TELEGRAM_REQUIRE_MENTION` | `true` | Agent only responds when @mentioned in groups |

**Approving users:** Use the HSM **Surfaces** tab to add users, or add their numeric Telegram user IDs to `TELEGRAM_ALLOWED_USERS`.

**Group access:** New groups require approval via the HSM policy endpoint before the agent will respond in them.

---

## Signal

Signal requires [signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api) running as a sidecar (typically a Docker container on port 8080).

1. Start signal-cli-rest-api and register a phone number through it
2. Configure in the wizard or `.env`:

```env
SIGNAL_HTTP_URL=http://host.docker.internal:8080
SIGNAL_ACCOUNT=+15551234567
```

| Env Var | Default | Description |
|---------|---------|-------------|
| `SIGNAL_HTTP_URL` | — | URL to signal-cli-rest-api (use `host.docker.internal` from inside Docker) |
| `SIGNAL_ACCOUNT` | — | Registered phone number in E.164 format |
| `SIGNAL_ALLOWED_USERS` | *(empty = deny all)* | Comma-separated phone numbers for DM access |
| `SIGNAL_GROUP_ALLOWED_USERS` | *(empty = deny all)* | Comma-separated phone numbers for group access |
| `SIGNAL_REQUIRE_MENTION` | `true` | Agent only responds when @mentioned in groups |
| `SIGNAL_GROUP_INVITE_POLICY` | `approved-only` | Controls whether agent auto-joins group invites |

**Voice memos:** Agents can transcribe incoming voice messages via local Whisper when available.

---

## Mattermost

1. Create a bot account in **Mattermost System Console > Integrations > Bot Accounts**
2. Copy the bot token
3. Configure in the wizard or `.env`:

```env
MATTERMOST_URL=https://mattermost.example.com
MATTERMOST_TOKEN=your-bot-token
```

| Env Var | Default | Description |
|---------|---------|-------------|
| `MATTERMOST_URL` | — | Your Mattermost server URL |
| `MATTERMOST_TOKEN` | — | Bot access token |
| `MATTERMOST_ALLOWED_USERS` | *(empty = deny all)* | Comma-separated Mattermost usernames |
| `MATTERMOST_ALLOWED_CHANNELS` | *(empty = deny all)* | Comma-separated channel names |
| `MATTERMOST_REQUIRE_MENTION` | `true` | Agent only responds when @mentioned |

---

## Google Workspace (preview)

Requires [NimbleCoAI/google-multiplayer-mcp](https://github.com/NimbleCoAI/google-multiplayer-mcp) installed alongside HSM. Enable via the wizard in Step 3.

1. Deploy your agent with Google Workspace enabled
2. Visit the agent's OAuth callback URL to authorize access
3. Grants Calendar, Drive, and Gmail access to the agent

Currently in preview — expect breaking changes.

---

## Common Patterns

All platforms share these conventions:

| Env Var | Default | Description |
|---------|---------|-------------|
| `HERMES_DM_POLICY` | `approved-only` | Controls DM access across all platforms |
| `HERMES_APPROVAL_ADMIN_ONLY` | `true` | Only admins can run `/approve` |

- **Deny all by default.** Empty allowlists mean no access. You must explicitly approve users.
- **Wildcard `*`** in any allowlist permits all users/groups/channels for that field.
- **`REQUIRE_MENTION` defaults to `true`** on every platform — agents stay quiet in groups unless addressed.
- **Approval via HSM UI:** The **Surfaces** tab lets you manage approved users and groups without editing `.env` files.
- **Approval via `.env`:** Power users can edit allowlists directly and restart the agent.
