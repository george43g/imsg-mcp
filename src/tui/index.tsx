import { parseArgs } from "node:util";
import { withFullScreen } from "fullscreen-ink";
import { checkLocalAccess, formatAccessReport } from "../access-check.js";
import {
  enableOrphanWatchdog,
  installShutdownHandlers,
  registerCleanup,
  shutdown,
} from "../shutdown.js";
import { resolveTuiConfig } from "../tui-config.js";
import { installWatchdog } from "../watchdog.js";
import { App } from "./App.js";
import { clearCache, installCacheSweepers, stopCacheSweepers } from "./messageCache.js";
import { makeTheme } from "./theme.js";
import { ThemeProvider } from "./themes/ThemeContext.js";

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

if (process.argv[1]?.endsWith("tui.js")) {
  runTui().catch(async (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    await shutdown(1);
  });
}
