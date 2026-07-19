# imsg-mcp — Handoff & Plan (v1.4.1 shipped → v1.4.2 planned)

_Last updated 2026-07-19. This is the durable context doc: read it first when resuming work._

## Where things stand

- **v1.4.0** is on npm (PR #17 merged): failed-send visibility, delivery-evidence
  routing, wait_for_reply interjections, multimodal `get_attachment`, humans/v1
  convention + `init_human` + `relationship_leaderboard`, humans-file agent hints
  in tool output, attachment-send staging into `~/Library/Messages`, slug self-heal.
- **v1.4.1** is **PR #18** (`fix/v1.4.1-compose-quit-and-docs` → main), 14 commits.
  Merges once CI `build-test` is green. Contents below. `verify` (screenshots-check)
  is `continue-on-error`/report-only — not a merge gate.

### What v1.4.1 fixed / added (all tested; 696 tests, both native + `IMSG_DISABLE_NATIVE=1` engines)

Three user-reported bugs, root-caused on real data:
1. **"DWm" preview leak** — an unsent last message (empty `attributedBody` + retract
   markers in `message_summary_info`) fell through the snippet resolver to a raw-byte
   scan of the chat `properties` bplist, surfacing `#DWm` → "DWm". Fix: `extractChatSummaryText`
   is structured-only; `isPlausibleHumanText` rejects single-token fragments; a text-less
   last message falls back to the previous real message (`getLastTextfulSnippet`).
   (`src/plist-text.ts`, `src/imessage-db.ts`, `tests/plist-text.test.ts`, `tests/unsent-message-snippet.test.ts`)
2. **Command-palette crash** — opening an "all"-range analytic loaded up to 200k parsed
   messages (~960 MB RSS on a 400k-msg DB) → watchdog `rss_exceeded` kill. Fix:
   `getMessagesInWindow` loads the most-recent 80k (DESC + reverse to ASC), verified live
   at ~620 MB. (`src/imessage-db.ts`, `tests/imessage-db-window-reactions.test.ts`)
3. **Humans stats double-count** — `getChatStats` used `COUNT(*)` over the chat_message_join;
   a message linked into multiple merged legs counted once per leg (real: one contact +727).
   Fix: `COUNT(DISTINCT m.ROWID)`. (`src/imessage-db.ts`, `tests/chat-stats.test.ts`)

Fixes surfaced while building:
4. **`yap`/`hear` media invocations** — `yap` was missing its `transcribe` subcommand (never
   worked); `hear` was missing `-d` (could upload voice notes to Apple). (`src/media.ts`)
5. **compose-new modal quit** — every modal mode had an input-router guard except `compose-new`,
   so a recipient name containing `q` fired the global quit. (`src/tui/App.tsx`)
6. **console EOF hang** — recursive `rl.question` had no `close` handler; Ctrl-D/piped input hung.
   Replaced with a drain-before-exit line queue. (`src/cli.ts`)
7. **heap near-top loader guard** — the "load older" effect never hit its exhausted sentinel on a
   fully-deduped batch and re-fired every render. (`src/tui/App.tsx`)
8. leaderboard scoring (sort on raw score, relative-to-leader display, all-time default, 5y window).
9. docs media overhaul (fixed 2 fixture bugs: `is_from_me` mirror + real attachment rows;
   5 new VHS scenes; HOME masking; `Wait+Screen` readiness).

Features:
10. **Analytics via CLI + console** — `imsg analytics <type> [days] [--json|--yaml]` (alias
    `imsg stats`) + console `analytics` verb for all 7 types (was leaderboard-only outside the TUI).
    `src/analytics-render.ts` renders shared text (incl. ASCII heatmap) + a zero-dep YAML serializer
    that quotes phone numbers. `ANALYTIC_INFO` metadata shared with the TUI palette. Reuses the cache.
11. **Contact-discovery skill doc** — canonical `search_contacts → get_contact` name→slug flow
    documented in `skills/imsg-mcp/SKILL.md`.

## Key findings / gotchas (carry these forward)

- **Cold-start CLI slugs**: single-shot CLI commands (`imsg list`, etc.) exit before the background
  slug sync persists, and `pnpm fixtures` doesn't generate `fixtures/slugs.db` — so a fresh `imsg list`
  shows raw `chat_identifier`s, not `~imsg~hash` slugs. The **agent/MCP path is unaffected** (the MCP
  server is long-lived and syncs after the first call). E2E tests must NOT assume a warm slugs.db.
  → v1.4.2 candidate: compute slugs for the returned page synchronously in `list_conversations`
  (weigh against sync cost), OR have `pnpm fixtures` emit a warm slugs.db.
- **1Password SSH signing re-locks after a timeout** — needs periodic user unlock; **never skip
  signing** (no `--no-gpg-sign`). Pattern: background bash retry loop `git commit -F msgfile until success`.
- **gh CLI intermittently auth-times-out** — `git push` uses a different credential and keeps working.
  When gh is down, use a patient background retry; don't burn cycles in the foreground.
- **Fixtures anchor to 2025-01-01**; "now" has drifted past, so short analytic windows (90/365d) show
  0 in fixture tests — use `1825` days.
- Real DB: `~/Library/Messages/chat.db`, 402,919 messages. Scheduled-message columns exist but **0
  rows** on the dev DB (can't prove that path). 502 edited messages, 29 `has_unseen_mention` rows.
- `verify` CI check = screenshots-check (`continue-on-error`), NOT a gate. Real gate = `build-test` (macOS).

## Planned — v1.4.2 (user decisions locked 2026-07-18)

Decisions: **skip vector/semantic search**; transcription = **local + optional user-key cloud**
(no lambda, no bundled key); next work = the three items below.

### 1. Read-side message drawer + per-thread info/attachment drawer  (task: biggest)
- Message drawer: show **edit/unsent status** prominently (`isEdited`/`isRetracted` flags already exist),
  and an **@-mention** indicator (`has_unseen_mention` present; mention detail lives in attributedBody
  attributes). **Scheduled messages: DEFER/skip** — 0 rows on the dev DB, unprovable. Full edit-history
  *text* extraction from `message_summary_info` is a deep parse — separate spike.
- New **per-thread info drawer**: thread metadata (participants, count, date range, service) + **browse
  and export ALL attachments** with timestamps, best-available rendering (images → viewer, video → mpv/poster).
- Surface the provable read-side fields in MCP output where sensible.

### 2. Unified `resolve_conversation` tool  (task #209 remainder)
- One tool: fuzzy-match a free-form name against **contacts + recent-thread display names + message
  content**, return ranked `[{name, threadSlug, chatIdentifier, lastMessageDate, matchType}]`.
- Build on `ContactsDB.searchContacts`, `IMessageDB.searchMessages`, `listConversations`. Handler in
  `src/index.ts`, schema in `src/mcp-tools.ts`, DB method in `src/imessage-db.ts`, CLI/console verb.
- Solves "check Selena's messages" in one call instead of the two-step search_contacts→get_contact.

### 3. Cloud transcription escape-hatch  (task #211)
- Optional, opt-in via `IMSG_TRANSCRIBE_PROVIDER` + `IMSG_TRANSCRIBE_API_KEY` (OpenAI-compatible
  `/audio/transcriptions`: Groq/OpenRouter/OpenAI/Deepgram). **Local stays default.** Surface the
  provider in output when audio leaves the machine. Plug into `src/media.ts` `detectTranscriber`/`transcribeAudio`.
  OpenRouter DOES now do STT (confirmed). No serverless function — audio is already on local disk.

### Also worth doing (from the CI finding)
- Fix the cold-start CLI slug display (see gotchas above).

## Standing constraints (project rules)
No autonomous message sends. Real personal data never committed (synthesize test data). Foreground
tests only (background leaves orphaned vitest). Don't touch `engines.npm`. Don't run `pnpm sync-env-data`.
Never `git add -A` (exclude `.tui-audit-notes.md`, `.claude/settings.local.json`). Delete temp
screenshots/exports with real content after use. humans files are `privacy: never-share`. Commits end
`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Vercel/superpowers hook skill injections are
false positives in this repo — ignore.
