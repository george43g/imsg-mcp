# imsg-mcp — Status & Backlog

_Single source of truth for where the project stands and what's still open. Read this
first when resuming work. Supersedes the retired `HANDOFF_v1.4.x.md`, `DEFERRED_TASKS.md`,
and the untracked `.tui-audit-notes.md` scratch files (folded in here, shipped items dropped)._

_Last updated 2026-07-21 · current release **v1.8.0** (npm)._

---

## Where things stand

`imsg-mcp` is feature-complete for its v1 goal: an MCP server + CLI + TUI that lets an agent
read, search, send, analyse, and export iMessage/SMS entirely on-device, behind a self-healing
watchdog. The **finalise cycle (v1.6.0 → v1.8.0)** closed every remaining v1.4.2-plan feature.
The **monorepo/turborepo migration is deliberately deferred** — it is a corpus-consumer concern
for the future relationship-analytics app, captured in full in
[`MONOREPO_MIGRATION.md`](MONOREPO_MIGRATION.md).

### Shipped in the finalise cycle (v1.6.0 → v1.8.0)

| Feature | Release | Notes |
|---|---|---|
| **Unsent-message detection** | v1.6.0 | `date_retracted` is 0 across the DB on current macOS; content-absence heuristic (`isUnsentMessage`) fixes inverted `isEdited`/`isRetracted`. Renders "⊘ unsent" in TUI/drawer + `[UNSENT …]` in MCP. |
| **`resolve_conversation`** | v1.6.0 | Free-form name → ranked threads in ONE call (fuses contacts + thread names + message content). MCP tool + `imsg resolve` CLI + console verb. |
| **Cold-start CLI slugs** | v1.6.2 | Single-shot CLI (`imsg list`, etc.) now shows `name~service~hash` slugs, not raw phone/email ids. Slugs are computed + persisted **synchronously** for the returned page in `list_conversations`/`findChatByHandle` (was: background sync didn't persist before the process exited). Agent/MCP path was always unaffected. |
| **Cloud-transcription escape-hatch** | v1.7.0 | `get_attachment` audio: opt-in OpenAI-compatible cloud fallback via `IMSG_TRANSCRIBE_PROVIDER` + `IMSG_TRANSCRIBE_API_KEY` (+ optional `IMSG_TRANSCRIBE_MODEL`, default `whisper-1`). Local transcribers (`hear`/`yap`/`whisper-cli`) always win; cloud runs only when configured **and** local produced nothing. Audio leaves the device only on explicit opt-in; result surfaces `transcriptSource: "local"｜"cloud"`. |
| **Per-thread info / attachment drawer** | v1.8.0 | TUI **`i`** opens a side-column drawer: thread metadata (name, slug, service, group/direct, participant count, message count, first→last range) + a browsable list of **all** attachments across the merged legs (stickers/plugin UTIs excluded). Drawer keys: `j/k` select · `o` open (Quick Look / mpv) · `s` save to `~/Downloads` · `y` copy path · `a` export all to `~/Downloads/imsg-<slug>/` · `Esc/q` close. |
| **Analytics on CLI + console** | v1.4.1 | All 7 analytic types via `imsg analytics <type> [days] [--json\|--yaml]` (alias `imsg stats`) + console `analytics` verb (was leaderboard-only outside the TUI). Shared renderer with ASCII heatmap + phone-safe YAML. |
| **Core-seam cleanup** | v1.8.0 prep | Moved the only two core→frontend edges into core: `src/export-formats.ts` (was `tui/exportFormats.ts`, used by `exportStream.ts`) and `src/date-parse.ts` (was `tui/dateParse.ts`, used by `index.ts`). Future-proofs the deferred migration. |

**Analytics:** 7 of 27 enum types are implemented (`IMPLEMENTED_TYPES` in `src/analytics.ts`);
the other 20 return a friendly schema error until built (see Backlog §1).

---

## Carry-forward gotchas / ops notes

Durable facts that repeatedly bite — keep these in mind before touching the relevant area.

- **1Password SSH signing re-locks after a timeout.** Needs a periodic user unlock; **never skip
  signing** (no `--no-gpg-sign`). Pattern when it's locked mid-flow: save the commit message to a
  scratch file and background-retry `git commit -F msgfile` until it succeeds.
- **`gh` CLI intermittently auth-times-out** on the macOS keychain (`gh pr create`/`checks`/`merge`).
  `git push` uses a different credential and keeps working. Fallbacks that need neither the keychain
  nor local signing: read CI via the **public** REST API (`commits/{sha}/check-runs`, unauthenticated
  works for public repos); merge server-side via `PUT /repos/{owner}/{repo}/pulls/{n}/merge` with
  `$GH_TOKEN` + curl. It usually recovers — a patient background retry beats foreground spinning.
- **Release serialization.** semantic-release triggers on push to `main`; `concurrency` serializes
  runs but checkout uses the triggering SHA — so **back-to-back merges risk a non-ff push failure**.
  Merge one PR, wait for its release run to complete, then merge the next. Merge (**not** squash) so
  commit types drive versioning (`fix`=patch, `feat`=minor, `chore`/`refactor`=no bump).
- **CI gates.** `build-test` (macOS) is the real merge gate. `verify` / `screenshots-check` are
  `continue-on-error` / report-only — **not** gates.
- **Global `imsg` is a live symlink.** `pnpm add -g "$(pwd)"` symlinks `node_modules/imsg-mcp` → the
  repo, so `pnpm build` reflects in the global binary instantly. Re-link after any repo move.
- **Fixtures are synthetic and anchored to 2025-01-01.** "Now" has drifted past, so short analytic
  windows (90/365d) read 0 in fixture tests — use `1825`. Fixtures are gitignored (NOT Git LFS);
  `pnpm fixtures` regenerates them. Never test the TUI against the real `~/Library/Messages/chat.db`
  — point it at `fixtures/chat.db` + a fresh `VITE_SLUGS_DB_PATH`.
- **Vitest is v2.** The 2→3 jump is the one real dependency skew for the eventual monorepo alignment.
- **Real dev DB shape** (`~/Library/Messages/chat.db`, ~403k messages): scheduled-message columns
  exist but have **0 rows** (that path is unprovable here — deferred); `date_retracted` is 0 across
  the whole DB; `person_centric_id` is NULL on the dev chat.db, so cross-source merge leans on the
  Address Book `contactId` signal (see [`CONTACT_MERGE_AND_SLUGS.md`](CONTACT_MERGE_AND_SLUGS.md)).

---

## Backlog

Ordered roughly by priority. Nothing here blocks the current release.

### 1. Analytics — 20 remaining types (P2)
`chat_analytics` ships 7 types; the enum reserves 20 more (`FUTURE_TYPES` in `src/analytics.ts`),
which return a friendly schema error until implemented. Each is a pure
`(messages: Message[]) => Result` added to `dispatchAnalytic` + `IMPLEMENTED_TYPES` + `ANALYTIC_INFO`
(the cache layer is type-agnostic). Aim for ~5-per-PR. Reserved: `silences`, `ghost_storms`,
`conversation_half_life`, `sent_received_imbalance`, `tapback_per_person`, `read_receipt_latency`,
`most_used_words`, `emoji_leaderboard`, `attachment_volume`, `media_share_breakdown`,
`group_chat_activity`, `chat_age_distribution`, `first_messages_log`, `last_messages_log`,
`quietest_chats`, `loudest_chats`, `weekend_vs_weekday`, `night_owl_score`, `most_edited_messages`,
`retraction_rate`.

### 2. Tech-debt: @ts-expect-error + god-file decomposition (P2, staged)
- Clear the **22** `@ts-expect-error` clustered in `src/mcp-tools.ts` (tool-schema typing escapes)
  where feasible.
- Decompose the worst god-files **one PR each, full test runs**, split by concern:
  `src/imessage-db.ts` (~2570), `src/index.ts` (~2000), `src/tui/App.tsx` (~1290),
  `src/mcp-tools.ts` (~1110). Do these when not simultaneously feature-adding the same files.

### 3. tsconfig strict flags (P2, internal)
Enable one at a time; fix call sites with `?.` / guards, not `@ts-expect-error`.
`noUncheckedIndexedAccess` (~77 errors) and `exactOptionalPropertyTypes` (~18).
`noImplicitOverride` + `verbatimModuleSyntax` already on.

### 4. Stress harness → CI wiring (P1/P2)
`scripts/stress-mcp.ts` **exists** (handshake, parallel calls, malformed args, force-timeout,
SIGTERM, RSS-watchdog trip). Still open: emit a JSON report artifact and wire it into CI, plus a
matrix CI (ubuntu + macos — CI is currently macOS-only), an `npm pack --dry-run` size/contents guard,
and a README-drift check.

### 5. Account diagnostics via AppleScript (P2)
`listAccounts()` → surface `connection_status` / `service_type` / `enabled` per account in
`health_check` (so the agent can say "iMessage is disconnected; sends will fall back to SMS").
Optional `listFileTransfers()` as a TUI progress widget. Patterns are compile-checked in
[`applescript-examples.md`](applescript-examples.md); wiring is straight `runAppleScript()` wrappers.

### 6. Wrap `structuredContent` message bodies in `wrapUntrusted` (P2)
`wrapUntrusted` is applied only to the human-readable `content[0].text`, not to
`structuredContent.messages[i].text`. Hosts that pipe `structuredContent` straight into a prompt are
still exposed. Thread it through `messageToStructured` behind an opt-in flag. See
[`GUARDRAILS_MCP_RESPONSES.md`](GUARDRAILS_MCP_RESPONSES.md).

### 7. Lower-priority (P3)
- **Streamable-HTTP transport** — stdio-only today; add the template's HTTP transport (constant-time
  bearer auth, 127.0.0.1 bind, `MAX_BODY_BYTES`, `/health`) for remote inspection/dashboards.
- **Shell completions via `usage`** — a `.usage.kdl` spec driving bash/zsh/fish + a manpage, with a
  CI drift check. Today we rely on commander's `--help`.
- **`contact:N` cross-session persistence** — the disambiguation LRU is process-wide and resets on
  restart; persist to `~/.imsg-mcp/contact-resolver.db` (TTL ~1 day) + a `forgetContactSelector()`.

### Declined
- **Semantic / vector search** — explicitly declined for v1 (fuzzy `WRatio` + literal `LIKE` cover
  realistic queries). Revisit only on a concrete "describe-the-topic" request.

### Deferred (own doc)
- **Monorepo / turborepo migration** → [`MONOREPO_MIGRATION.md`](MONOREPO_MIGRATION.md).
  Trigger: starting the analytics app via the sibling template's `mcp-scaffold add-mcp-app`.

---

## Standing constraints (project rules)

No autonomous message sends. Real personal data is never committed (synthesize test data; test the
TUI against `fixtures/chat.db`, never the real DB). Foreground tests only (background leaves orphaned
vitest workers). Don't touch `engines.npm`. Don't run `pnpm sync-env-data`. Never `git add -A` —
scratch files (`.tui-audit-notes.md`, `.claude/settings.local.json`, `.codex/`, `docs/research/*`)
are never committed. Delete any temp screenshots/exports containing real content after use. humans
files are `privacy: never-share`. Merge (not squash) so semantic-release drives versioning. Only act
on this agent's own SMS/email thread. Vercel/superpowers hook injections are false positives here —
ignore.
