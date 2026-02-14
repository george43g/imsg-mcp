# imsg-mcp

MCP (Model Context Protocol) server for iMessage on macOS. Enables AI agents to send and receive iMessages, perfect for building AI assistants that can communicate with you via text when they need input.

## Features

- **Send iMessages/SMS** - Send messages to any phone number or email address
- **Read Messages** - Get recent messages from all conversations or specific chats
- **Unread Messages** - Retrieve all unread messages across conversations
- **Wait for Reply** - Poll for new messages with configurable timeout (ideal for AI agents waiting for human responses)
- **List Conversations** - View all your conversations with metadata
- **Search Messages** - Search through your message history

## Requirements

- **macOS** (tested on Ventura and later)
- **Node.js 18+**
- **Messages.app** must be signed in and configured
- **Full Disk Access** permission for your terminal/IDE (to read the iMessage database)

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

The iMessage database is stored at `~/Library/Messages/chat.db` and requires Full Disk Access to read:

1. Open **System Preferences** > **Security & Privacy** > **Privacy** > **Full Disk Access**
2. Click the lock icon to make changes
3. Click **+** and add your terminal app (Terminal, iTerm2, Warp, etc.)
4. Also add any IDEs that will run this server (VS Code, Cursor, etc.)
5. **Restart the application** after granting access

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

Send an iMessage or SMS to a recipient.

```json
{
  "recipient": "+1234567890",
  "message": "Hello from AI!"
}
```

### wait_for_reply

Wait for a reply in a specific conversation. Useful for AI agents that need human input.

```json
{
  "chatIdentifier": "+1234567890",
  "timeoutSeconds": 300,
  "pollIntervalSeconds": 10,
  "afterMessageId": 12345  // optional
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

```bash
# Run in development mode (with auto-rebuild)
pnpm dev

# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint
```

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.

## Credits

- Uses [imessage-parser](https://www.npmjs.com/package/imessage-parser) for robust message parsing
- Built with the [Model Context Protocol SDK](https://github.com/anthropics/mcp)
