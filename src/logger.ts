/**
 * Structured logger with performance monitoring.
 *
 * - In-memory buffer for MCP `get_logs` tool (backwards compatible)
 * - NDJSON file output to $TMPDIR/imsg-mcp/ for post-mortem analysis
 * - Performance spans: `const span = perf("op"); ... span.end({ rows: 100 })`
 * - Heap memory tracking on every log entry
 *
 * Files in $TMPDIR are cleaned up by the OS automatically.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Types ──────────────────────────────────────────────────────────────

export type LogLevel = "info" | "warn" | "error" | "perf";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  dur_ms?: number;
  mem_mb: number;
  mem_delta_mb?: number;
  data?: Record<string, unknown>;
}

export interface PerfSpan {
  /** End the span. Logs duration, memory delta, and optional metadata. */
  end(data?: Record<string, unknown>): number;
}

export interface LastSendErrorDetails {
  message: string;
  stderr?: string;
  stdout?: string;
  code?: string | number;
  timestamp: string;
}

// ── State ──────────────────────────────────────────────────────────────

const MAX_LOG_LINES = 500;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB rotation

const memoryLines: string[] = [];
let logFilePath: string | null = null;
let logFileBytes = 0;
let lastSendError: LastSendErrorDetails | null = null;

// ── File output ────────────────────────────────────────────────────────

function getLogDir(): string {
  return join(tmpdir(), "imsg-mcp");
}

function ensureLogFile(): string | null {
  if (logFilePath && logFileBytes < MAX_FILE_BYTES) return logFilePath;

  try {
    const dir = getLogDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const date = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    logFilePath = join(dir, `imsg-mcp-${process.pid}-${date}.ndjson`);
    logFileBytes = 0;
    return logFilePath;
  } catch {
    return null;
  }
}

function writeToFile(json: string): void {
  const path = ensureLogFile();
  if (!path) return;
  try {
    const line = json + "\n";
    appendFileSync(path, line);
    logFileBytes += line.length;
  } catch {
    // Don't let file I/O failures break the app.
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function heapMB(): number {
  return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10;
}

function formatMemoryLine(entry: LogEntry): string {
  let line = `${entry.ts} [${entry.level}] ${entry.msg}`;
  if (entry.dur_ms != null) line += ` (${entry.dur_ms.toFixed(1)}ms)`;
  if (entry.data != null) line += ` ${JSON.stringify(entry.data)}`;
  return line;
}

function emit(entry: LogEntry): void {
  // In-memory buffer for MCP get_logs tool
  const line = formatMemoryLine(entry);
  memoryLines.push(line);
  if (memoryLines.length > MAX_LOG_LINES) {
    memoryLines.splice(0, memoryLines.length - MAX_LOG_LINES);
  }

  // NDJSON file output
  writeToFile(JSON.stringify(entry));
}

// ── Public API ─────────────────────────────────────────────────────────

export function info(msg: string, data?: Record<string, unknown>): void {
  emit({ ts: new Date().toISOString(), level: "info", msg, mem_mb: heapMB(), data });
}

export function warn(msg: string, data?: Record<string, unknown>): void {
  emit({ ts: new Date().toISOString(), level: "warn", msg, mem_mb: heapMB(), data });
}

export function error(msg: string, data?: Record<string, unknown>): void {
  emit({ ts: new Date().toISOString(), level: "error", msg, mem_mb: heapMB(), data });
}

/**
 * Start a performance span. Call `.end()` on the returned object to log
 * the duration, heap delta, and optional metadata.
 *
 * ```ts
 * const span = perf("listConversations");
 * // ... work ...
 * span.end({ chats: 200, deduped: 180 });
 * ```
 */
export function perf(msg: string): PerfSpan {
  const startTime = performance.now();
  const startHeap = heapMB();

  return {
    end(data?: Record<string, unknown>): number {
      const dur_ms = performance.now() - startTime;
      const endHeap = heapMB();
      emit({
        ts: new Date().toISOString(),
        level: "perf",
        msg,
        dur_ms,
        mem_mb: endHeap,
        mem_delta_mb: Math.round((endHeap - startHeap) * 10) / 10,
        data,
      });
      return dur_ms;
    },
  };
}

// ── Backwards-compatible API (used by MCP tools in index.ts) ───────────

/** @deprecated Use info/warn/error instead. Kept for MCP tool compat. */
export function appendLog(level: string, message: string, data?: unknown): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level: level as LogLevel,
    msg: message,
    mem_mb: heapMB(),
    data: data != null ? (typeof data === "object" ? (data as Record<string, unknown>) : { value: data }) : undefined,
  };
  emit(entry);
}

export function getLogs(tail?: number): string[] {
  if (tail != null && tail > 0) return memoryLines.slice(-tail);
  return [...memoryLines];
}

export function clearLogs(): void {
  memoryLines.length = 0;
}

export function setLastSendError(details: Omit<LastSendErrorDetails, "timestamp">): void {
  lastSendError = { ...details, timestamp: new Date().toISOString() };
  error("send_message failed", details as Record<string, unknown>);
}

export function getLastSendError(): LastSendErrorDetails | null {
  return lastSendError ? { ...lastSendError } : null;
}

/** Return the path to the current log file (if any). */
export function getLogFilePath(): string | null {
  return logFilePath;
}

/** Return the log directory path. */
export function getLogDirectory(): string {
  return getLogDir();
}
