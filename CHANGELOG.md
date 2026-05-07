# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — Initial Public Release

### Added

- **MCP stdio server** (`imsg-mcp`) with tools:
  - `get_messages` (with `beforeMessageId` cursor pagination)
  - `list_conversations`, `search_messages`, `get_unread_messages`
  - `send_message` (real send via AppleScript)
  - `wait_for_reply` (polling with cancellation support)
  - `export_messages` (streaming export to file: markdown / csv / json / ndjson)
  - `health_check` (uptime, heap, RSS, event-loop lag, tool counts)
  - `get_logs`, `get_last_send_error`, `request_restart`, `run_build`
- **Interactive CLI** (`imsg-cli`) with REPL.
- **Full-screen TUI** (`imsg`) with vim-style navigation:
  - Compact one-line message rows, sender-grouped backgrounds
  - Vim keys: `j/k`, `gg/G`, `Ctrl-d/u`, `{/}`, `:` date-jump, `V` visual
    select, `e` export, `y` copy, `o` open attachment, `d` dev stats
  - Lazy-load older messages on scroll
  - Bounded message memory window with gap markers for very deep history
  - Per-chat cache with TTL + LRU + memory-pressure eviction
  - Date-jump modal accepting ISO, US, "yesterday", "1 year ago", `5d`/`2w` etc.
- **Rust native module** (`napi-rs` + `rusqlite` + `rayon`) for accelerated
  attributedBody blob parsing — falls back to TS automatically when not built.
- **Self-healing watchdog**:
  - Event-loop lag detection (warn/kill thresholds)
  - Memory leak detection (RSS cap + monotonic heap growth)
  - Idle/uptime restart (configurable via env vars)
  - Stdin EOF detection + parent PID watchdog for orphan prevention
  - Per-tool timeouts with isError responses
- **MCP cancellation protocol** support (`notifications/cancelled`).
- **Synthetic test fixtures** generated on `pnpm install` — no LFS, no real PII.

### Performance

- listConversations(200) — ~500ms cold, ~5ms cached
- getMessagesForChat(200) — ~80ms cold, ~16ms cached
- 19,000-message export — 2.1s, 9MB NDJSON, peak heap 82MB

### Notes

- macOS only (live data path); native module produces darwin-arm64 / darwin-x64
  binaries
- Requires Node.js 24+
- 171 TS tests + 12 Rust tests
