# Deferred Tasks — Post-v1.0.0 Backlog

Items the v1.0.0 publish target intentionally defers. Each row tracks where the decision was made, the rough scope, and the priority for v1.1.x. Cross-reference: the original sweep plan lives at `/Users/george/.claude/plans/glowing-percolating-key.md`.

---

## 1. Analytics — 20 remaining types

`chat_analytics` ships with 6 priority types in v1.0.0. The Zod enum + tool description reserve names for 20 more, but they currently return a schema-level validation error if requested.

Origin: P2.5 of the Phase 2 plan; user opted to ship the 6 representative types and defer the rest.

| Type | Sketch |
|---|---|
| `silences` | Gaps > 24h between messages, per contact |
| `ghost_storms` | Sudden burst followed by long silence (engagement-collapse detector) |
| `conversation_half_life` | Time from peak daily volume to half-volume, per chat |
| `sent_received_imbalance` | Per-contact sent/received ratio + asymmetry score |
| `tapback_per_person` | Who reacts the most/least; bucket by tapback type |
| `read_receipt_latency` | Per-chat avg time between delivered + read |
| `most_used_words` | Per-contact word frequency, stop-word filtered |
| `emoji_leaderboard` | Top emojis used/received, per contact |
| `attachment_volume` | Count + bytes per contact, broken out by MIME family |
| `media_share_breakdown` | image/video/audio/document split, per contact |
| `group_chat_activity` | Top groups by message count + most active contributor per group |
| `chat_age_distribution` | Histogram of first-message-date per chat |
| `first_messages_log` | First-ever message per contact (icebreaker archive) |
| `last_messages_log` | Last contact per chat (ghosted thread detector) |
| `quietest_chats` | Chats with the fewest messages in the window |
| `loudest_chats` | Chats with the most messages in the window |
| `weekend_vs_weekday` | Weekend vs weekday volume ratio, per contact + global |
| `night_owl_score` | % of msgs sent 11pm–5am, per contact |
| `most_edited_messages` | Top N messages by edit count |
| `retraction_rate` | Per contact, ratio of retracted-to-sent |

**Implementation pattern**: each is a pure function in `src/analytics.ts` of shape `(messages: Message[]) => SomeResult`. Add to the `dispatchAnalytic` switch + extend the Zod enum in `mcp-tools.ts`. The cache layer (`src/analytics-cache.ts`) is type-agnostic.

**Priority**: P2 — agents will discover these via `tools/list` discovery and request them, so each adds visible value. Aim for 5-per-PR cadence post-publish.

---

## 2. tsconfig strict flags

Two flags were probed during P1.8 but deferred because they surface many existing-call-site errors:

| Flag | Errors surfaced |
|---|---|
| `noUncheckedIndexedAccess` | 77 |
| `exactOptionalPropertyTypes` | 18 |

`noImplicitOverride` + `verbatimModuleSyntax` were already enabled (0 errors each).

**Implementation**: enable one at a time; fix call sites with `?.` / explicit guards rather than `// @ts-expect-error`. Likely a 1-day spike for `exactOptionalPropertyTypes` and 2-day for `noUncheckedIndexedAccess`.

**Priority**: P2 — purely internal, no user impact. Schedule alongside a quiet release.

---

## 3. Stress harness + CI

From the `mcp-cli-starter-template` retrofit list (Phase 1 P1/P2 items that didn't make v1.0.0):

| Item | Scope |
|---|---|
| `scripts/stress-mcp.ts` JSON report | 9-case stress harness covering handshake, parallel calls, malformed args, force-timeout, SIGTERM, RSS watchdog trip. Emit a JSON report artifact for CI to upload + diff. |
| Matrix CI (ubuntu + macos) | Currently only `release.yml`. Run lint/typecheck/test on PRs across both platforms with `concurrency: cancel-in-progress`. |
| `npm pack --dry-run` step | Guard publishable tarball size + contents before release. |
| README-drift workflow | Fail PR if `README.md` is out of sync; `[skip-readme]` bypass tag. |
| Screenshots auto-commit workflow | When a `.tape` changes, regenerate and commit the PNG with `[skip ci]`. |

**Priority**: P1 for the stress harness (genuine reliability win); P2 for the rest.

---

## 4. Account diagnostics via AppleScript

From the SDEF survey (`docs/applescript-examples.md` covers patterns but doesn't wire them):

- `listAccounts()` — surface `connection_status`, `service_type`, `enabled` per account in `health_check`. Lets the agent say "your iMessage account is disconnected; sends will fall back to SMS" instead of failing mid-send.
- File-transfer tracking — `listFileTransfers()` wrapper for the SDEF `file transfer` class. Useful as a TUI progress widget.

**Priority**: P2 — the snippets in `docs/applescript-examples.md` are compile-checked but not invoked. Wiring is straight Node wrappers over `runAppleScript()`.

---

## 5. Semantic / vector search

The `willccbb/imessage-mcp` survey shows it's the only competing repo attempting vector search (ChromaDB embeddings). Currently we only do literal LIKE + fuzzy WRatio (`src/fuzzy.ts`).

**Implementation options**: local sentence-transformers via `@xenova/transformers` (no external service) OR a local vector DB binding. Either way it's an opt-in feature behind a `--vector-search` flag because indexing all of chat.db is slow.

**Priority**: P3 — fuzzy search covers most realistic queries. Vector wins only when the user describes a topic abstractly ("the conversation about that bike ride last summer").

---

## 6. Streamable HTTP transport

Currently MCP is stdio-only. The starter template defines a Streamable-HTTP transport pattern with constant-time bearer auth, 127.0.0.1 bind, `MAX_BODY_BYTES`, and an open `/health` endpoint.

**Use case**: remote inspection / web-based dashboards / IDE integrations that can't spawn a child process.

**Priority**: P3 — stdio covers the documented MCP host install paths (Claude Desktop, Cursor, Warp). Revisit if there's a specific request.

---

## 7. Shell completions via `usage` (jdx)

The starter template uses [`usage` by jdx](https://usage.jdx.dev/) — a `.usage.kdl` spec drives bash/zsh/fish completions + a manpage + per-subcommand markdown. CI drift check ensures the spec stays in sync with the actual CLI.

Currently we rely on commander's auto-generated `--help` text and have no shell completions.

**Priority**: P3 — nice-to-have; commander's `imsg --help` and `imsg <subcommand> --help` cover the discovery path.

---

## 8. `contact:N` selector — cross-session persistence

P2.7 ships a process-wide LRU. Each restart of the MCP server resets it. For long-running agent sessions that span server restarts (via `request_restart` or external host restart), the user re-types the original search.

**Implementation**: persist the LRU to `~/.imsg-mcp/contact-resolver.db` (SQLite, one row per remembered match-set, TTL 1 day). Add a `forgetContactSelector()` for explicit clear.

**Priority**: P3 — ambiguity itself is rare; restart-across-ambiguity is rarer.

---

## 9. Wrap message bodies in `structuredContent` too

`docs/GUARDRAILS_MCP_RESPONSES.md` notes that `wrapUntrusted` is currently applied only to the human-readable `content[0].text` field, not to `structuredContent.messages[i].text`. Hosts that pipe `structuredContent` directly into a prompt are still exposed.

**Implementation**: thread `wrapUntrusted` through `messageToStructured` behind an opt-in flag (so non-LLM consumers can still get raw text).

**Priority**: P2 — the human-readable wrap covers the dominant LLM-consumption path, but the structured field is a known gap.

---

## 10. README + skills sync sweep

Items the README doesn't yet document:

- `chat_analytics` tool + 6 analytic types
- `search_attachments` / `get_attachment`
- `check_imessage_availability` preflight tool
- `attachments[]` argument on `send_message`
- `O` / `S` TUI keybinds
- MCPB Desktop install button + `pnpm pack:mcpb`
- MCP Resources (`messages://`, `contacts://`)
- `IMSG_LOG_VERBOSE` env var

Also `skills/imsg-mcp/SKILL.md` should be re-checked against the current tool surface (15 prod tools, 5 dev tools).

**Priority**: P1 before the v1.0.0 announcement post.

---

## Quick reference

- **Plan file**: `/Users/george/.claude/plans/glowing-percolating-key.md`
- **Screenshots**: `pnpm screenshots` (regenerates every `.tape` in `scripts/screenshots/` via vhs → `docs/screenshots/*.png`. Requires `brew install --cask font-jetbrains-mono`.)
- **MCPB bundle**: `pnpm pack:mcpb` (outputs `release/imsg-mcp.mcpb`)
- **Verify**: `pnpm verify` (lint + typecheck + test + build)
- **CLI help**: `imsg --help`, `imsg <subcommand> --help` (commander built-in; no manual wiring needed)
- **Console help on launch**: now printed automatically when `imsg cli` starts.
