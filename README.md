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
git clone https://github.com/yourusername/imsg-mcp.git
cd imsg-mcp
pnpm install
pnpm build
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
imsg-cli messages "+61412345678" 20
imsg-cli unread 100
imsg-cli search "meeting" 20
imsg-cli wait "+61412345678" 120
imsg-cli send "+61412345678" "Hello"
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

Key bindings:

- `Tab` - switch between sidebar and thread panes
- `Up` / `Down` or `j` / `k` - move selection or scroll the thread
- `PageUp` / `PageDown` - scroll the thread faster
- `r` - refresh conversations and messages
- `q` - quit

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

- `get_messages`
- `get_unread_messages`
- `send_message`
- `wait_for_reply`
- `list_conversations`
- `search_messages`
- `get_logs`
- `get_last_send_error`

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

Bundled fixture databases under `env-data/` are stored with Git LFS.

After cloning, run:

```bash
git lfs pull
```

If fixture DBs are still LFS pointer files, tests and local AI mode will fail with SQLite errors.

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
