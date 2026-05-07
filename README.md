# imsg-mcp

MCP server, CLI, and terminal UI for iMessage on macOS.

`imsg-mcp` lets AI agents and local tools read your iMessage/SMS database, resolve contact names from Address Book, inspect unread messages, search history, and optionally send messages through Messages.app.

## What ships in this package

- `imsg-mcp` - MCP stdio server for Claude Desktop, Cursor, Warp, and other MCP clients
- `imsg-cli` - interactive debug console plus one-off CLI commands
- `imsg` - read-only terminal UI for browsing conversations and messages
- `imsg-cli doctor` / `imsg-mcp --doctor` - local permission and setup checks for new machines

## Features

- Read recent messages, unread messages, and search results
- List conversations with stable `threadSlug` identifiers
- Resolve phone numbers and emails to contact names from Address Book, including iCloud sources
- Merge duplicated chat rows and multi-handle contact threads more like Messages.app
- Parse rich content and `attributedBody` text better than raw SQLite reads
- Send messages through Messages.app when explicitly requested
- Browse conversations in a TUI without opening Messages.app

## Requirements

- macOS for live iMessage access
- Node.js 24+
- Full Disk Access for the app running the command
- Messages.app signed in if you want to send messages

## Installation

### Global install

```bash
npm install -g imsg-mcp
```

That gives you:

- `imsg-mcp`
- `imsg-cli`
- `imsg`

### From source

```bash
git clone https://github.com/george43g/imsg-mcp.git
cd imsg-mcp
pnpm install        # also generates synthetic test fixtures + builds
pnpm test           # 170+ tests should pass
```

## First run on a new machine

Run the doctor command before troubleshooting anything else:

```bash
imsg-cli doctor
```

or:

```bash
imsg-mcp --doctor
```

It checks:

- macOS vs unsupported platforms
- whether `~/Library/Messages/chat.db` is readable
- whether Address Book databases are readable
- whether Messages.app is running

If Full Disk Access is missing, it prints a user-friendly explanation and tells you where to enable it:

- `System Settings -> Privacy & Security -> Full Disk Access`
- add the app actually running the command, such as Terminal, iTerm2, Warp, VS Code, or Cursor
- fully restart that app afterward

## Permissions

### Full Disk Access

Required for reading:

- `~/Library/Messages/chat.db`
- `~/Library/Application Support/AddressBook/AddressBook-v22.abcddb`
- iCloud Address Book source databases under `~/Library/Application Support/AddressBook/Sources/...`

Without it, the server cannot read your live messages or contacts.

### Automation

Required only for sending messages.

On the first send, macOS will usually prompt you to allow the terminal or IDE to control Messages.app. Accept that prompt to enable sending.

## CLI usage

### Interactive console

```bash
imsg-cli
```

This starts the debug console and talks to the local MCP server under the hood.

### One-off commands

```bash
imsg-cli doctor
imsg-cli conversations 20
imsg-cli messages "+15555550100" 20
imsg-cli unread 100
imsg-cli search "meeting" 20
imsg-cli wait "+15555550100" 120
imsg-cli send "+15555550100" "Hello"
imsg-cli tools
```

## Terminal UI

Launch the read-only TUI with either command:

```bash
imsg
```

or:

```bash
imsg-cli --tui
```

Vim-style keybindings:

| Key | Action |
|-----|--------|
| `j` / `k` | move cursor down / up |
| `#j` / `#k` | jump N rows (e.g. `12j`) |
| `gg` / `G` | jump to top / bottom |
| `Ctrl-d` / `Ctrl-u` | half-page down / up |
| `{` / `}` | jump to previous / next sender group |
| `Tab` | switch sidebar ↔ messages pane |
| `Enter` | open message detail drawer |
| `o` | open attachment (image → system viewer; video → mpv) |
| `:` | open date-jump modal (e.g. `2024-03-15`, `1 year ago`) |
| `V` | enter visual selection mode |
| `e` (in select) | open export modal (Markdown / CSV / JSON) |
| `y` | copy thread slug, or selected text in select mode |
| `/` | filter conversations |
| `c` | compose message |
| `d` | toggle dev stats panel (engine, CPU, mem, lag, query time) |
| `r` | refresh |
| `q` | quit |

## MCP server usage

Run the stdio server directly:

```bash
imsg-mcp
```

### Claude Desktop example

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "imessage": {
      "command": "imsg-mcp"
    }
  }
}
```

### Manual stdio run

```bash
imsg-mcp
```

The server logs to stderr and speaks MCP over stdio on stdout.

## MCP tools

| Tool | Purpose |
|------|---------|
| `get_messages` | Paginated messages from a chat (cursor via `beforeMessageId`). |
| `get_unread_messages` | All unread messages across chats. |
| `list_conversations` | Conversations with `threadSlug`, snippets, unread counts. |
| `search_messages` | Full-text search across all messages. |
| `send_message` | Send via Messages.app (requires Automation permission). |
| `wait_for_reply` | Poll for new incoming messages. Honors `notifications/cancelled`. |
| `export_messages` | **Stream** an entire conversation (or date range) to a file (markdown / csv / json / ndjson). Never loads the whole history into memory. |
| `health_check` | Server vitals — uptime, heap, RSS, event-loop lag, tool counts. Returns instantly even when SQL is slow. |
| `get_logs` | In-memory + on-disk NDJSON logs (`source: memory \| file \| all`). |
| `get_last_send_error` | Detail on the most recent send failure. |
| `request_restart` | Graceful exit so the host respawns the server. |
| `run_build` | Run `pnpm build` (dev convenience). |

### Pagination + bounded responses

- `get_messages` returns up to 5000 messages per call (regardless of `limit: 0`). Response footer:
  ```
  _Pagination: oldestMessageId=12345, hasMore=true_
  ```
  Pass `oldestMessageId` as `beforeMessageId` for the next page.
- For very large histories, use `export_messages` instead — it streams to disk and won't OOM.

### Self-healing watchdog

The server runs a watchdog that monitors event-loop lag, RSS / heap growth, and idle uptime. If anything goes wrong it self-kills so the MCP host respawns a clean instance — meaning a single bad query can't wedge your agent session.

### Thread slugs

`list_conversations` returns a stable `threadSlug` for each visible conversation. Use that slug with:

- `send_message`
- `wait_for_reply`

`get_messages` accepts either `chatIdentifier` or `threadSlug`.

## Example MCP workflow

1. `list_conversations`
2. pick the right `threadSlug`
3. `send_message`
4. `wait_for_reply`

## Optional companion skill

The MCP server is the important part. A skill is optional, but useful if your agent platform supports installable skills and you want to teach agents how to use this server safely.

This repo includes an optional companion skill at `skills/imsg-mcp/SKILL.md`.

## Environment and defaults

Live defaults:

- Messages DB: `~/Library/Messages/chat.db`
- Contacts DB: `~/Library/Application Support/AddressBook/AddressBook-v22.abcddb`
- Slug DB: `~/.imsg-mcp/slugs.db`

Optional overrides:

- `VITE_IMSG_DB_PATH`
- `VITE_CONTACTS_DB_PATH`
- `VITE_ADDRESS_BOOK_UUID`
- `VITE_SLUGS_DB_PATH`

## Development

```bash
pnpm build
pnpm dev
pnpm mcp
pnpm cli
pnpm tui
pnpm doctor
pnpm test
pnpm typecheck
pnpm lint
```

### Fixture data

Tests run against a **synthetic SQLite fixture** generated locally on `pnpm install`. No real iMessage data is committed — fixtures are built from a seeded RNG with lorem-ipsum content and phone numbers in the `+1-555-01xx` fictional reserved range.

```bash
pnpm fixtures           # regenerate fixtures
pnpm fixtures:fresh     # delete + regenerate
pnpm test               # all tests run against fixtures by default
pnpm stress             # MCP stress harness against fixtures
pnpm stress:live        # stress harness against your real Mac data
```

### Privacy

This server reads only your local `~/Library/Messages/chat.db`. Nothing is uploaded anywhere. Whatever MCP host (Claude / Cursor / Warp / etc.) you connect this server to will see the contents of your messages — treat those hosts the same way you treat any app with Full Disk Access.

## Troubleshooting

### `Operation not permitted`

Run:

```bash
imsg-cli doctor
```

Then grant Full Disk Access and restart the app running the command.

### `Messages.app is not running or accessible`

Open Messages.app. Reading still works without it, but sending does not.

### Contact names are missing

Grant Full Disk Access to the running app. `imsg-mcp` auto-discovers iCloud Address Book source databases when it can read the Address Book root.

### Native module mismatch

If `better-sqlite3` was built for the wrong Node version:

```bash
pnpm rebuild better-sqlite3
```

## Publishing notes

This package is ready to publish as a multi-bin package. Global installs expose:

- `imsg-mcp`
- `imsg-cli`
- `imsg`

## License

MIT
