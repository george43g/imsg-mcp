# icloud-api — Cross-Platform iMessage/iCloud Client

Turborepo monorepo for a cross-platform iMessage and iCloud API client that interfaces directly with Apple's infrastructure.

## Packages

| Package | Language | Description |
|---------|----------|-------------|
| `@icloud-api/core` | TypeScript | Auth (GSA/SRP), APNs client, IDS registration, encryption, messaging |
| `@icloud-api/relay` | Go | macOS relay server for IDS validation-data generation |

## Architecture

```
Phase 1 (no Mac):  Auth ──► APNs connection ──► Topic subscription
Phase 2 (Mac relay): IDS registration ──► Key lookup ──► Session tokens
Phase 3 (no Mac):  Encryption ──► Send/receive messages
Phase 4 (no Mac):  Contacts sync, SMS relay, attachments
```

## Getting Started

```bash
cd packages/icloud-api
pnpm install
pnpm build
pnpm test
```

## Development

```bash
pnpm dev        # Watch mode for all packages
pnpm typecheck  # Type check all packages
pnpm lint       # Lint all packages
```

## Research

Extensive protocol research documents are in the parent repo's `docs/` directory:

- `docs/GRANDSLAM_GSA_RESEARCH.md` — Authentication protocol
- `docs/RESEARCH_ALBERT_APNS_2026-02-27.md` — Albert activation + APNs protocol
- `docs/IDS_IDENTITY_SERVICES_RESEARCH.md` — IDS registration + pair-ec encryption
- `docs/RESEARCH_IMESSAGE_PROTOCOL_AND_IMPLEMENTATIONS.md` — Wire format + OSS survey
- `docs/research/SYNTHESIS.md` — Master feasibility analysis

## Status

Phase 1 in progress — GSA authentication and APNs binary protocol.

## License

MIT
