# imsg-mcp

Optional companion skill for agents using the `imsg-mcp` server.

## When to use

- When an agent needs to text the human for clarification or approval.
- When an agent should wait for an iMessage reply before continuing.
- When an agent needs to inspect recent conversations or unread messages.

## Usage notes

- Prefer `list_conversations` first and use the returned `threadSlug` for follow-up actions.
- Use `send_message` with `threadSlug` for existing threads, especially groups.
- Use `wait_for_reply` after sending when the workflow depends on a human answer.
- Treat the iMessage database as sensitive local user data.

## Local machine requirements

- macOS only for live reads and sends.
- Full Disk Access is required to read `~/Library/Messages/chat.db` and Address Book data.
- Messages.app must be open to send messages.

## Recommended workflow

1. Run `imsg-cli doctor` on a new machine.
2. Use `list_conversations` to identify the correct thread.
3. Use `send_message` only when the user explicitly wants outbound texting.
4. Use `wait_for_reply` with a bounded timeout.
