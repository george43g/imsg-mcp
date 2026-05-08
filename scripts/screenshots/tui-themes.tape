# Theme variants — same scene rendered with each theme + accent combo so
# the README can show side-by-side. Each frame writes its own PNG.

Set FontSize 13
Set FontFamily "JetBrains Mono"
Set Width 1400
Set Height 800
Set Padding 5
Set TypingSpeed 50ms

# ── 1. default safe theme + iMessage blue accent ─────────────────────────
Output docs/screenshots/theme-safe-blue.png
Hide
Type "node --env-file=.env.test dist/tui.js"
Enter
Sleep 2s
Show
Type "j"
Sleep 200ms
Tab
Sleep 1s
Screenshot docs/screenshots/theme-safe-blue.png
Type "q"
Sleep 500ms

# ── 2. safe theme + warm orange accent ──────────────────────────────────
Output docs/screenshots/theme-safe-orange.png
Hide
Type 'IMSG_TUI_ACCENT="#FF6B35" node --env-file=.env.test dist/tui.js'
Enter
Sleep 2s
Show
Type "j"
Sleep 200ms
Tab
Sleep 1s
Screenshot docs/screenshots/theme-safe-orange.png
Type "q"
Sleep 500ms

# ── 3. powerline theme + iMessage blue ──────────────────────────────────
Output docs/screenshots/theme-powerline-blue.png
Hide
Type 'IMSG_TUI_THEME=powerline node --env-file=.env.test dist/tui.js'
Enter
Sleep 2s
Show
Type "j"
Sleep 200ms
Tab
Sleep 1s
Screenshot docs/screenshots/theme-powerline-blue.png
Type "q"
Sleep 500ms

# ── 4. powerline theme + magenta accent ─────────────────────────────────
Output docs/screenshots/theme-powerline-magenta.png
Hide
Type 'IMSG_TUI_THEME=powerline IMSG_TUI_ACCENT="#FF00FF" node --env-file=.env.test dist/tui.js'
Enter
Sleep 2s
Show
Type "j"
Sleep 200ms
Tab
Sleep 1s
Screenshot docs/screenshots/theme-powerline-magenta.png
Type "q"
Sleep 500ms
