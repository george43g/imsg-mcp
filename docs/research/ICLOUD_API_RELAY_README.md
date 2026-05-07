# @icloud-api/relay — macOS Validation Data Relay

Go server that generates IDS validation-data on macOS and serves it to cross-platform `@icloud-api/core` clients via HTTP/WebSocket.

## Why This Exists

Apple's IDS registration requires a `validation-data` blob that can only be generated on real macOS hardware (or emulated via Unicorn, which Apple actively blocks). This relay runs on a Mac and provides validation-data to non-Mac clients.

## Architecture

```
┌─────────────┐     WebSocket      ┌──────────────────┐
│  @icloud-api │ ◄────────────────► │  relay (macOS)   │
│  /core (any) │   validation-data  │  identityservicesd│
└─────────────┘                    └──────────────────┘
```

## Usage

```bash
# Build (on macOS)
go build -o relay

# Run
./relay --port 8080
```

## Endpoints

- `GET /health` — Server status
- `POST /generate` — Generate validation-data (macOS only)

## Requirements

- macOS 12.7.1 - 14.3 (Intel or Apple Silicon)
- Go 1.22+
- SIP may need to be disabled for NAC API access

## Status

Phase 2 — endpoint structure in place, NAC generation not yet implemented.
See `docs/RESEARCH_ALBERT_APNS_2026-02-27.md` for NAC API details.
