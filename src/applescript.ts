import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getImsgDbPath, isAiEnv } from "./config.js";
import { setLastSendError } from "./logger.js";
import { insertSentMessage } from "./mock-send-db.js";
import type { SendMessageResult } from "./types.js";

const execFileAsync = promisify(execFile);
/** `VITE_ENV=ai`, or any test run (never hit Messages.app / osascript under Vitest). */
const MOCK = isAiEnv() || process.env.VITEST === "true";

// ---------------------------------------------------------------------------
// Mock helpers (MOCK: return success + optional insert into chat.db)
// ---------------------------------------------------------------------------

function mockSend(
  text: string,
  target: { chatIdentifier?: string; chatGuid?: string },
): SendMessageResult {
  try {
    insertSentMessage(getImsgDbPath(), target, text);
  } catch (err) {
    console.warn("[mock-send] DB insert failed (non-fatal):", err);
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

function appleScriptEscape(str: string): string {
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
