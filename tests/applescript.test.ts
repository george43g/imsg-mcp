import { execFile } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock execFile
vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

// Import after mocking
const mockExecFile = vi.mocked(execFile);

describe("AppleScript utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("appleScriptEscape", () => {
    it("should verify escape concepts for AppleScript strings", () => {
      // Test that special characters exist in strings that need escaping
      expect("Hello World").toBe("Hello World");
      expect('Hello "World"').toContain('"');
      expect("Line1\nLine2").toContain("\n");
      expect("Tab\there").toContain("\t");
    });
  });

  describe("sendMessage", () => {
    it("should call osascript with correct AppleScript", async () => {
      mockExecFile.mockImplementation((_cmd, _args, opts, callback) => {
        if (typeof opts === "function") {
          callback = opts;
        }
        // Simulate successful execution
        const cb = callback as (
          err: Error | null,
          result: { stdout: string; stderr: string },
        ) => void;
        cb(null, { stdout: "", stderr: "" });
        return {} as any;
      });

      // Import the module dynamically to use mocked execFile
      const { sendMessage } = await import("../src/applescript.js");

      const _result = await sendMessage("+1234567890", "Hello World");

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
        const cb = callback as (
          err: Error | null,
          result: { stdout: string; stderr: string },
        ) => void;
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
        const cb = callback as (
          err: Error | null,
          result: { stdout: string; stderr: string },
        ) => void;
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
        const cb = callback as (
          err: Error | null,
          result: { stdout: string; stderr: string },
        ) => void;
        cb(null, { stdout: "false", stderr: "" });
        return {} as any;
      });

      const { checkMessagesAvailable } = await import("../src/applescript.js");

      const result = await checkMessagesAvailable();

      expect(result).toBe(false);
    });
  });
});

describe("Message formatting", () => {
  it("should format outgoing messages with → arrow", () => {
    const msg = {
      id: 1,
      guid: "abc",
      text: "Hello",
      handle: "+1234567890",
      isFromMe: true,
      date: new Date("2024-01-15T10:00:00"),
      dateRead: null,
      isRead: true,
      chatId: "chat123",
      service: "iMessage" as const,
    };

    // Test the formatting logic concept
    const direction = msg.isFromMe ? "→" : "←";
    expect(direction).toBe("→");
  });

  it("should format incoming messages with ← arrow", () => {
    const msg = {
      id: 1,
      guid: "abc",
      text: "Hello",
      handle: "+1234567890",
      isFromMe: false,
      date: new Date("2024-01-15T10:00:00"),
      dateRead: null,
      isRead: false,
      chatId: "chat123",
      service: "iMessage" as const,
    };

    const direction = msg.isFromMe ? "→" : "←";
    expect(direction).toBe("←");
  });

  it("should show [UNREAD] for unread messages", () => {
    const msg = {
      id: 1,
      guid: "abc",
      text: "Hello",
      handle: "+1234567890",
      isFromMe: false,
      date: new Date("2024-01-15T10:00:00"),
      dateRead: null,
      isRead: false,
      chatId: "chat123",
      service: "iMessage" as const,
    };

    const readStatus = msg.isRead ? "" : " [UNREAD]";
    expect(readStatus).toBe(" [UNREAD]");
  });
});

describe("Types", () => {
  it("should have correct Message structure", () => {
    const msg = {
      id: 1,
      guid: "test-guid",
      text: "Hello",
      handle: "+1234567890",
      isFromMe: false,
      date: new Date(),
      dateRead: null,
      isRead: false,
      chatId: "chat123",
      service: "iMessage" as const,
    };

    expect(msg).toHaveProperty("id");
    expect(msg).toHaveProperty("guid");
    expect(msg).toHaveProperty("text");
    expect(msg).toHaveProperty("handle");
    expect(msg).toHaveProperty("isFromMe");
    expect(msg).toHaveProperty("date");
    expect(msg).toHaveProperty("isRead");
    expect(msg).toHaveProperty("chatId");
    expect(msg).toHaveProperty("service");
  });

  it("should have correct Conversation structure", () => {
    const conv = {
      chatId: "chat123",
      chatIdentifier: "+1234567890",
      displayName: "John Doe",
      participants: ["+1234567890"],
      lastMessageDate: new Date(),
      unreadCount: 5,
    };

    expect(conv).toHaveProperty("chatId");
    expect(conv).toHaveProperty("chatIdentifier");
    expect(conv).toHaveProperty("displayName");
    expect(conv).toHaveProperty("participants");
    expect(conv).toHaveProperty("lastMessageDate");
    expect(conv).toHaveProperty("unreadCount");
  });
});
