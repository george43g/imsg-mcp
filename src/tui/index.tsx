import React from "react";
import { withFullScreen } from "fullscreen-ink";
import { checkLocalAccess, formatAccessReport } from "../access-check.js";
import { enableOrphanWatchdog, installShutdownHandlers, registerCleanup, shutdown } from "../shutdown.js";
import { installWatchdog } from "../watchdog.js";
import { clearCache, installCacheSweepers, stopCacheSweepers } from "./messageCache.js";
import { App } from "./App.js";

export async function runTui(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("The TUI requires an interactive terminal (TTY).");
  }

  const report = await checkLocalAccess();
  if (!report.ok) {
    console.log(formatAccessReport(report));
    process.exit(1);
  }

  // Install shutdown handlers + watchdog before starting TUI
  installShutdownHandlers();
  enableOrphanWatchdog();
  installWatchdog();
  installCacheSweepers();

  registerCleanup(() => {
    stopCacheSweepers();
    clearCache();
  });

  const screen = withFullScreen(<App />);

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
