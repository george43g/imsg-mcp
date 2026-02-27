import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setLastSendError } from "./logger.js";
import type { SendMessageResult } from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Execute AppleScript code via osascript.
 * On failure, captures stderr/stdout/code for get_last_send_error.
 */
async function runAppleScript(
  script: string,
  captureErrorForSend: boolean = false,
): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("osascript", ["-e", script], {
      timeout: 30000, // 30 second timeout
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

/**
 * Escape a string for use in AppleScript
 */
function appleScriptEscape(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Send an iMessage to the specified recipient
 * @param recipient Phone number or email address
 * @param message Message text to send
 */
export async function sendMessage(recipient: string, message: string): Promise<SendMessageResult> {
  const escapedRecipient = appleScriptEscape(recipient);
  const escapedMessage = appleScriptEscape(message);

  // AppleScript to send iMessage
  // This uses the Messages.app via AppleScript
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
    return {
      success: false,
      error: error.message || String(error),
    };
  }
}

/**
 * Send an iMessage using an alternative method that works better in some cases
 * This method sends to a buddy by their address directly
 */
export async function sendMessageAlt(
  recipient: string,
  message: string,
): Promise<SendMessageResult> {
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

/**
 * Send an SMS via SMS Relay (requires iPhone paired with Mac)
 * @param phoneNumber Phone number to send to
 * @param message Message text to send
 */
export async function sendSMS(phoneNumber: string, message: string): Promise<SendMessageResult> {
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
    return {
      success: false,
      error: error.message || String(error),
    };
  }
}

/**
 * Send a message to a named group chat.
 * The group must have a display name set in Messages.app.
 */
export async function sendToChat(chatName: string, message: string): Promise<SendMessageResult> {
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

/**
 * Send a message to a chat by its internal text chat ID (guid from chat.db).
 * Fragile across macOS versions but works as a fallback for unnamed groups.
 */
export async function sendToChatId(chatId: string, message: string): Promise<SendMessageResult> {
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

/**
 * Check if Messages.app is available and accessible
 */
export async function checkMessagesAvailable(): Promise<boolean> {
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

/**
 * Get the list of available message services (iMessage, SMS, etc.)
 */
export async function getAvailableServices(): Promise<string[]> {
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
    // Result comes back as "iMessage, SMS" style
    return result
      .split(", ")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Activate (bring to front) the Messages app
 */
export async function activateMessages(): Promise<void> {
  await runAppleScript('tell application "Messages" to activate');
}

/**
 * Check if a specific buddy/contact exists in Messages
 */
export async function buddyExists(address: string): Promise<boolean> {
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
