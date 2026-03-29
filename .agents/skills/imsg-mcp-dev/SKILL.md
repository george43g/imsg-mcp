---
name: imsg-mcp-dev
description: Instructions for AI agents working on the imsg-mcp repository. Use this skill before doing any work in this repo, especially for cloud/remote agents.
---

# imsg-mcp Development Skill

## Git LFS: restore large files before any work (cloud / remote agents)

This repo stores large database files with **Git LFS** (`*.db`, `*.abcddb` per `.gitattributes`). In cloud or CI environments, a clone often leaves only LFS pointer files in the working tree, so the real `env-data/chat.db` and Address Book DBs are not present. Tests and code that read these files will fail until LFS content is restored.

**Before doing any other work** when operating in a remote/cloud environment (e.g. Cursor cloud agents, CI, or a fresh clone where LFS wasn't pulled):

1. **Ensure Git LFS is active** (once per environment):
   ```bash
   git lfs install
   ```
2. **Restore LFS files into the working directory**:
   ```bash
   git lfs pull
   ```
   This fetches LFS objects and checks them out so `env-data/chat.db`, `env-data/*.abcddb`, and any other tracked `*.db` / `*.abcddb` files are real files, not pointers.

If you only need to refresh the working tree from already-fetched LFS objects (e.g. after switching branches), you can run:

```bash
git lfs checkout
```

For a full restore after clone or when in doubt, use **`git lfs pull`** first, then proceed with `pnpm install`, `pnpm build`, `pnpm test`, etc.

## Canonical docs

- **`AGENTS.md`** — commands, env layout, MCP tools, permissions, guardrails, Cursor Cloud notes.
- **`skills.md`** (repo root) — same LFS block plus **thread slugs**, **scripts** (`sync-env-data` cautions), **code map**, and Vitest/env summary for handoff.

## Quick facts

- **Node ≥ 24** (see `package.json` / Volta).
- **Tests:** `pnpm test` uses `.env.test` (bundled `env-data`). **`pnpm test:native`** uses `--mode development` and your `.env.local` paths. Vitest **never** calls real `osascript`.
- **Thread slugs:** Stable IDs for conversations (`list_conversations` → `send_message` / `wait_for_reply` via `threadSlug`). See `skills.md` or `src/thread-slug.ts`.
- **`pnpm sync-env-data`:** Overwrites `env-data/` from your Mac — only run when intentionally refreshing fixtures; see `skills.md`.
