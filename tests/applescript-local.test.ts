import { execFile } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Exercises the real AppleScript branch (MOCK=false) with `execFile` stubbed.
 * Only runs when `VITE_ENV=local` — use `pnpm test:local` on macOS with `.env.local`.
 * Excluded from default `pnpm test` (ai + `.env.ai`) so CI/Linux does not load this file.
 */

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockExecFile = vi.mocked(execFile);

describe("AppleScript send path (VITE_ENV=local)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("sendMessage", () => {
    it("should call osascript with correct AppleScript", async () => {
      mockExecFile.mockImplementation((_cmd, _args, opts, callback) => {
        if (typeof opts === "function") {
          callback = opts;
        }
        const cb = callback as (...args: unknown[]) => void;
        cb(null, { stdout: "", stderr: "" });
        return {} as any;
      });

      const { sendMessage } = await import("../src/applescript.js");

      await sendMessage("+1234567890", "Hello World");

      expect(mockExecFile).toHaveBeenCalledWith(
        "osascript",
        expect.arrayContaining(["-e"]),
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("should return success: false on AppleScript error", async () => {
      mockExecFile.mockImplementation((_cmd, _args, opts, callback) => {
        if (typeof opts === "function") {
          callback = opts;
        }
        const cb = callback as (...args: unknown[]) => void;
        const error = new Error("AppleScript error") as any;
        error.stderr = "Messages got an error: No buddy found";
        cb(error, { stdout: "", stderr: "" });
        return {} as any;
      });

      const { sendMessage } = await import("../src/applescript.js");

      const result = await sendMessage("+1234567890", "Hello World");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("checkMessagesAvailable", () => {
    it("should return true when Messages.app exists", async () => {
      mockExecFile.mockImplementation((_cmd, _args, opts, callback) => {
        if (typeof opts === "function") {
          callback = opts;
        }
        const cb = callback as (...args: unknown[]) => void;
        cb(null, { stdout: "true", stderr: "" });
        return {} as any;
      });

      const { checkMessagesAvailable } = await import("../src/applescript.js");

      const result = await checkMessagesAvailable();

      expect(result).toBe(true);
    });

    it("should return false when Messages.app is not available", async () => {
      mockExecFile.mockImplementation((_cmd, _args, opts, callback) => {
        if (typeof opts === "function") {
          callback = opts;
        }
        const cb = callback as (...args: unknown[]) => void;
        cb(null, { stdout: "false", stderr: "" });
        return {} as any;
      });

      const { checkMessagesAvailable } = await import("../src/applescript.js");

      const result = await checkMessagesAvailable();

      expect(result).toBe(false);
    });
  });
});
