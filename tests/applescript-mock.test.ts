import { describe, expect, it } from "vitest";

/**
 * Exercises `applescript.ts` when `VITE_ENV=ai` (MOCK=true): no osascript, optional
 * writes to env-data DB paths from `.env.ai`. Default `pnpm test` loads `.env.ai`.
 */
describe("AppleScript mock path (VITE_ENV=ai)", () => {
  it("sendMessage returns success", async () => {
    const { sendMessage } = await import("../src/applescript.js");
    const result = await sendMessage("+1234567890", "Hello World");
    expect(result.success).toBe(true);
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it("checkMessagesAvailable is true in mock mode", async () => {
    const { checkMessagesAvailable } = await import("../src/applescript.js");
    await expect(checkMessagesAvailable()).resolves.toBe(true);
  });

  it("getAvailableServices returns mock services", async () => {
    const { getAvailableServices } = await import("../src/applescript.js");
    await expect(getAvailableServices()).resolves.toEqual(["iMessage", "SMS"]);
  });
});
