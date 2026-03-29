# imsg-mcp — skills for AI agents

Use this file (and **AGENTS.md**) before doing substantial work in this repository.

## Git LFS (required in cloud / CI / fresh clones)

Large binaries (`*.db`, `*.abcddb` per `.gitattributes`) are stored with **Git LFS**. A normal clone may leave **pointer stubs** only; SQLite then fails with errors like “file is not a database”.

1. `git lfs install` (once per machine)
2. `git lfs pull` before `pnpm install` / tests / running the server against `env-data/`

See also `.agents/skills/imsg-mcp-dev/SKILL.md` (duplicate LFS block for Cursor skills).

## Environment variables (Vite / Vitest)

Precedence for any mode: `.env` → `.env.local` → `.env.[mode]` → `.env.[mode].local`.

| File | Role |
|------|------|
| `.env` | Baseline (often gitignored); typically `VITE_ENV=development`. |
| `.env.local` | Tracked template: **machine paths** (`VITE_IMSG_DB_PATH`, …). Do not set `VITE_ENV` here unless you intend to override. |
| `.env.test` | Committed: `VITE_ENV=ai` + `env-data/` paths for **`pnpm test`** (Vitest default mode `test`). |
| `.env.ai` | Optional: run MCP against bundled DBs (`pnpm mcp:ai`). |

- **`pnpm test`** — `vitest run` (mode `test`, loads `.env.test`).
- **`pnpm test:native`** — `vitest run --mode development` (no `.env.test`; Mac paths from `.env` + `.env.local`).
- Under **Vitest**, `AppleScript` sending is **always mocked** (`VITEST=true`); real Messages.app only when running built/`tsx` MCP outside Vitest with `VITE_ENV=development`.

## Thread slugs (why they exist)

**Problem:** Group chats use opaque `chat` identifiers and GUIDs; phone/email is awkward for 1:1 with country variants. Agents need a **stable, human-readable** handle to choose threads from `list_conversations` and to call `send_message` / `wait_for_reply`.

**Solution:** Each chat gets a **thread slug** derived from metadata (`src/thread-slug.ts`):  
`{sanitized-name}~{service}~{4-hex}`  
Examples: `alice~imsg~a3f2`, `weekend-crew~imsg~d4e5`, `group~imsg~f6a7` for unnamed groups.

**Persistence:** `src/slug-store.ts` writes `~/.imsg-mcp/slugs.db` (override with `VITE_SLUGS_DB_PATH`). `IMessageDB` syncs slugs from current chats, upserts records, and prunes stale GUIDs.

**Tools:** `send_message` accepts **`threadSlug`** (or `recipient`). `wait_for_reply` accepts **`threadSlug`** (or `chatIdentifier`). `list_conversations` returns **`threadSlug`** per row. **`get_messages`** still filters by **`chatIdentifier`** (phone, email, or raw id); resolving a slug for reads is not exposed as a separate parameter (use list output / handle).

## Scripts (maintenance)

| Script | Purpose |
|--------|---------|
| `pnpm sync-env-data` | Copies macOS `chat.db`, Address Book trees, and `slugs.db` into `env-data/` for cloud fixtures. **Overwrites** destinations. **Do not run** unless you intend to refresh committed/LFS fixtures; ensure Messages/permissions are safe. See AGENTS for caveats. |
| `pnpm exec tsx scripts/compare-contacts-vcf.ts` | Prints VCF vs `ContactsDB` match stats. Logic lives in `src/vcf-contact-compare.ts`; **Vitest** enforces **≥ 80%** match rate on `env-data/contacts.vcf`. |

**Removed:** `scripts/test-contacts.ts` — replaced by **`tests/contacts-imessage-smoke.test.ts`** (skips if DBs are missing or LFS pointers).

## CI

GitHub Actions: install, LFS checkout, `pnpm build`, `pnpm typecheck`, `pnpm test`.

## Code map (short)

| Area | Location |
|------|----------|
| MCP tools / Zod | `src/index.ts` |
| SQLite messages | `src/imessage-db.ts`, `src/imessage-parser-*.ts` |
| Contacts | `src/contacts-db.ts` |
| Slugs | `src/thread-slug.ts`, `src/slug-store.ts` |
| Send / mock | `src/applescript.ts`, `src/mock-send-db.ts` |
| Env | `src/config.ts` |
| Types | `src/types.ts` |
| DB schema notes | `docs/IMESSAGE_DB_SCHEMA.md` |

## Security / guardrails

See **AGENTS.md** (thread isolation, single-digit MCP guardrails, incident doc).
