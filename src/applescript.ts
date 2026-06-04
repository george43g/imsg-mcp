import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getImsgDbPath, isAiEnv } from "./config.js";
import { setLastSendError } from "./logger.js";
import { insertSentMessage } from "./mock-send-db.js";
import type { SendMessageResult } from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Detect whether a handle looks like a phone number suitable for SMS
 * fallback. We don't bother validating the country/area code — Messages.app
 * will reject malformed ones with a clear error.
 */
function isPhoneLike(handle: string): boolean {
  return /^\+?[\d\s\-()]+$/.test(handle.trim());
}

/** Result shape for the preflight reachability check. */
export interface ImessageAvailability {
  /** Best-guess service that will reach this handle. */
  service: "iMessage" | "SMS" | "unknown";
  /** True iff at least one service appears to be reachable for the handle. */
  reachable: boolean;
  /** Human-readable hint when not reachable, for LLM remediation. */
  hint?: string;
}
/** `VITE_ENV=ai`, or any test run (never hit Messages.app / osascript under Vitest). */
const MOCK = isAiEnv() || process.env.VITEST === "true";

// ---------------------------------------------------------------------------
// Mock helpers (MOCK: return success + optional insert into chat.db)
// ---------------------------------------------------------------------------

function mockSend(
  text: string,
  target: { chatIdentifier?: string; chatGuid?: string },
): SendMessageResult {
  // Under Vitest, return success only — no SQLite (avoids LFS/pointer noise; tests cover API shape).
  if (process.env.VITEST !== "true") {
    try {
      insertSentMessage(getImsgDbPath(), target, text);
    } catch (err) {
      console.warn("[mock-send] DB insert failed (non-fatal):", err);
    }
  }
  return { success: true, timestamp: new Date() };
}

// ---------------------------------------------------------------------------
// Real AppleScript helpers
// ---------------------------------------------------------------------------

async function runAppleScript(
  script: string,
  captureErrorForSend: boolean = false,
): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("osascript", ["-e", script], {
      timeout: 30000,
    });
    if (stderr?.trim()) {
      console.error("[osascript] stderr:", stderr);
    }
    return stdout.trim();
  } catch (error: any) {
    if (captureErrorForSend) {
      setLastSendError({
        message: error.message || String(error),
        stderr: error.stderr ?? undefined,
        stdout: error.stdout ?? undefined,
        code: error.code ?? undefined,
      });
    }
    if (error.code === "ENOENT") {
      throw new Error("osascript not found. This tool requires macOS.");
    }
    if (error.stderr) {
      throw new Error(`AppleScript error: ${error.stderr}`);
    }
    throw error;
  }
}

export function appleScriptEscape(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

// ---------------------------------------------------------------------------
// Public API -- each function branches on MOCK
// ---------------------------------------------------------------------------

export async function sendMessage(recipient: string, message: string): Promise<SendMessageResult> {
  if (MOCK) return mockSend(message, { chatIdentifier: recipient });

  const escapedRecipient = appleScriptEscape(recipient);
  const escapedMessage = appleScriptEscape(message);
  const script = `
    tell application "Messages"
      set targetService to 1st account whose service type = iMessage
      set targetBuddy to participant "${escapedRecipient}" of targetService
      send "${escapedMessage}" to targetBuddy
    end tell
  `;
  try {
    await runAppleScript(script, true);
    return { success: true, timestamp: new Date() };
  } catch (error: any) {
    return { success: false, error: error.message || String(error) };
  }
}

export async function sendMessageAlt(
  recipient: string,
  message: string,
): Promise<SendMessageResult> {
  if (MOCK) return mockSend(message, { chatIdentifier: recipient });

  const escapedRecipient = appleScriptEscape(recipient);
  const escapedMessage = appleScriptEscape(message);
  const script = `
    tell application "Messages"
      send "${escapedMessage}" to buddy "${escapedRecipient}" of (service 1 whose service type is iMessage)
    end tell
  `;
  try {
    await runAppleScript(script, true);
    return { success: true, timestamp: new Date() };
  } catch (_error: any) {
    return sendSMS(recipient, message);
  }
}

export async function sendSMS(phoneNumber: string, message: string): Promise<SendMessageResult> {
  if (MOCK) return mockSend(message, { chatIdentifier: phoneNumber });

  const escapedPhone = appleScriptEscape(phoneNumber);
  const escapedMessage = appleScriptEscape(message);
  const script = `
    tell application "Messages"
      send "${escapedMessage}" to buddy "${escapedPhone}" of (service 1 whose service type is SMS)
    end tell
  `;
  try {
    await runAppleScript(script, true);
    return { success: true, timestamp: new Date() };
  } catch (error: any) {
    return { success: false, error: error.message || String(error) };
  }
}

export async function sendToChat(chatName: string, message: string): Promise<SendMessageResult> {
  if (MOCK) return mockSend(message, { chatIdentifier: chatName });

  const escapedName = appleScriptEscape(chatName);
  const escapedMessage = appleScriptEscape(message);
  const script = `
    tell application "Messages"
      send "${escapedMessage}" to chat "${escapedName}"
    end tell
  `;
  try {
    await runAppleScript(script, true);
    return { success: true, timestamp: new Date() };
  } catch (error: any) {
    return { success: false, error: error.message || String(error) };
  }
}

export async function sendToChatId(chatId: string, message: string): Promise<SendMessageResult> {
  if (MOCK) return mockSend(message, { chatGuid: chatId });

  const escapedId = appleScriptEscape(chatId);
  const escapedMessage = appleScriptEscape(message);
  const script = `
    tell application "Messages"
      send "${escapedMessage}" to text chat id "${escapedId}"
    end tell
  `;
  try {
    await runAppleScript(script, true);
    return { success: true, timestamp: new Date() };
  } catch (error: any) {
    return { success: false, error: error.message || String(error) };
  }
}

export async function checkMessagesAvailable(): Promise<boolean> {
  if (MOCK) return true;

  const script = `
    tell application "System Events"
      return exists application process "Messages"
    end tell
  `;
  try {
    const result = await runAppleScript(script);
    return result === "true";
  } catch {
    return false;
  }
}

export async function getAvailableServices(): Promise<string[]> {
  if (MOCK) return ["iMessage", "SMS"];

  const script = `
    tell application "Messages"
      set serviceList to {}
      repeat with s in services
        set end of serviceList to (service type of s as string)
      end repeat
      return serviceList
    end tell
  `;
  try {
    const result = await runAppleScript(script);
    return result
      .split(", ")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function activateMessages(): Promise<void> {
  if (MOCK) return;
  await runAppleScript('tell application "Messages" to activate');
}

export async function buddyExists(address: string): Promise<boolean> {
  if (MOCK) return true;

  const escaped = appleScriptEscape(address);
  const script = `
    tell application "Messages"
      try
        set targetBuddy to buddy "${escaped}" of (service 1 whose service type is iMessage)
        return true
      on error
        return false
      end try
    end tell
  `;
  try {
    const result = await runAppleScript(script);
    return result === "true";
  } catch {
    return false;
  }
}

/**
 * Reliable send: writes the message body to a UTF-8 temp file and uses
 * `read (POSIX file "...") as «class utf8»` inside AppleScript. This avoids
 * two recurring failure modes of inline-string sends:
 *   1. AppleScript string-length limits on very long messages.
 *   2. Quote/backslash/escape bugs when the message contains arbitrary user
 *      content (emoji ZWJ sequences, smart quotes, backticks, etc).
 *
 * Auto-fallback: if iMessage send fails AND the recipient looks like a phone
 * number, retries via the SMS service in the same AppleScript invocation.
 */
export async function sendMessageReliable(
  recipient: string,
  message: string,
): Promise<SendMessageResult> {
  if (MOCK) return mockSend(message, { chatIdentifier: recipient });

  const tmpFile = join(tmpdir(), `imsg-send-${randomBytes(8).toString("hex")}.txt`);
  try {
    writeFileSync(tmpFile, message, { encoding: "utf8" });
  } catch (error: any) {
    return { success: false, error: `Failed to stage send payload: ${error.message ?? error}` };
  }

  const escapedRecipient = appleScriptEscape(recipient);
  const escapedPath = appleScriptEscape(tmpFile);
  const phoneFallback = isPhoneLike(recipient);

  // Outer try sends via iMessage; if it errors AND the recipient is a phone
  // number, the on-error branch falls back to SMS. Both branches read the
  // body from the temp file to avoid AppleScript string handling.
  const script = phoneFallback
    ? `
      tell application "Messages"
        set msgBody to read (POSIX file "${escapedPath}") as «class utf8»
        try
          set iSvc to 1st account whose service type = iMessage
          send msgBody to participant "${escapedRecipient}" of iSvc
          return "iMessage"
        on error
          set sSvc to 1st account whose service type = SMS
          send msgBody to participant "${escapedRecipient}" of sSvc
          return "SMS"
        end try
      end tell
    `
    : `
      tell application "Messages"
        set msgBody to read (POSIX file "${escapedPath}") as «class utf8»
        set iSvc to 1st account whose service type = iMessage
        send msgBody to participant "${escapedRecipient}" of iSvc
        return "iMessage"
      end tell
    `;

  try {
    const service = await runAppleScript(script, true);
    return {
      success: true,
      timestamp: new Date(),
      service: service === "SMS" || service === "iMessage" ? service : undefined,
    };
  } catch (error: any) {
    return { success: false, error: error.message || String(error) };
  } finally {
    // Best-effort cleanup — failure here is non-fatal (OS will reap $TMPDIR).
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }
}

/**
 * Send a file attachment to a participant. Returns success/error.
 *
 * Uses `send (POSIX file "...") to participant ...` — the Messages SDEF
 * accepts a file specifier as the first argument to `send`. The file must
 * exist on disk; Messages.app will rate-limit or reject very large files
 * (typical cap ~100MB).
 *
 * For phone-like recipients, falls back to SMS service on iMessage failure.
 */
export async function sendAttachment(
  recipient: string,
  filepath: string,
): Promise<SendMessageResult> {
  if (MOCK) return mockSend(`[attachment:${filepath}]`, { chatIdentifier: recipient });

  const escapedRecipient = appleScriptEscape(recipient);
  const escapedPath = appleScriptEscape(filepath);
  const phoneFallback = isPhoneLike(recipient);

  const script = phoneFallback
    ? `
      tell application "Messages"
        try
          set iSvc to 1st account whose service type = iMessage
          send (POSIX file "${escapedPath}") to participant "${escapedRecipient}" of iSvc
          return "iMessage"
        on error
          set sSvc to 1st account whose service type = SMS
          send (POSIX file "${escapedPath}") to participant "${escapedRecipient}" of sSvc
          return "SMS"
        end try
      end tell
    `
    : `
      tell application "Messages"
        set iSvc to 1st account whose service type = iMessage
        send (POSIX file "${escapedPath}") to participant "${escapedRecipient}" of iSvc
        return "iMessage"
      end tell
    `;

  try {
    const service = await runAppleScript(script, true);
    return {
      success: true,
      timestamp: new Date(),
      service: service === "SMS" || service === "iMessage" ? service : undefined,
    };
  } catch (error: any) {
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Preflight reachability check. Cheap call that an agent should make BEFORE
 * `send_message` to avoid wasted attempts when the handle can't be reached.
 *
 * Detection rules:
 *   - Try iMessage `buddy` lookup → if success, return `iMessage`.
 *   - If handle looks like a phone number, try SMS `buddy` → if success,
 *     return `SMS`.
 *   - Otherwise return `unknown` with a remediation hint.
 */
/**
 * Cheap format check used by checkImessageAvailability before invoking
 * AppleScript. Messages.app's `buddy "..." of account` resolution is
 * lazy: any string returns a buddy reference, even literal nonsense
 * ("not-a-handle"). Without this guard the preflight reports
 * reachable:true for garbage and the caller's send_message later fails.
 *
 * Accepts E.164 phones (and digit/separator variants — the broader
 * recipient normalizer in `recipient.ts` will pick those up downstream)
 * and properly-shaped emails. Returns null when the handle passes; the
 * caller should then run the AppleScript probe.
 */
export function validateAvailabilityHandle(handle: string): ImessageAvailability | null {
  const trimmed = handle.trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  const isPhone = /^\+\d{6,15}$/.test(trimmed.replace(/[\s()\-.]/g, ""));
  if (isEmail || isPhone) return null;
  return {
    service: "unknown",
    reachable: false,
    hint: "Handle is neither a valid email nor a recognizable phone (expect E.164 like +61401990797).",
  };
}

export async function checkImessageAvailability(handle: string): Promise<ImessageAvailability> {
  // Reject obviously-invalid input first so we don't get false-positive
  // "reachable: true" from AppleScript's lazy buddy resolution.
  const formatFail = validateAvailabilityHandle(handle);
  if (formatFail) return formatFail;

  if (MOCK) {
    return { service: "iMessage", reachable: true };
  }

  const escaped = appleScriptEscape(handle);
  const script = `
    tell application "Messages"
      try
        set b to buddy "${escaped}" of (1st account whose service type is iMessage)
        return "iMessage"
      on error
        try
          set b to buddy "${escaped}" of (1st account whose service type is SMS)
          return "SMS"
        on error
          return "unknown"
        end try
      end try
    end tell
  `;
  try {
    const result = await runAppleScript(script);
    if (result === "iMessage" || result === "SMS") {
      return { service: result, reachable: true };
    }
    return {
      service: "unknown",
      reachable: false,
      hint: isPhoneLike(handle)
        ? "Handle not found in iMessage or SMS buddies. Verify the number format (try '+1...' for US) and that the recipient has at least one of iMessage or SMS reachable."
        : "Handle not found in iMessage buddies. For email addresses, the recipient must have iMessage active on that address.",
    };
  } catch (error: any) {
    return {
      service: "unknown",
      reachable: false,
      hint: `Availability check failed: ${error.message ?? error}. Most common cause: Messages.app Automation permission is not granted to this terminal/IDE.`,
    };
  }
}
