import { render } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/tui/App.js";
import { clearCache, installCacheSweepers, stopCacheSweepers } from "../src/tui/messageCache.js";
import { makeTheme } from "../src/tui/theme.js";
import { ThemeProvider } from "../src/tui/themes/ThemeContext.js";
import { installWatchdog, readWatchdogState } from "../src/watchdog.js";

describe("TUI memory + event-loop stability", () => {
  beforeEach(() => {
    installWatchdog();
    installCacheSweepers();
    if (global.gc) global.gc();
  });
  afterEach(() => {
    stopCacheSweepers();
    clearCache();
  });

  it("heap and event-loop lag stay bounded over a 10s render+input session", async () => {
    const theme = makeTheme();
    const heapStart = process.memoryUsage().heapUsed;

    const { stdin, unmount } = render(
      <ThemeProvider value={theme}>
        <App />
      </ThemeProvider>,
    );

    // 10s of mostly-idle render + occasional navigation.
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (i % 3 === 0) stdin.write("j");
      if (i % 7 === 0) stdin.write("k");
    }

    if (global.gc) global.gc();
    const heapEnd = process.memoryUsage().heapUsed;
    const growthMb = (heapEnd - heapStart) / 1024 / 1024;
    const wd = readWatchdogState();

    unmount();

    // Allow up to 50MB of heap growth — well above legitimate
    // working-set churn but a tight cliff for the closure-leak class.
    expect(growthMb).toBeLessThan(50);

    // Event-loop p99 must stay well below the sustained-lag threshold.
    expect(wd.eventLoopP99Ms).toBeLessThan(200);
    expect(wd.eventLoopSustainedCount).toBe(0);
  }, 45_000);

  it("unmount leaves no orphan timers", async () => {
    const theme = makeTheme();
    const { unmount } = render(
      <ThemeProvider value={theme}>
        <App />
      </ThemeProvider>,
    );
    await new Promise((r) => setTimeout(r, 2_000));
    unmount();
    // Wait one tick for cleanup callbacks to settle.
    await new Promise((r) => setTimeout(r, 100));

    const handles =
      (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
    const orphanTimers = handles.filter(
      (h) => (h as { constructor?: { name?: string } }).constructor?.name === "Timeout",
    );
    // A few system-level timers (vitest, node telemetry) are expected.
    expect(orphanTimers.length).toBeLessThan(8);
  }, 10_000);
});
