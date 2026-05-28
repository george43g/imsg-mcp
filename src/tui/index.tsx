import { parseArgs } from "node:util";
import { withFullScreen } from "fullscreen-ink";
import { checkLocalAccess, formatAccessReport } from "../access-check.js";
import { detectNerdFont } from "../font-detect.js";
import { enableOrphanWatchdog, installShutdownHandlers, registerCleanup } from "../shutdown.js";
import { resolveTuiConfig } from "../tui-config.js";
import { installWatchdog } from "../watchdog.js";
import { App } from "./App.js";
import { clearCache, installCacheSweepers, stopCacheSweepers } from "./messageCache.js";
import { makeTheme } from "./theme.js";
import { ThemeProvider } from "./themes/ThemeContext.js";

/**
 * Build the warning we print when the user picked `powerline` but no
 * Nerd Font is detected. Pure function so tests can lock the wording.
 */
export function buildPowerlineFontWarning(
  detection: ReturnType<typeof detectNerdFont>,
): string | null {
  if (detection.source === "fc-list" && detection.detected === false) {
    return (
      "warn: powerline theme selected but no Nerd Font was detected.\n" +
      "      Glyphs will render blank. Either install one (https://www.nerdfonts.com)\n" +
      "      or switch with: imsg --theme=safe   (or `imsg config edit`)"
    );
  }
  if (detection.source === "unavailable") {
    return (
      "warn: powerline theme selected; could not auto-detect a Nerd Font (no fc-list).\n" +
      "      If glyphs render blank, install one (https://www.nerdfonts.com) or\n" +
      "      switch with: imsg --theme=safe"
    );
  }
  return null;
}

/** Parse `--theme` and `--accent` from the TUI command line. Unknown
 *  flags don't raise — the TUI accepts no other options today. */
function parseTuiCliArgs(): { theme?: string; accent?: string } {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        theme: { type: "string" },
        accent: { type: "string" },
      },
      strict: false,
      allowPositionals: true,
    });
    return {
      theme: typeof values.theme === "string" ? values.theme : undefined,
      accent: typeof values.accent === "string" ? values.accent : undefined,
    };
  } catch {
    return {};
  }
}

export async function runTui(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("The TUI requires an interactive terminal (TTY).");
  }

  const report = await checkLocalAccess();
  if (!report.ok) {
    console.log(formatAccessReport(report));
    process.exit(1);
  }

  // Resolve theme / accent: CLI > env > ~/.config/imsg-mcp/config.json > defaults.
  const cli = parseTuiCliArgs();
  const cfg = resolveTuiConfig({ cliTheme: cli.theme, cliAccent: cli.accent });
  for (const w of cfg.warnings) console.error(`warn: ${w}`);

  // Powerline theme needs a Nerd Font; warn the user once at startup if
  // we can detect (or strongly suspect) one is missing. The message lands
  // in stderr before alt-screen activates and surfaces in scrollback after
  // the user quits the TUI.
  if (cfg.theme === "powerline") {
    const warning = buildPowerlineFontWarning(detectNerdFont());
    if (warning) console.error(warning);
  }

  const theme = makeTheme({ preset: cfg.theme, accent: cfg.accentColor });

  // Install shutdown handlers + watchdog before starting TUI
  installShutdownHandlers();
  enableOrphanWatchdog();
  installWatchdog();
  installCacheSweepers();

  registerCleanup(() => {
    stopCacheSweepers();
    clearCache();
  });

  const screen = withFullScreen(
    <ThemeProvider value={theme}>
      <App />
    </ThemeProvider>,
  );

  // Register screen cleanup so terminal is restored on any exit
  registerCleanup(() => {
    try {
      screen.instance.unmount();
    } catch {
      // Screen may already be unmounted
    }
  });

  await screen.start();
  await screen.waitUntilExit();
}
