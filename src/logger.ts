/**
 * In-memory log buffer and last send error for MCP debug tools.
 * get_logs and get_last_send_error tools read from here.
 */

const MAX_LOG_LINES = 500;

const logLines: string[] = [];

export function appendLog(level: string, message: string, data?: unknown): void {
  const ts = new Date().toISOString();
  const line =
    data != null
      ? `${ts} [${level}] ${message} ${JSON.stringify(data)}`
      : `${ts} [${level}] ${message}`;
  logLines.push(line);
  if (logLines.length > MAX_LOG_LINES) logLines.splice(0, logLines.length - MAX_LOG_LINES);
}

export function getLogs(tail?: number): string[] {
  if (tail != null && tail > 0) return logLines.slice(-tail);
  return [...logLines];
}

export function clearLogs(): void {
  logLines.length = 0;
}

export interface LastSendErrorDetails {
  message: string;
  stderr?: string;
  stdout?: string;
  code?: string | number;
  timestamp: string;
}

let lastSendError: LastSendErrorDetails | null = null;

export function setLastSendError(details: Omit<LastSendErrorDetails, "timestamp">): void {
  lastSendError = { ...details, timestamp: new Date().toISOString() };
}

export function getLastSendError(): LastSendErrorDetails | null {
  return lastSendError ? { ...lastSendError } : null;
}
