# Screenshots

Auto-generated demo PNGs and GIFs of the CLI/TUI, produced by
[`charmbracelet/vhs`](https://github.com/charmbracelet/vhs).

## Prerequisites

```bash
brew install vhs
```

(Linux: see the vhs README — there's a `.deb`, `.rpm`, and a static binary.)

## Regenerate

```bash
pnpm fixtures           # synthetic data — vhs runs the TUI against this
pnpm build              # vhs runs the built dist/tui.js, not the TS source
pnpm screenshots        # writes docs/screenshots/*.png
```

Each `.tape` file in this directory drives one scene. Edit the tape, re-run,
and commit the resulting PNG. Most tapes are 5–10 seconds of recording.

## Drift check (optional CI)

```bash
pnpm screenshots:check  # regenerate, then `git diff --exit-code docs/screenshots/`
```

Fails if any committed screenshot doesn't match what `vhs` produces today —
indicating the UI changed and the docs need a refresh.

## Why VHS

VHS is the only tool we found in 2026 that produces both static PNGs (via
`Screenshot foo.png`) **and** animated GIFs/MP4s from one declarative `.tape`
script, runs fully headless, and is the de facto standard in the
TUI-publishing world (Charm, BubbleTea, lazygit, etc).

If you're hacking on the screenshots: see `vhs --help` and the tape syntax
reference at <https://github.com/charmbracelet/vhs#vhs-command-reference>.
