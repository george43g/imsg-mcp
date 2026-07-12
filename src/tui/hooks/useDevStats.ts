import { useCallback, useEffect, useRef, useState } from "react";
import { hasNativeModule } from "../../native-bridge.js";
import { readWatchdogState } from "../../watchdog.js";

export interface DevStatsData {
  engine: "Rust parser + TS DB" | "TS";
  cpuPercent: number;
  memMB: number;
  pid: number;
  uptime: string;
  lastQueryMs: number | null;
  eventLoopP99Ms: number;
  lastActivityAgo: string;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h${m}m`;
}

function formatAgo(ms: number): string {
  if (ms < 1_000) return "now";
  const sec = Math.floor(ms / 1_000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}

function engineLabel(): DevStatsData["engine"] {
  return hasNativeModule() ? "Rust parser + TS DB" : "TS";
}

export function useDevStats(visible: boolean): {
  stats: DevStatsData;
  recordQueryTime: (ms: number) => void;
} {
  const [stats, setStats] = useState<DevStatsData>({
    engine: engineLabel(),
    cpuPercent: 0,
    memMB: 0,
    pid: process.pid,
    uptime: "0s",
    lastQueryMs: null,
    eventLoopP99Ms: 0,
    lastActivityAgo: "now",
  });

  const lastCpuRef = useRef(process.cpuUsage());
  const lastTimeRef = useRef(Date.now());
  const lastQueryMsRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visible) return;
    const sample = () => {
      const now = Date.now();
      const elapsed = now - lastTimeRef.current;

      // CPU% needs a time delta; on the immediate first sample keep 0.
      let cpuPercent = 0;
      if (elapsed > 0) {
        const cpuNow = process.cpuUsage(lastCpuRef.current);
        // cpuUsage returns microseconds; convert to percentage of wall time
        const totalCpuUs = cpuNow.user + cpuNow.system;
        cpuPercent = (totalCpuUs / 1000 / elapsed) * 100;
        lastCpuRef.current = process.cpuUsage();
        lastTimeRef.current = now;
      }

      const { rss } = process.memoryUsage();
      const memMB = Math.round((rss / 1024 / 1024) * 10) / 10;

      const wd = readWatchdogState();
      setStats({
        engine: engineLabel(),
        cpuPercent: Math.round(cpuPercent * 10) / 10,
        memMB,
        pid: process.pid,
        uptime: formatUptime(process.uptime()),
        lastQueryMs: lastQueryMsRef.current,
        eventLoopP99Ms: Math.round(wd.eventLoopP99Ms * 10) / 10,
        lastActivityAgo: formatAgo(Date.now() - wd.lastActivityTs),
      });
    };

    // Paint real numbers as soon as the panel opens — without this the panel
    // shows 0MB / 0s until the first interval tick lands.
    sample();
    const timer = setInterval(sample, 2000);
    timer.unref();

    return () => clearInterval(timer);
  }, [visible]);

  const recordQueryTime = useCallback((ms: number) => {
    lastQueryMsRef.current = Math.round(ms * 10) / 10;
  }, []);

  return { stats, recordQueryTime };
}
