# imsg-mcp

Companion skill for agents using or developing the `imsg-mcp` iMessage MCP server.

## When to use

- When an agent needs to text the human for clarification or approval.
- When an agent should wait for an iMessage reply before continuing.
- When an agent needs to inspect recent conversations or unread messages.
- When developing/debugging the imsg-mcp codebase itself.

## Quick start

1. Run `imsg doctor` on a new machine to check permissions.
2. Use `list_conversations` to identify the correct thread (returns `threadSlug`).
3. Use `send_message` with `threadSlug` for existing threads, especially groups.
4. Use `wait_for_reply` after sending when the workflow depends on a human answer.

## Local machine requirements

- macOS only for live reads and sends.
- Full Disk Access required to read `~/Library/Messages/chat.db` and Address Book.
- Messages.app must be open to send messages.
- Node >= 24 (see `package.json` / Volta).

## Git LFS (required in cloud / CI / fresh clones)

Large binaries (`*.db`, `*.abcddb`) are stored with Git LFS. A normal clone may leave pointer stubs.

```bash
git lfs install   # once per machine
git lfs pull      # before pnpm install / tests / running against env-data/
```

## Thread slugs

Stable, human-readable IDs for conversations: `{name}~{service}~{4-hex}` (e.g. `alice~imsg~a3f2`).

- `list_conversations` returns `threadSlug` per row
- `send_message` accepts `threadSlug` or `recipient`
- `wait_for_reply` accepts `threadSlug` or `chatIdentifier`
- See `src/thread-slug.ts`, `src/slug-store.ts`

## Binaries

| Binary | Purpose |
|--------|---------|
| `imsg mcp` | MCP stdio server (used by AI hosts like Claude, Cursor) |
| `imsg cli` | Interactive CLI with REPL |
| `imsg tui` | Full-screen TUI (Ink/React) |

## TUI (`imsg`)

Vim-style keybindings: `j/k` move, `gg/G` top/bottom, `Ctrl-d/u` half-page, `{/}` group-jump, `Enter` message details, `o` open attachment, `y` copy slug, `d` toggle dev stats, `Tab` switch panes, `/` filter, `c` compose in current thread, `N` compose to new recipient (phone / email / contact name), `S` send via other app, `:` date jump, `V` visual select, `q` quit.

## Native Rust module (optional)

`native/` contains a Rust acceleration module (`napi-rs` + `rusqlite` + `rayon`). Build with `pnpm native:build`. Falls back to TypeScript automatically if not built. The dev stats panel (`d` key in TUI) shows which engine is active.

## Tool limits

`limit: 0` = unlimited (bounded only by the per-tool timeout). No upper cap.
Defaults: 20 for most tools, 100 for `get_unread_messages`.

## Self-healing watchdog

`src/watchdog.ts` runs three monitors that self-kill (so the host respawns) on:
- Event-loop p99 lag > 10s
- RSS > 1GB or monotonic heap growth across 10 × 60s samples
- Uptime > 24h with no activity in the last hour

All thresholds are env-overridable (`IMSG_EVENT_LOOP_KILL_MS`, `IMSG_MAX_RSS_MB`, etc.).

## MCP cancellation

The server honors `notifications/cancelled`. Long-running handlers (`wait_for_reply`) abort cleanly when the host cancels.

## MCP pagination & export

- `get_messages` returns a footer with `oldestMessageId`. Pass it as `beforeMessageId` to paginate. Hard cap 5000/call.
- `export_messages` streams a chat to a file (markdown/csv/json/ndjson) — use this instead of huge `get_messages` calls.

## TUI date jump + selection + export

- `:` open date-jump (e.g. `1 year ago`, `2024-01-15`).
- `V` enter visual select; `e` export selection; `y` copy text.

## Bounded memory

When loaded messages exceed `IMSG_TUI_MSG_HARD_CAP` (default 5000), middle is evicted; first 200 (anchor) + window around cursor stay. Gap markers show evicted regions.

## TUI lazy loading + cache

- 200 conversations load initially; another 100 lazy-load when within 20 of the end.
- Older messages lazy-load when scrolling within 10 of the top of a thread.
- Per-chat cache holds messages for fast re-entry. Tunable: `IMSG_TUI_CACHE_TTL_MS`, `IMSG_TUI_CACHE_STALE_MS`, `IMSG_TUI_CACHE_MEM_PRESSURE_MB`.

## Debugging & Logs

### MCP tool: `health_check`

Returns vital signs (uptime, heap, RSS, event-loop p99, tool calls, engine) in milliseconds — works even when the DB is wedged.

### MCP tool: `get_logs`

```
get_logs({ tail: 50, source: "all" })
```

- `source: "memory"` — in-process buffer (default)
- `source: "file"` — NDJSON log from `$TMPDIR/imsg-mcp/`
- `source: "all"` — both

### Log files

Full NDJSON logs are written to `$TMPDIR/imsg-mcp/imsg-mcp-{PID}-{date}.ndjson`. These persist across restarts and contain:

- `level: "perf"` + `dur_ms` — performance spans for every DB query
- `level: "info"`, `msg: "heartbeat"` — periodic memory/uptime (every 60s)
- `msg: "startup"` — process start marker (with PID, node version)
- `msg: "shutdown"` — graceful exit marker (with uptime, reason)

**Crash detection:** If a log file has no `"shutdown"` entry, the process crashed or hung.

### Process lifecycle

- `src/shutdown.ts` — central cleanup registry, signal handlers (SIGINT, SIGTERM, SIGHUP, SIGQUIT)
- Orphan detection: parent PID watchdog (detects reparenting to launchd) + stdin EOF detection (MCP host died)
- After TUI crashes, check for orphans: `ps aux | grep imsg`

## Environment variables (Vite / Vitest)

Precedence: `.env` → `.env.local` → `.env.[mode]` → `.env.[mode].local`

| File | Role |
|------|------|
| `.env` | Baseline: `VITE_ENV=development` |
| `.env.local` | Machine paths (`VITE_IMSG_DB_PATH`, etc.) |
| `.env.test` | `VITE_ENV=ai` + `env-data/` paths for `pnpm test` |

- `pnpm test` — Vitest mode `test` (loads `.env.test`)
- `pnpm test:native` — mode `development` (Mac paths from `.env.local`)
- Vitest always mocks AppleScript sends (`VITEST=true`)

## Code map

| Area | Location |
|------|----------|
| MCP tools / Zod | `src/index.ts` |
| SQLite messages | `src/imessage-db.ts` |
| Blob parsing | `src/attributed-body-text.ts`, `src/parsers/typedstream-parser.ts` |
| Contacts | `src/contacts-db.ts` |
| Slugs | `src/thread-slug.ts`, `src/slug-store.ts` |
| Send / mock | `src/applescript.ts`, `src/mock-send-db.ts` |
| TUI | `src/tui/` (Ink/React) |
| Native module | `native/` (Rust + napi-rs) |
| Shutdown | `src/shutdown.ts` |
| Logging | `src/logger.ts` |
| Config | `src/config.ts` |
| Types | `src/types.ts` |
| DB schema | `docs/IMESSAGE_DB_SCHEMA.md` |

## Security / guardrails

- Treat iMessage data as sensitive local user data.
- Never publish private message content.
- Confirm before sending messages on behalf of the user.
- See `AGENTS.md` for thread isolation and MCP guardrails.
