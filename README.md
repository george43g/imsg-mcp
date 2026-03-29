# imsg-mcp

MCP (Model Context Protocol) server for iMessage on macOS. Enables AI agents to send and receive iMessages, perfect for building AI assistants that can communicate with you via text when they need input.

## Features

- **Send iMessages/SMS** - Send messages to any phone number or email address
- **Read Messages** - Get recent messages from all conversations or specific chats
- **Unread Messages** - Retrieve all unread messages across conversations
- **Wait for Reply** - Poll for new messages with configurable timeout (ideal for AI agents waiting for human responses)
- **List Conversations** - View all your conversations with metadata
- **Search Messages** - Search through your message history
- **Contact Integration** - Automatically resolves phone numbers/emails to contact display names
- **Rich Content Detection** - Identifies and parses link previews, location shares, and other rich message content
- **Delivery & Read Receipts** - Shows message delivery and read status with timestamps
- **Thread slugs** - Stable, human-readable IDs per conversation (from `list_conversations`) so agents can target **group chats** and avoid opaque `chat` identifiers; used by `send_message` and `wait_for_reply`

## Requirements

- **macOS** (tested on Ventura and later) for production use with your real `chat.db` and Messages.app
- **Node.js 24+** (see `package.json` / Volta)
- **Messages.app** must be signed in and configured when sending or using live data
- **Full Disk Access** permission for your terminal/IDE (to read the iMessage database and Address Book)

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/imsg-mcp.git
cd imsg-mcp

# Install dependencies
pnpm install

# Build
pnpm build
```

## Permissions Setup

### 1. Full Disk Access (Required for reading messages)

The iMessage database is stored at `~/Library/Messages/chat.db` and the Contacts database at `~/Library/Application Support/AddressBook/AddressBook-v22.abcddb`. Full Disk Access is required to read both:

1. Open **System Preferences** > **Security & Privacy** > **Privacy** > **Full Disk Access**
2. Click the lock icon to make changes
3. Click **+** and add your terminal app (Terminal, iTerm2, Warp, etc.)
4. Also add any IDEs that will run this server (VS Code, Cursor, etc.)
5. **Restart the application** after granting access

**Note**: The server will work without Contacts access but will show raw phone numbers/emails instead of contact names.

### 2. Automation Permission (Required for sending messages)

When you first send a message, macOS will prompt you to allow automation control of Messages.app. Click **Allow**.

You can also pre-configure this:
1. Open **System Preferences** > **Security & Privacy** > **Privacy** > **Automation**
2. Find your terminal app and ensure **Messages** is checked

## Configuration

### For Claude Desktop

Add to your `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "imessage": {
      "command": "node",
      "args": ["/path/to/imsg-mcp/dist/index.js"]
    }
  }
}
```

### For Warp Terminal

Add to your MCP configuration in Warp settings.

### For Other MCP Clients

Run the server directly:

```bash
node /path/to/imsg-mcp/dist/index.js
```

The server communicates over stdio using the MCP protocol.

## Environment files (quick reference)

Vite-style layering applies when using Vitest and some scripts: **`.env`** → **`.env.local`** → **`.env.[mode]`**. For day-to-day development, **`AGENTS.md`** and **`skills.md`** describe:

- **`.env.test`** — used by **`pnpm test`** (`VITE_ENV=ai`, `env-data/` fixture DBs)
- **`.env.local`** — machine paths (often committed as a template in this repo)
- **`.env.ai`** — optional MCP run against bundled `env-data/` (e.g. Linux / cloud agents)

Large **`*.db` / `*.abcddb`** files under `env-data/` are **Git LFS**. After clone, run **`git lfs pull`** or tests and the server will see “not a database” errors.

## Thread slugs

Each conversation gets a slug such as `alice~imsg~a3f2` (see **`src/thread-slug.ts`**). **`list_conversations`** returns a **`threadSlug`** column. Use **`threadSlug`** with **`send_message`** and **`wait_for_reply`** so the model does not need raw group GUIDs. Mappings persist in **`~/.imsg-mcp/slugs.db`** (`VITE_SLUGS_DB_PATH`). Full rationale: **`AGENTS.md`** (Thread slugs).

**Note:** **`get_messages`** filters by **`chatIdentifier`** (phone, email, or raw id), not by slug.

## Available Tools

### get_messages

Get recent messages, optionally filtered by conversation.

```json
{
  "limit": 20,
  "chatIdentifier": "+1234567890"  // optional
}
```

### get_unread_messages

Get all unread messages across all conversations.

```json
{}
```

### send_message

Send an iMessage or SMS. Use **`recipient`** (phone or email) or **`threadSlug`** (from `list_conversations`—works for **group chats**). One of them is required along with **`message`**.

```json
{
  "recipient": "+1234567890",
  "message": "Hello from AI!"
}
```

```json
{
  "threadSlug": "weekend-crew~imsg~d4e5",
  "message": "Running late!"
}
```

### wait_for_reply

Wait for a reply. Use **`chatIdentifier`** or **`threadSlug`** (same idea as `send_message`).

```json
{
  "chatIdentifier": "+1234567890",
  "timeoutSeconds": 300,
  "pollIntervalSeconds": 10,
  "afterMessageId": 12345
}
```

### list_conversations

List recent conversations with metadata.

```json
{
  "limit": 20
}
```

### search_messages

Search for messages containing specific text.

```json
{
  "query": "meeting tomorrow",
  "limit": 20
}
```

## Use Case: AI Agent Question Escalation

The primary use case for this MCP server is enabling AI coding agents to reach you when they have questions, rather than blocking on user input:

```
AI Agent: "I need to make a decision about the database schema. Let me ask the user via iMessage."

[Uses send_message to text you]
[Uses wait_for_reply with 5 minute timeout]

You (via iMessage): "Use PostgreSQL with the normalized schema"

AI Agent: "Got it! Proceeding with PostgreSQL..."
```

## Troubleshooting

### "better_sqlite3.node was compiled against a different Node.js version" (ERR_DLOPEN_FAILED)

The native module `better-sqlite3` was built for a different Node version than the one running the server. Fix it by rebuilding with the **same** Node you use to run the app:

```bash
# Use the same Node that will run the server (e.g. switch with nvm if needed)
node -p "process.versions.modules"   # note the MODULE_VERSION
pnpm rebuild better-sqlite3
```

If you use multiple Node versions (e.g. nvm, fnm), run `pnpm rebuild` with that Node active. Then run `pnpm debug` or `pnpm start` from the same environment so the same `node` is used.

If your repo uses `pnpm-workspace.yaml`, ensure sqlite native builds are allowed:

```yaml
ignoredBuiltDependencies:
  - esbuild
onlyBuiltDependencies:
  - better-sqlite3
  - sqlite3
```

Then reinstall/rebuild:

```bash
pnpm install
pnpm rebuild sqlite3
```

### "Operation not permitted" error

This means Full Disk Access hasn't been granted. See the Permissions Setup section above.

### "Messages got an error: Can't get buddy"

The recipient address may not be registered with iMessage. Try:
- Using the full phone number with country code (e.g., `+1234567890`)
- Using an email address instead
- The recipient needs to have iMessage enabled

### "Messages is not running"

Ensure Messages.app is open. The server uses AppleScript to control Messages, which requires the app to be running.

### Messages not appearing in database

There can be a slight delay (1-2 seconds) between sending/receiving a message and it appearing in the database. The `wait_for_reply` tool accounts for this with its polling mechanism.

## Technical Details

- **Sending**: Uses AppleScript via `osascript` to control Messages.app
- **Reading**: Queries the SQLite database at `~/Library/Messages/chat.db`
- **Parsing**: Uses the `imessage-parser` library to handle the complex `attributedBody` binary format used in recent macOS versions

## Development

Agent-oriented details (env modes, LFS, scripts, CI): **`AGENTS.md`** and **`skills.md`**.

```bash
# Run in development mode (with auto-rebuild)
pnpm dev

# Tests (loads .env.test → env-data fixtures; AppleScript mocked)
pnpm test

# Tests against paths in .env + .env.local (still mocked under Vitest)
pnpm test:native

# Type check / lint
pnpm typecheck
pnpm lint
```

**Fixture maintenance (macOS only, destructive to `env-data/`):** `pnpm sync-env-data` copies your live `chat.db`, Address Book DBs, and `slugs.db` into `env-data/`. Only run when you intend to refresh bundled data and understand Git LFS implications. See **`AGENTS.md`** → Scripts and fixtures.

**Contact sanity check:** `pnpm exec tsx scripts/compare-contacts-vcf.ts` compares `env-data/contacts.vcf` to the Address Book reader; **`pnpm test`** includes a Vitest check that match rate stays **≥ 80%** on that fixture.

### Debug console (interactive)

Run a **user-friendly REPL** to send messages, fetch messages, list conversations, and call any MCP tool with clear prompts and readable output:

```bash
pnpm build   # build first (server runs from dist/index.js)
pnpm debug   # starts REPL + MCP server
```

On start you’ll see a short **help** with all commands. Example commands:

- `send +15555550100 "Hello"` — send an iMessage/SMS
- `messages` or `messages +15555550100 10` — get recent messages
- `unread` — get all unread messages
- `conversations 20` — list chats with last message snippet
- `search "meeting"` — search message text
- `wait +15555550100 120` — wait for a reply (120s)
- `tools` — list available MCP tools
- `help` — show usage again
- `quit` — exit

Server stderr (e.g. from the MCP server process) is shown with a `[server]` prefix.

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.

## Credits

- Uses [imessage-parser](https://www.npmjs.com/package/imessage-parser) for robust message parsing
- Built with the [Model Context Protocol SDK](https://github.com/anthropics/mcp)
