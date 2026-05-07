# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in `imsg-mcp`, please **do not open a
public GitHub issue**. Instead, report it privately:

- Open a [private security advisory](https://github.com/george43g/imsg-mcp/security/advisories/new) on GitHub, OR
- Email the maintainer (see commit log for current address)

Include enough detail that we can reproduce the issue: affected version,
steps, and any proof-of-concept code. We'll acknowledge receipt within
72 hours and aim to release a fix promptly.

## Scope

This MCP reads your local macOS Messages database and (when invoked) sends
messages via AppleScript. The relevant security considerations:

- **Local data only.** Nothing is uploaded anywhere. The MCP runs entirely on
  your machine via stdio.
- **macOS permissions.** Full Disk Access (read) and Automation → Messages
  (send) are required by the OS. The MCP cannot bypass these.
- **MCP host trust.** Whatever LLM/host you connect this server to will see
  the contents of your messages. Treat the host the same way you treat any
  app with Full Disk Access.

## Known Non-Issues

- Reading `chat.db` while Messages.app is open is safe (WAL mode, read-only
  connection).
- The bundled `fixtures/` are synthetic — no real PII.

## Disclosure

After a fix lands, we'll publish the advisory and credit the reporter unless
they prefer otherwise.
