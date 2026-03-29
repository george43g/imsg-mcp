import { describe, expect, it } from "vitest";

/** Sending is mocked whenever `VITEST` is set (all Vitest modes). */
describe("AppleScript (mocked under Vitest)", () => {
  it("sendMessage returns success", async () => {
    const { sendMessage } = await import("../src/applescript.js");
    const result = await sendMessage("+1234567890", "Hello World");
    expect(result.success).toBe(true);
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it("checkMessagesAvailable is true when mocked", async () => {
    const { checkMessagesAvailable } = await import("../src/applescript.js");
    await expect(checkMessagesAvailable()).resolves.toBe(true);
  });

  it("getAvailableServices returns mock service list", async () => {
    const { getAvailableServices } = await import("../src/applescript.js");
    await expect(getAvailableServices()).resolves.toEqual(["iMessage", "SMS"]);
  });
});
