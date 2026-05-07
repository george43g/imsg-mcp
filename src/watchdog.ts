/**
 * Self-healing watchdog.
 *
 * Three independent monitors run on unref'd timers — they never prevent the
 * process from exiting on their own. When any monitor detects an unrecoverable
 * condition it triggers `shutdown()` so the host (Cursor / Claude / Warp)
 * spawns a clean instance.
 *
 * 1. Event-loop lag monitor (perf_hooks.monitorEventLoopDelay)
 *    - warn  > EVENT_LOOP_WARN_MS p99 over 5s window
 *    - kill  > EVENT_LOOP_KILL_MS p99 over 5s window
 *
 * 2. Memory monitor
 *    - warn  > heap exceeds HEAP_WARN_MB (handled by logger.startHeapMonitor)
 *    - kill  > RSS exceeds MAX_RSS_MB OR heap monotonically grew on
 *      MEMORY_GROWTH_SAMPLES consecutive 60s samples
 *
 * 3. Idle / uptime monitor
 *    - kill  > uptime > IDLE_RESTART_AFTER_MS AND no activity within
 *      IDLE_RESTART_QUIET_MS — graceful restart insurance for crufty
 *      long-running processes.
 *
 * All thresholds are configurable via env vars so they can be tuned per
 * environment without rebuilding.
 */

import { type IntervalHistogram, monitorEventLoopDelay } from "node:perf_hooks";
import { error, info, warn } from "./logger.js";
import { isShuttingDown, registerCleanup, shutdown } from "./shutdown.js";

// ── Config (env-overridable) ─────────────────────────────────────────────

function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const EVENT_LOOP_SAMPLE_MS = envNum("IMSG_EVENT_LOOP_SAMPLE_MS", 5_000);
const EVENT_LOOP_WARN_MS = envNum("IMSG_EVENT_LOOP_WARN_MS", 500);
const EVENT_LOOP_KILL_MS = envNum("IMSG_EVENT_LOOP_KILL_MS", 10_000);

const MEMORY_SAMPLE_MS = envNum("IMSG_MEMORY_SAMPLE_MS", 60_000);
const MAX_RSS_MB = envNum("IMSG_MAX_RSS_MB", 1024);
const MEMORY_GROWTH_SAMPLES = envNum("IMSG_HEAP_GROWTH_SAMPLES", 10);

const IDLE_RESTART_AFTER_MS = envNum("IMSG_RESTART_AFTER_MS", 24 * 60 * 60 * 1000); // 24h
const IDLE_RESTART_QUIET_MS = envNum("IMSG_RESTART_QUIET_MS", 60 * 60 * 1000); // 1h
const IDLE_CHECK_MS = envNum("IMSG_IDLE_CHECK_MS", 10 * 60 * 1000); // 10 min

// ── State ────────────────────────────────────────────────────────────────

interface WatchdogState {
  startedAt: number;
  eventLoopP99Ms: number;
  eventLoopMaxMs: number;
  rssMb: number;
  heapMb: number;
  heapHistory: number[]; // recent heap samples for leak detection
  lastActivityTs: number;
  killReason: string | null;
}

const state: WatchdogState = {
  startedAt: Date.now(),
  eventLoopP99Ms: 0,
  eventLoopMaxMs: 0,
  rssMb: 0,
  heapMb: 0,
  heapHistory: [],
  lastActivityTs: Date.now(),
  killReason: null,
};

let eventLoopHistogram: IntervalHistogram | null = null;
let eventLoopTimer: ReturnType<typeof setInterval> | null = null;
let memoryTimer: ReturnType<typeof setInterval> | null = null;
let idleTimer: ReturnType<typeof setInterval> | null = null;
let installed = false;

// ── Public API ───────────────────────────────────────────────────────────

/** Update the activity timestamp — call this from each tool dispatch. */
export function noteActivity(): void {
  state.lastActivityTs = Date.now();
}

/** Read current watchdog state — used by health_check and TUI dev stats. */
export function readWatchdogState(): Readonly<WatchdogState> {
  return state;
}

// ── Memory-pressure subscriber API ───────────────────────────────────────
type MemorySampleCallback = (rssMb: number, heapMb: number) => void;
const memSampleSubscribers = new Set<MemorySampleCallback>();

/**
 * Subscribe to the watchdog's existing 60s memory sample.
 * Returns an unsubscribe function. Used by the TUI message cache to evict
 * entries under heap pressure without spinning up its own sampler.
 */
export function onMemorySample(cb: MemorySampleCallback): () => void {
  memSampleSubscribers.add(cb);
  return () => {
    memSampleSubscribers.delete(cb);
  };
}

/** Install all three monitors. Idempotent — safe to call multiple times. */
export function installWatchdog(): void {
  if (installed) return;
  installed = true;

  // 1. Event-loop lag monitor
  eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
  eventLoopHistogram.enable();

  eventLoopTimer = setInterval(() => {
    if (!eventLoopHistogram || isShuttingDown()) return;
    // perf_hooks reports nanoseconds — convert to ms.
    const p99Ms = eventLoopHistogram.percentile(99) / 1e6;
    const maxMs = eventLoopHistogram.max / 1e6;
    state.eventLoopP99Ms = p99Ms;
    state.eventLoopMaxMs = maxMs;
    eventLoopHistogram.reset();

    if (p99Ms >= EVENT_LOOP_KILL_MS) {
      triggerKill("event_loop_blocked", {
        p99_ms: p99Ms,
        max_ms: maxMs,
        threshold_ms: EVENT_LOOP_KILL_MS,
      });
    } else if (p99Ms >= EVENT_LOOP_WARN_MS) {
      warn("event_loop_lag", { p99_ms: p99Ms, max_ms: maxMs, threshold_ms: EVENT_LOOP_WARN_MS });
    }
  }, EVENT_LOOP_SAMPLE_MS);
  eventLoopTimer.unref();

  // 2. Memory monitor — augments logger.ts heap warnings with hard kill rules
  memoryTimer = setInterval(() => {
    if (isShuttingDown()) return;
    const mu = process.memoryUsage();
    const rssMb = round1(mu.rss / 1024 / 1024);
    const heapMb = round1(mu.heapUsed / 1024 / 1024);
    state.rssMb = rssMb;
    state.heapMb = heapMb;

    // Notify subscribers (e.g. TUI message cache) so they can evict on pressure
    for (const cb of memSampleSubscribers) {
      try {
        cb(rssMb, heapMb);
      } catch {
        // Subscriber failures must not crash the watchdog
      }
    }

    // Track heap history for monotonic growth detection
    state.heapHistory.push(heapMb);
    if (state.heapHistory.length > MEMORY_GROWTH_SAMPLES) {
      state.heapHistory.shift();
    }

    if (rssMb >= MAX_RSS_MB) {
      triggerKill("rss_exceeded", { rss_mb: rssMb, threshold_mb: MAX_RSS_MB });
      return;
    }

    if (
      state.heapHistory.length >= MEMORY_GROWTH_SAMPLES &&
      isMonotonicallyGrowing(state.heapHistory)
    ) {
      triggerKill("memory_leak_suspected", {
        samples: state.heapHistory.slice(),
        sample_interval_ms: MEMORY_SAMPLE_MS,
      });
    }
  }, MEMORY_SAMPLE_MS);
  memoryTimer.unref();

  // 3. Idle / uptime monitor — kill if uptime > N AND no recent activity
  idleTimer = setInterval(() => {
    if (isShuttingDown()) return;
    const uptimeMs = Date.now() - state.startedAt;
    const idleMs = Date.now() - state.lastActivityTs;
    if (uptimeMs >= IDLE_RESTART_AFTER_MS && idleMs >= IDLE_RESTART_QUIET_MS) {
      triggerKill("idle_restart", { uptime_ms: uptimeMs, idle_ms: idleMs });
    }
  }, IDLE_CHECK_MS);
  idleTimer.unref();

  registerCleanup(() => {
    if (eventLoopHistogram) {
      eventLoopHistogram.disable();
      eventLoopHistogram = null;
    }
    if (eventLoopTimer) clearInterval(eventLoopTimer);
    if (memoryTimer) clearInterval(memoryTimer);
    if (idleTimer) clearInterval(idleTimer);
  });

  info("watchdog_installed", {
    event_loop_warn_ms: EVENT_LOOP_WARN_MS,
    event_loop_kill_ms: EVENT_LOOP_KILL_MS,
    max_rss_mb: MAX_RSS_MB,
    memory_growth_samples: MEMORY_GROWTH_SAMPLES,
    idle_restart_after_ms: IDLE_RESTART_AFTER_MS,
  });
}

// ── Internal helpers ─────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Returns true iff every sample is >= the previous (with at least 5MB total growth). */
export function isMonotonicallyGrowing(samples: number[]): boolean {
  if (samples.length < 2) return false;
  let prev = samples[0];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i] < prev) return false;
    prev = samples[i];
  }
  // Require at least 5MB total growth to ignore noise
  return samples[samples.length - 1] - samples[0] >= 5;
}

function triggerKill(reason: string, data: Record<string, unknown>): void {
  if (state.killReason) return; // already killing
  state.killReason = reason;
  error(`watchdog_kill: ${reason}`, data);
  // Use shutdown() so registered cleanups run. Force a hard exit if cleanup
  // itself hangs (e.g. SQL is wedged) — 5s grace.
  setTimeout(() => {
    error("watchdog_force_exit — graceful shutdown stalled", { reason });
    process.exit(137);
  }, 5_000).unref();
  shutdown(1).catch(() => process.exit(1));
}
