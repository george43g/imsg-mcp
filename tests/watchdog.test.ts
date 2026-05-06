/**
 * Watchdog unit tests.
 *
 * We focus on the pure helper (`isMonotonicallyGrowing`) and on the API
 * surface of `installWatchdog` / `noteActivity` / `readWatchdogState`.
 * Full end-to-end behavior (event-loop kill, memory kill, idle restart)
 * is best covered by manual simulation — the helper tests below pin the
 * detection logic itself.
 */
import { describe, expect, it } from "vitest";
import { isMonotonicallyGrowing, noteActivity, readWatchdogState } from "../src/watchdog.js";

describe("watchdog: isMonotonicallyGrowing", () => {
  it("returns true for strictly increasing samples with > 5MB total growth", () => {
    expect(isMonotonicallyGrowing([10, 12, 15, 18, 22])).toBe(true);
  });

  it("returns true for non-decreasing samples (plateaus allowed) when growth >= 5MB", () => {
    expect(isMonotonicallyGrowing([10, 10, 12, 15, 15, 17])).toBe(true);
  });

  it("returns false if any sample drops below the previous", () => {
    expect(isMonotonicallyGrowing([10, 12, 11, 15, 18])).toBe(false);
  });

  it("returns false if total growth is less than 5MB (noise floor)", () => {
    expect(isMonotonicallyGrowing([10, 11, 12, 13, 14])).toBe(false); // only 4MB growth
  });

  it("returns false for fewer than 2 samples", () => {
    expect(isMonotonicallyGrowing([])).toBe(false);
    expect(isMonotonicallyGrowing([42])).toBe(false);
  });

  it("returns true for steady leak pattern (10 samples, +1MB each)", () => {
    const samples = Array.from({ length: 10 }, (_, i) => 50 + i);
    expect(isMonotonicallyGrowing(samples)).toBe(true);
  });
});

describe("watchdog: state surface", () => {
  it("readWatchdogState returns a frozen-ish snapshot with expected keys", () => {
    const state = readWatchdogState();
    expect(state).toHaveProperty("startedAt");
    expect(state).toHaveProperty("eventLoopP99Ms");
    expect(state).toHaveProperty("eventLoopMaxMs");
    expect(state).toHaveProperty("rssMb");
    expect(state).toHaveProperty("heapMb");
    expect(state).toHaveProperty("heapHistory");
    expect(state).toHaveProperty("lastActivityTs");
    expect(state).toHaveProperty("killReason");
    expect(state.killReason).toBeNull();
  });

  it("noteActivity advances lastActivityTs", () => {
    const before = readWatchdogState().lastActivityTs;
    // Wait at least 5ms so timestamps differ even on fast machines
    const start = Date.now();
    while (Date.now() - start < 5) {
      // busy wait
    }
    noteActivity();
    const after = readWatchdogState().lastActivityTs;
    expect(after).toBeGreaterThan(before);
  });
});
