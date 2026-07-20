# Monorepo Migration — DEFERRED (planning doc)

**Status:** Deferred. Not scheduled for the current cycle. This doc parks the plan and the
decisions so nothing is lost; revisit when we start building the separate analytics tool.

**Why deferred:** Finalising imsg-mcp's planned features comes first. The migration is potentially
destructive and likely takes several iterations to get right, so it should not compete with the
feature work. The analytics tool and the monorepo were surfaced mainly as **direction-setting
context**, not immediate work.

---

## Why a monorepo at all

A separate, channel-agnostic **relationship-analysis tool** is planned (research:
`docs/research/RELATIONSHIP_ANALYSIS_RESEARCH_BRIEF.md`, `docs/research/deep-research-report.md`).
The research is explicit that this engine should be a **corpus consumer** — it treats imsg-mcp as
*one source extractor behind a normalized-export boundary*, not welded to `chat.db`. It must
generalise to other sources (WhatsApp/email/Slack/…).

Consequence: the two tools share **infrastructure + a corpus schema**, *not* the chat.db domain
layer. Little domain sharing + real infra sharing is the textbook case for a monorepo — it keeps the
related tools close and lets them share build/lint/test config and (eventually) infra packages,
while each app keeps its own domain core.

The sibling `/Users/george/repos/mcp-cli-starter-template` is a pnpm-workspaces + Turborepo starter
that **explicitly names imsg-mcp as a retrofit target** and ships an `mcp-scaffold` CLI plus shared
packages. imsg-mcp already shares that whole stack (pnpm, Vite, Biome, Vitest, Commander, Ink,
napi-rs, semantic-release), so this is **restructuring, not a tooling swap**.

## Locked decisions

- **Template-guided, MANUAL conversion.** Use the scaffolder's dry-run output as a checklist and
  hand-apply. Do **not** run `mcp-scaffold apply --execute` blindly against a shipping product.
- **Minimal package extraction now.** Adopt only the shared **config** packages
  (`tsconfig`, `biome-config`, `vitest-config`). **Defer** extracting `robustness`, `mcp-kit`,
  `cli-kit`, `tui-kit` until the analytics app actually needs them (YAGNI). imsg keeps its inlined
  watchdog/logger/shutdown/sanitize/prompt-injection for now.
- **Keep the `IMSG_*` env prefix** (do not rename to the template's `MCP_*`).
- **Keep single-package semantic-release** targeting the imsg app.

## What the analytics tool will consume from imsg (the shared surface, for later)

For when we design the corpus boundary — the analytics engine relies on:
- **Normalised message export** (`export_messages` output; extend to a canonical, channel-agnostic
  corpus: `person_id/identity_id/thread_id/thread_type/source`, `sender_role`, `timestamp_utc` +
  offset, decoded `text`, `reply_to`, `reactions`, `attachments`, `edited`/`deleted`, receipts,
  `mentions`, group context, provenance).
- **Decoded content** — body lives in `attributedBody` (plain `text` is usually NULL);
  `src/attributed-body-text.ts` is load-bearing for any content metric.
- **Merged contact identity** — one human spans many chat rows; per-person metrics run on the merged
  identity (Address Book `contactId` + thread slugs). See `docs/CONTACT_MERGE_AND_SLUGS.md`.
- **The `Message` record** (`src/types.ts`) and the **pure analytics functions** in
  `src/analytics.ts` (7 implemented + ~20 stubbed `FUTURE_TYPES`) as the metric substrate.
- **humans layer** — `skills/humans/SKILL.md` + `src/humans-scaffold.ts`; the narrative output target
  the engine extends to `humans/v2`.

## Migration steps (sketch, for when we do it)

1. **Generate the retrofit checklist (read-only).** From the template repo run
   `mcp-scaffold apply --target /Users/george/repos/imsg-mcp` — **dry-run is the default; do NOT pass
   `--execute`.** It emits a `RETROFIT.md` + the 12-phase / 21-migration list. Use it as a hand-apply
   checklist only.
2. **Monorepo shell.** Extend the existing `pnpm-workspace.yaml` (currently only `allowBuilds` /
   `overrides`) with `packages: ["apps/*", "packages/*"]`. Add a root `turbo.json`
   (build / typecheck / lint / test / test:no-native pipeline; mirror the template). Root becomes a
   private workspace root for orchestration.
3. **Move the package wholesale into `apps/imsg-mcp/`** as ONE unit: `src/`, `native/`, `tests/`,
   `scripts/`, `vite.config.ts`, `tsconfig.json`, `biome.json`, `package.json`, `.env.*`, fixtures.
   - Tests keep their `../src/...` relative imports (they move together).
   - `native/` must stay a sibling of the built `dist/` — `src/native-bridge.ts` hardcodes
     `join(__dirname, "..", "native")`.
4. **Adopt the 3 shared config packages** (`packages/tsconfig`, `packages/biome-config`,
   `packages/vitest-config`) from the template; point the app's configs at them.
5. **Reconcile version skew** — the one real one is **Vitest 2 → 3**. Also align Biome
   (2.4.4 → template's 2.5.3) if adopting the shared config; `@types/node` 20 → 24.
6. **Fix cwd / path assumptions** the move surfaces:
   - `src/config.ts` `getVcfPath()` uses `process.cwd()/fixtures/...`; `.env.test` uses cwd-relative
     `fixtures/...` — sensitive to the per-package Vitest cwd.
   - `vite.config.ts` entry paths, `tsconfig.json` `rootDir: ./src` + `include`, `biome.json`,
     `.npmignore`, `files`, and the `pack:mcpb` globs all assume top-level `src/`/`dist/`/`native/`.
7. **CI + release.** Update `.github/workflows` to drive builds/tests via turbo; the macOS
   `build-test` job stays the gate. Confirm `.releaserc.json` still targets the imsg app
   (single-package release, root-orchestrated).
8. **Re-link the global binary.** After the move, `pnpm add -g apps/imsg-mcp` so the global `imsg`
   symlink tracks the new location; smoke `imsg --version`/`--help`, the MCP dev server, and the TUI.

## Notes from recon (facts that make the move safe)

- **A clean core seam already exists.** `src/imessage-db.ts` and its full transitive closure import
  nothing from the MCP server / CLI / TUI — those sit cleanly on top. (The two former "wrong-side"
  edges — `exportStream.ts → tui/exportFormats`, `index.ts → tui/dateParse` — are cleaned up in the
  A1 "core-seam cleanup" step of the feature cycle, independent of this migration.)
- **Fixtures are synthetic + gitignored, NOT Git LFS.** `.gitattributes` disables LFS/diff/merge for
  `*.db`/`*.abcddb`; `fixtures/` is regenerated by `scripts/generate-fixtures.ts` on install. No LFS
  coupling to worry about.
- **Native module** is a napi-rs crate under `native/`, loaded by `src/native-bridge.ts`; only
  `parseAttributedBody` + `resolveContacts` cross the bridge; `IMSG_DISABLE_NATIVE=1` forces the TS
  fallback.

## Trigger to revisit

Start this when we begin the analytics app: `mcp-scaffold add-mcp-app <analytics>` scaffolds a second
MCP app inside the (by-then converted) monorepo. Each of that tool's features gets its own
spec → plan → implementation cycle.

## References

- Template: `/Users/george/repos/mcp-cli-starter-template`
  - Scaffolder CLI: `apps/scaffolder` (bin `mcp-scaffold`; commands `init`/`apply`/`plan`/`migrate`/`add-mcp-app`/`list`)
  - Migration phases: `apps/scaffolder/src/phases/` (01–12)
  - Retrofit generator: `apps/scaffolder/src/core/retrofit.ts` (emits `RETROFIT.md`)
  - Shared config packages to adopt: `packages/{tsconfig,biome-config,vitest-config}`
  - Reference: `turbo.json`, `pnpm-workspace.yaml`, `.github/workflows/ci.yml`
- Research: `docs/research/RELATIONSHIP_ANALYSIS_RESEARCH_BRIEF.md`, `docs/research/deep-research-report.md`
- Identity/merge: `docs/CONTACT_MERGE_AND_SLUGS.md`
