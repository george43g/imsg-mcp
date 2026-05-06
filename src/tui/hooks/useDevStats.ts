import { useCallback, useEffect, useRef, useState } from "react";
import { hasNativeModule } from "../../native-bridge.js";

export interface DevStatsData {
  engine: "Rust" | "TS";
  cpuPercent: number;
  memMB: number;
  pid: number;
  uptime: string;
  lastQueryMs: number | null;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h${m}m`;
}

export function useDevStats(): { stats: DevStatsData; recordQueryTime: (ms: number) => void } {
  const [stats, setStats] = useState<DevStatsData>({
    engine: hasNativeModule() ? "Rust" : "TS",
    cpuPercent: 0,
    memMB: 0,
    pid: process.pid,
    uptime: "0s",
    lastQueryMs: null,
  });

  const lastCpuRef = useRef(process.cpuUsage());
  const lastTimeRef = useRef(Date.now());
  const lastQueryMsRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastTimeRef.current;
      if (elapsed === 0) return;

      const cpuNow = process.cpuUsage(lastCpuRef.current);
      // cpuUsage returns microseconds; convert to percentage of wall time
      const totalCpuUs = cpuNow.user + cpuNow.system;
      const cpuPercent = (totalCpuUs / 1000 / elapsed) * 100;

      lastCpuRef.current = process.cpuUsage();
      lastTimeRef.current = now;

      const { rss } = process.memoryUsage();
      const memMB = Math.round((rss / 1024 / 1024) * 10) / 10;

      setStats({
        engine: hasNativeModule() ? "Rust" : "TS",
        cpuPercent: Math.round(cpuPercent * 10) / 10,
        memMB,
        pid: process.pid,
        uptime: formatUptime(process.uptime()),
        lastQueryMs: lastQueryMsRef.current,
      });
    }, 2000);
    timer.unref();

    return () => clearInterval(timer);
  }, []);

  const recordQueryTime = useCallback((ms: number) => {
    lastQueryMsRef.current = Math.round(ms * 10) / 10;
  }, []);

  return { stats, recordQueryTime };
}
