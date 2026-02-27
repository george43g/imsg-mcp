# Agent skills – imsg-mcp

Instructions for AI agents working in this repository.

## Git LFS: restore large files before any work (cloud / remote agents)

This repo stores large database files with **Git LFS** (`*.db`, `*.abcddb` per `.gitattributes`). In cloud or CI environments, a clone often leaves only LFS pointer files in the working tree, so the real `env-data/chat.db` and Address Book DBs are not present. Tests and code that read these files will fail until LFS content is restored.

**Before doing any other work** when operating in a remote/cloud environment (e.g. Cursor cloud agents, CI, or a fresh clone where LFS wasn’t pulled):

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
