/**
 * Send-reliability surface tests.
 *
 * Real osascript is mocked under Vitest (VITEST=true → MOCK branch). These
 * tests pin the SUCCESS shape of the mock path (so the structured-output
 * contract matches) and source-grep the AppleScript template to ensure the
 * SMS auto-fallback + temp-file send patterns don't regress.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkImessageAvailability, sendMessageReliable } from "../src/applescript.js";

const SRC = readFileSync(resolve(__dirname, "../src/applescript.ts"), "utf8");

describe("sendMessageReliable (mocked under VITEST)", () => {
  it("returns success with timestamp for a basic send", async () => {
    const res = await sendMessageReliable("+15555550100", "hello");
    expect(res.success).toBe(true);
    expect(res.timestamp).toBeInstanceOf(Date);
  });

  it("handles long unicode + emoji + newlines (no string-length regression)", async () => {
    const body = `${"🚀".repeat(500)}\n\n"smart quotes" — em-dash 漢字 — emoji ZWJ 👨‍👩‍👧`;
    const res = await sendMessageReliable("+15555550101", body);
    expect(res.success).toBe(true);
  });
});

describe("send-reliability source guards", () => {
  it("uses a temp-file UTF-8 read pattern (not inline-string body)", () => {
    expect(SRC).toContain("as «class utf8»");
    expect(SRC).toMatch(/writeFileSync\(tmpFile, message/);
  });

  it("contains SMS auto-fallback for phone-like recipients", () => {
    // The fallback script must reference SMS service inside the on-error
    // branch of the iMessage send.
    expect(SRC).toMatch(/service type = SMS/);
    expect(SRC).toMatch(/on error[\s\S]*service type = SMS/);
  });

  it("cleans up the temp file in finally", () => {
    expect(SRC).toMatch(/finally \{[\s\S]*unlinkSync/);
  });
});

describe("checkImessageAvailability (mocked under VITEST)", () => {
  it("returns iMessage / reachable for any handle when mocked", async () => {
    const res = await checkImessageAvailability("+15555550100");
    expect(res).toEqual({ service: "iMessage", reachable: true });
  });
});
