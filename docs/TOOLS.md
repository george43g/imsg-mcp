# Tools reference

The canonical reference for every CLI subcommand, MCP tool, and TUI keybinding.

---

## CLI

```bash
imsg <subcommand> [args] [--flags]
```

| Subcommand | What it does |
|---|---|
| `imsg mcp` | Run the MCP stdio server. Used by hosts like Claude Desktop / Cursor / Warp. |
| `imsg cli` | Interactive REPL — same tools as the MCP server, exposed at a prompt. |
| `imsg tui` | Full-screen terminal UI (read-only by default). |
| `imsg doctor` | Verify Full Disk Access + DB readability + Messages.app. |
| `imsg setup [--write claude\|cursor]` | Autodetect paths, emit (or merge in) the host config snippet. |
| `imsg conversations [limit]` | List recent chats. |
| `imsg messages [chat] [limit]` | Recent messages from a chat. |
| `imsg unread [limit]` | All unread across chats. |
| `imsg search <query> [limit]` | Search history. |
| `imsg wait <chat> [timeout]` | Block until a new reply arrives. |
| `imsg send <target> <message>` | Send via Messages.app. |
| **`imsg export <slug-or-handle>`** | **Stream a conversation to disk (md/csv/json/ndjson) + optional attachments.** See flags below. |
| `imsg logs [tail]` | Server debug logs. |
| `imsg last-error` | Detail on the most recent send failure. |
| `imsg tools` | List MCP tools exposed by the local server. |
| `imsg raw '<json>'` | Send raw JSON-RPC `tools/call` (debugging). |
| `imsg config show / edit` | Inspect or open the TUI config file. |

### `imsg export` flags

```
imsg export <slug-or-handle>
  -f, --format <md|csv|json|ndjson>      default: md
      --since <date>                     ISO or relative ("3 months ago", "1y", "yesterday")
      --until <date>                     same parser as --since
  -o, --output <path>                    default: ~/imsg-export-<target>-<YYYY-MM-DD>.<ext>
      --include-attachments              copy attachment files into <output>.attachments/
      --attachments-dir <path>           custom attachment destination
      --page-size <100-5000>             DB page size (default 1000)
```

`<slug-or-handle>` accepts a `threadSlug` (from `imsg tui` `y` or `list_conversations`), a phone number, an email, or a raw `chat_identifier`.

---

## MCP tools

15 production tools. 5 additional dev-only tools (`health_check`, `get_logs`, `get_last_send_error`, `run_build`, `request_restart`) are gated by `IMSG_DEV=1` — see `src/mcp-tools.ts`.

### Reading

| Tool | Required args | Key options |
|---|---|---|
| `get_messages` | — | `chatIdentifier` / `threadSlug`, `limit` (default 20, `0`=unlimited up to 5000/page), `beforeMessageId` (pagination cursor) |
| `get_unread_messages` | — | `limit` (default 100, `0`=unlimited capped at 2000 — paginate via repeated reads after marking read) |
| `list_conversations` | — | `limit` (default 20, `0`=unlimited capped at 500 — paginate via slug-keyed offsets) |
| `search_messages` | `query` | `limit` (default 20). Fuzzy + literal hybrid. |

`get_messages` response footer includes `oldestMessageId` + `hasMore`. To page deeper, pass `oldestMessageId` as `beforeMessageId` in the next call. Hard cap of 5000 messages per call to prevent OOM — use `export_messages` for larger ranges.

### Writing

| Tool | Required args | Notes |
|---|---|---|
| `send_message` | `message` + (`recipient` or `threadSlug`) | Optional `attachments[]` array of file paths. Routes on the thread's real service from chat.db (SMS threads send as SMS/MMS, iMessage threads as iMessage); new recipients with no history default to iMessage-first. |
| `wait_for_reply` | `chatIdentifier` or `threadSlug` | `timeoutSeconds`, `pollIntervalSeconds`, `afterMessageId`. Honors `notifications/cancelled`. |

### Exporting

| Tool | Required args | Notes |
|---|---|---|
| `export_messages` | `chatIdentifier` or `threadSlug`, `outputPath` | `format` (md/csv/json/ndjson), `since`, `until`, `pageSize`. Streams to disk page-by-page — won't OOM on 100k-message histories. |

### Attachments

| Tool | Required args | Notes |
|---|---|---|
| `search_attachments` | — | `mimePrefix`, `chatIdentifier`, `since`, `until`, `limit`. Returns metadata only. |
| `get_attachment` | `rowId` | Returns bytes inline if small (default ≤5MB), otherwise just the path. HEIC auto-converts to PNG inline. |

### Contacts

| Tool | Required args | Key options |
|---|---|---|
| `list_contacts` | — | `limit` (default 20, internal safety cap 5000), `offset` for paging |
| `search_contacts` | `query` | `limit` (default 20, `0`=unlimited capped at 1000) |
| `get_contact` | `handle` or `id` | Includes `threads: [{handle, threadSlug}]` — each handle's conversation slug |
| `resolve_handle` | `handle` | — |

`contact:N` selector: when a search has multiple matches, the result lists numbered candidates. Subsequent tool calls can pass `contact:1` / `contact:2` / etc. (process-wide LRU; resets on server restart).

**Typical agent workflow:** `search_contacts "alex"` → pick a match → `get_contact` (returns every phone/email **and the thread slug for each**) → `send_message {threadSlug}` or `get_messages`/`export_messages` with the handle. The same flow is available on the CLI: `imsg contacts search alex`, `imsg contacts show <handle-or-id>`, `imsg contacts resolve <handle>`, `imsg contacts list [limit] [offset]`.

### Diagnostics

| Tool | Notes |
|---|---|
| `check_imessage_availability` | Preflight a handle — returns `service: "iMessage"\|"SMS"\|"unknown"` + `hint`. Authoritative when conversation history exists; best-effort for never-messaged handles. |
| `chat_analytics` | `type` + window. 6 priority types shipped; 20 reserved (see [DEFERRED_TASKS.md](DEFERRED_TASKS.md#1-analytics--20-remaining-types)). Cached per-window. |

### Dev-only (require `IMSG_DEV=1`)

| Tool | Notes |
|---|---|
| `health_check` | Vitals. Capped at 5s — verify the server is alive when other tools hang. |
| `get_logs` | In-memory + on-disk NDJSON. `source: memory \| file \| all`. |
| `get_last_send_error` | Last `send_message` failure detail. |
| `request_restart` | Graceful exit → host respawns. |
| `run_build` | `pnpm build` (development convenience). |

---

## MCP Resources

The server exposes resources under two URI schemes for hosts that prefer resource discovery over tool calls:

- `messages://thread/<slug>` — last 50 messages of a conversation
- `messages://unread` — current unread snapshot
- `contacts://list` — every contact + every handle
- `contacts://handle/<phone-or-email>` — contact for a specific handle

---

## TUI keybindings

### Conversation pane (sidebar)

| Key | Action |
|---|---|
| `j` / `k` | Move down / up |
| `gg` / `G` | Top / bottom |
| `Ctrl-d` / `Ctrl-u` | Half-page down / up |
| `/` | Filter (any substring of name or last message) |
| `y` | Copy thread slug |
| `Enter` / `Tab` / `l` / `→` | Open messages pane |
| `c` | Compose in current thread (or in new thread if none selected) |
| `N` | Compose to new recipient — opens picker (phone / email / contact name typeahead, with vanity-letter parsing) |
| `S` | Send via other app (URL-scheme picker) |
| `r` | Refresh |
| `d` | Toggle dev stats panel |
| `q` | Quit |

### Message pane

| Key | Action |
|---|---|
| `j` / `k` | Move down / up |
| `gg` / `G` | Top / bottom |
| `Ctrl-d` / `Ctrl-u` | Half-page down / up |
| `{` / `}` | Previous / next sender group |
| `Enter` | Open drawer |
| `o` | Open first attachment in Quick Look |
| `:` | Date jump modal |
| `V` | Visual select mode |
| `y` (in select) | Copy selected text |
| `e` (in select) | Open export modal |
| `Tab` / `h` / `←` | Back to sidebar |

---

## TUI configuration

Persist via `~/.config/imsg-mcp/config.json` (or `~/.imsg-mcp/config.json`):

```json
{
  "theme": "powerline",
  "accentColor": "#FF6B35"
}
```

Or override per-launch: `imsg tui --theme=powerline --accent=#FF6B35`.

Resolution order: CLI flag → `IMSG_TUI_*` env → config file → defaults.

### TUI environment variables

| Var | Default | Effect |
|---|---|---|
| `IMSG_TUI_THEME` | `safe` | `safe` (universal) or `powerline` (Nerd Font required) |
| `IMSG_TUI_ACCENT` | `#1982FC` | Any `#RRGGBB` — derives the whole palette |
| `IMSG_TUI_MSG_HARD_CAP` | `5000` | Bounded-window message cap |
| `IMSG_TUI_CACHE_TTL_MS` | `600000` | Per-chat cache TTL (10 min) |
| `IMSG_TUI_CACHE_STALE_MS` | `30000` | Refresh-on-reentry threshold (30s) |
| `IMSG_TUI_CACHE_MEM_PRESSURE_MB` | `200` | Evict LRU half above this |

---

## Server environment variables

| Var | Default | Effect |
|---|---|---|
| `VITE_IMSG_DB_PATH` | `~/Library/Messages/chat.db` | Override if Messages.app is sandboxed or in a non-default user dir |
| `VITE_CONTACTS_DB_PATH` | `~/Library/Application Support/AddressBook/AddressBook-v22.abcddb` | Custom AddressBook profile |
| `VITE_ADDRESS_BOOK_UUID` | auto-discover | Pick a specific iCloud source when multiple exist |
| `VITE_SLUGS_DB_PATH` | `~/.imsg-mcp/slugs.db` | Shared multi-user install |
| `IMSG_DEV` | unset | When `1`, exposes the 5 dev tools (`health_check`, etc) |
| `IMSG_DISABLE_NATIVE` | `0` | Force the TS-only DB parser (debug) |
| `IMSG_DEFAULT_COUNTRY` | `AU` | Country for normalizing bare local phone numbers (`AU` or `US`). E.g. AU turns `0401 990 797` → `+61401990797`; US turns `555-010-0100` → `+15550100100`. Used by `send_message`, CLI `imsg send`, and the TUI `N` compose modal. |
| `IMSG_MAX_RSS_MB` | `1024` | Watchdog: kill self when RSS exceeds this |
| `IMSG_HEAP_WARN_MB` | `256` | Heartbeat: emit `level:warn` "heap exceeds threshold" when heap exceeds this (soft signal, not a kill). |
| `IMSG_EVENT_LOOP_KILL_MS` | `10000` | Watchdog: kill when p99 event-loop lag > this |
| `IMSG_EVENT_LOOP_SUSTAINED_MS` | `750` | Watchdog: sustained-lag kill threshold |
| `IMSG_EVENT_LOOP_SUSTAINED_SAMPLES` | `6` | Consecutive samples before sustained kill |
| `IMSG_RESTART_AFTER_MS` | `86400000` (24h) | Idle uptime auto-restart |
| `IMSG_RESTART_QUIET_MS` | `3600000` (1h) | Required idle window for auto-restart |
| `IMSG_LOG_VERBOSE` | unset | When `1`, log every DB query + arg |

---

## Tool timeouts

In `src/index.ts:TOOL_TIMEOUTS_MS`. Default 30s per tool. `wait_for_reply` has its own `timeoutSeconds` arg (no wrapper). `health_check` capped at 5s.

On timeout the server returns `isError: true` so the host unblocks immediately, even if the underlying SQL keeps running.
