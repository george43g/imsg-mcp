/**
 * Regression test: attachment open uses macOS Quick Look (qlmanage -p) for
 * non-video attachments, with mpv preferred for video. The previous in-terminal
 * image preview path (terminal-image.ts displayImage()) was dead code and
 * relied on terminal-graphics protocols that don't work reliably in kitty;
 * the rewrite goes through Quick Look instead.
 *
 * Source-grep guards against future regressions back to a dead-code path.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const APP_SRC = readFileSync(resolve(__dirname, "../src/tui/App.tsx"), "utf8");

describe("attachment preview path", () => {
  it("uses qlmanage -p for non-video attachments", () => {
    expect(APP_SRC).toContain('"qlmanage"');
    expect(APP_SRC).toContain('"-p"');
  });

  it("uses mpv for video with qlmanage fallback", () => {
    // mpv spawn with on('error') fallback to qlmanage
    expect(APP_SRC).toMatch(/spawn\("mpv"/);
    expect(APP_SRC).toMatch(/child\.on\("error", spawnQuickLook\)/);
  });

  it("does not reference the deleted terminal-image module", () => {
    expect(APP_SRC).not.toContain("terminal-image");
    expect(APP_SRC).not.toContain("displayImage");
    expect(existsSync(resolve(__dirname, "../src/tui/terminal-image.ts"))).toBe(false);
  });
});
