import { describe, expect, it } from "vitest";

/**
 * Under Vitest, `MOCK` is true: no osascript, stable success-shaped results.
 * See `src/applescript.ts` public API branches on `MOCK`.
 * (Node marks `execFile` non-configurable, so we cannot spy on it here.)
 */
describe("AppleScript mock path (Vitest)", () => {
  async function loadApplescript() {
    return import("../src/applescript.js");
  }

  it("sendMessage returns success with timestamp", async () => {
    const { sendMessage } = await loadApplescript();
    const result = await sendMessage("+1234567890", "Hello World");
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it("sendMessageAlt returns success", async () => {
    const { sendMessageAlt } = await loadApplescript();
    const result = await sendMessageAlt("+19998887777", "Alt path");
    expect(result.success).toBe(true);
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it("sendSMS returns success", async () => {
    const { sendSMS } = await loadApplescript();
    const result = await sendSMS("+15551234567", "SMS body");
    expect(result.success).toBe(true);
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it("sendToChat returns success", async () => {
    const { sendToChat } = await loadApplescript();
    const result = await sendToChat("Family", "Group hi");
    expect(result.success).toBe(true);
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it("sendToChatId uses chatGuid target in mockSend", async () => {
    const { sendToChatId } = await loadApplescript();
    const result = await sendToChatId("iMessage;+;chat123", "To guid chat");
    expect(result.success).toBe(true);
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it("checkMessagesAvailable is true", async () => {
    const { checkMessagesAvailable } = await loadApplescript();
    await expect(checkMessagesAvailable()).resolves.toBe(true);
  });

  it("getAvailableServices returns iMessage and SMS", async () => {
    const { getAvailableServices } = await loadApplescript();
    await expect(getAvailableServices()).resolves.toEqual(["iMessage", "SMS"]);
  });

  it("activateMessages resolves without throwing", async () => {
    const { activateMessages } = await loadApplescript();
    await expect(activateMessages()).resolves.toBeUndefined();
  });

  it("buddyExists is true for any address", async () => {
    const { buddyExists } = await loadApplescript();
    await expect(buddyExists("anyone@example.com")).resolves.toBe(true);
  });

  it("handles message text with characters that would need escaping in real AppleScript", async () => {
    const { sendMessage } = await loadApplescript();
    const tricky = 'Say "hi"\nand \t\\path';
    const result = await sendMessage("+10000000000", tricky);
    expect(result.success).toBe(true);
  });
});

describe("appleScriptEscape (pure)", () => {
  it("escapes backslash, double quote, newline, carriage return, tab", async () => {
    const { appleScriptEscape } = await import("../src/applescript.js");
    expect(appleScriptEscape(`a"b\\c`)).toBe(`a\\"b\\\\c`);
    expect(appleScriptEscape("line1\nline2")).toBe("line1\\nline2");
    expect(appleScriptEscape("a\rb")).toBe("a\\rb");
    expect(appleScriptEscape("x\ty")).toBe("x\\ty");
  });

  it("leaves simple text unchanged", async () => {
    const { appleScriptEscape } = await import("../src/applescript.js");
    expect(appleScriptEscape("Hello World 123")).toBe("Hello World 123");
  });
});
