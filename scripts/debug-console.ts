#!/usr/bin/env node
/**
 * User-friendly debug console for imsg-mcp: interactive REPL to send/receive
 * messages and call MCP tools with helpful prompts and readable output.
 *
 * Run: pnpm debug
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";

const __dirname = dirname(process.argv[1] ?? ".");
const root = join(__dirname, "..");

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

const HELP = `
${cyan("imsg-mcp debug console")} — send and receive messages, call tools

  ${green("send")} <recipient> <message>     Send iMessage/SMS (e.g. send +15555550100 "Hello")
  ${green("messages")} [chat] [limit]        Get recent messages (optional chat, default limit 20)
  ${green("unread")}                         Get all unread messages
  ${green("conversations")} [limit]          List chats with last message snippet (default 20)
  ${green("search")} <query> [limit]         Search message text (default 20 results)
  ${green("wait")} <chat> [seconds]          Wait for a reply in a chat (default 60s)
  ${green("tools")}                          List available MCP tools
  ${green("raw")} <json>                     Send raw JSON-RPC (for debugging)
  ${green("help")}                           Show this message
  ${green("quit")} / ${green("exit")}                        Exit

Examples:
  send +15555550100 "Test from debug console"
  messages +15555550100 10
  conversations 5
  search "meeting tomorrow"
  wait +15555550100 120
`.trim();

function log(msg: string, style: "dim" | "ok" | "warn" | "err" = "dim") {
  const fn = style === "ok" ? green : style === "warn" ? yellow : style === "err" ? red : dim;
  console.log(fn(msg));
}

/** Wraps the MCP server process and provides a simple API + friendly console output. */
class DebugConsole {
  private proc: ReturnType<typeof spawn>;
  private requestId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private outBuf = "";

  constructor() {
const distIndex = join(root, "dist", "index.js");
if (!existsSync(distIndex)) {
  console.error("Run pnpm build first. dist/index.js not found.");
  process.exit(1);
}
const cmd = ["node", distIndex];

    this.proc = spawn(cmd[0], cmd.slice(1), { cwd: root, stdio: ["pipe", "pipe", "pipe"] });

    this.proc.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(dim("[server] ") + chunk.toString("utf8"));
    });

    this.proc.stdout.on("data", (chunk: Buffer) => {
      this.outBuf += chunk.toString("utf8");
      const lines = this.outBuf.split("\n");
      this.outBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id != null && this.pending.has(msg.id)) {
            const { resolve } = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            resolve(msg);
          }
        } catch {
          // ignore non-JSON
        }
      }
    });

    this.proc.on("error", (err) => {
      log(`Server error: ${err.message}`, "err");
      process.exit(1);
    });
    this.proc.on("exit", (code) => {
      if (code != null && code !== 0) process.exit(code);
    });
  }

  private call(method: string, params: object, timeoutMs = 15000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pending.set(id, { resolve, reject });
      const req = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      this.proc.stdin.write(req + "\n");
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Request timeout (${timeoutMs}ms). Is the server running?`));
        }
      }, timeoutMs);
    });
  }

  /** Run the MCP handshake (initialize + notified). Call once before using tools. */
  async start(): Promise<void> {
    const res = await this.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "debug-console", version: "1.0.0" },
    }) as { result?: unknown };
    if (res.result) {
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
    }
  }

  private async callTool(name: string, args: object): Promise<{ content?: { type: string; text?: string }[]; isError?: boolean }> {
    const res = await this.call("tools/call", { name, arguments: args }) as {
      result?: { content?: { type: string; text?: string }[]; isError?: boolean };
      error?: { message: string };
    };
    if (res.error) throw new Error(res.error.message);
    return res.result ?? {};
  }

  async sendMessage(recipient: string, message: string): Promise<void> {
    log(`Sending to ${recipient}...`, "dim");
    const out = await this.callTool("send_message", { recipient, message });
    const text = out.content?.[0]?.text ?? JSON.stringify(out);
    if (out.isError) {
      log(text, "err");
      return;
    }
    log(text, "ok");
  }

  async getMessages(chatIdentifier?: string, limit = 20): Promise<void> {
    log(chatIdentifier ? `Fetching messages for ${chatIdentifier}...` : "Fetching recent messages...", "dim");
    const out = await this.callTool("get_messages", { limit, ...(chatIdentifier && { chatIdentifier }) });
    const text = out.content?.[0]?.text ?? JSON.stringify(out);
    if (out.isError) {
      log(text, "err");
      return;
    }
    log(text, "ok");
  }

  async getUnread(): Promise<void> {
    log("Fetching unread messages...", "dim");
    const out = await this.callTool("get_unread_messages", {});
    const text = out.content?.[0]?.text ?? JSON.stringify(out);
    if (out.isError) {
      log(text, "err");
      return;
    }
    log(text, "ok");
  }

  async listConversations(limit = 20): Promise<void> {
    log(`Listing up to ${limit} conversations...`, "dim");
    const out = await this.callTool("list_conversations", { limit });
    const text = out.content?.[0]?.text ?? JSON.stringify(out);
    if (out.isError) {
      log(text, "err");
      return;
    }
    log(text, "ok");
  }

  async searchMessages(query: string, limit = 20): Promise<void> {
    log(`Searching for "${query}"...`, "dim");
    const out = await this.callTool("search_messages", { query, limit });
    const text = out.content?.[0]?.text ?? JSON.stringify(out);
    if (out.isError) {
      log(text, "err");
      return;
    }
    log(text, "ok");
  }

  async waitForReply(chatIdentifier: string, timeoutSeconds = 60): Promise<void> {
    log(`Waiting for reply from ${chatIdentifier} (${timeoutSeconds}s)...`, "dim");
    const out = await this.callTool("wait_for_reply", {
      chatIdentifier,
      timeoutSeconds,
      pollIntervalSeconds: 10,
    });
    const text = out.content?.[0]?.text ?? JSON.stringify(out);
    if (out.isError) {
      log(text, "err");
      return;
    }
    log(text, "ok");
  }

  async listTools(): Promise<void> {
    log("Fetching tools...", "dim");
    const res = await this.call("tools/list", {}) as { result?: { tools?: { name: string; description?: string }[] }; error?: { message: string } };
    if (res.error) {
      log(res.error.message, "err");
      return;
    }
    const tools = res.result?.tools ?? [];
    if (tools.length === 0) {
      log("No tools returned.", "warn");
      return;
    }
    log(`Available tools (${tools.length}):`, "ok");
    for (const t of tools) {
      console.log(`  ${green(t.name)} ${dim(t.description ?? "")}`);
    }
  }

  async sendRaw(jsonStr: string): Promise<void> {
    try {
      const obj = JSON.parse(jsonStr);
      const res = await this.call(obj.method ?? "tools/call", obj.params ?? obj.arguments ?? {});
      console.log(JSON.stringify(res, null, 2));
    } catch (e) {
      log(String(e), "err");
    }
  }

  close(): void {
    this.proc.stdin.end();
  }
}

function parseArgs(line: string): { cmd: string; args: string[] } {
  const parts: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' || c === "'") {
      inQuote = !inQuote;
    } else if ((c === " " && !inQuote) || c === "\n") {
      if (cur) parts.push(cur), (cur = "");
    } else {
      cur += c;
    }
  }
  if (cur) parts.push(cur);
  const cmd = parts[0]?.toLowerCase() ?? "";
  const args = parts.slice(1);
  return { cmd, args };
}

async function main(): Promise<void> {
  console.log(HELP);
  console.log("");
  log("Starting MCP server...", "dim");

  const dc = new DebugConsole();

  await dc.start();
  log("Server ready. Enter a command (help for usage).", "ok");
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => rl.question(cyan("imsg-mcp> "), async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      prompt();
      return;
    }

    const { cmd, args } = parseArgs(trimmed);

    try {
      switch (cmd) {
        case "send":
          if (args.length >= 2) {
            const msg = args.slice(1).join(" ").replace(/^["']|["']$/g, "");
            await dc.sendMessage(args[0], msg);
          } else {
            log("Usage: send <recipient> <message>", "warn");
          }
          break;
        case "messages":
        case "msg":
          await dc.getMessages(args[0], args[1] ? parseInt(args[1], 10) : 20);
          break;
        case "unread":
          await dc.getUnread();
          break;
        case "conversations":
        case "convs":
        case "list":
          await dc.listConversations(args[0] ? parseInt(args[0], 10) : 20);
          break;
        case "search":
          if (args[0]) await dc.searchMessages(args[0], args[1] ? parseInt(args[1], 10) : 20);
          else log("Usage: search <query> [limit]", "warn");
          break;
        case "wait":
          if (args[0]) await dc.waitForReply(args[0], args[1] ? parseInt(args[1], 10) : 60);
          else log("Usage: wait <chatIdentifier> [timeoutSeconds]", "warn");
          break;
        case "tools":
          await dc.listTools();
          break;
        case "raw": {
          const rest = trimmed.slice(cmd.length).trim();
          if (rest) await dc.sendRaw(rest);
          else log("Usage: raw <json string>", "warn");
          break;
        }
        case "help":
        case "?":
          console.log(HELP);
          break;
        case "quit":
        case "exit":
        case "q":
          log("Bye.", "dim");
          dc.close();
          process.exit(0);
        default:
          log(`Unknown command: ${cmd}. Type 'help' for usage.`, "warn");
      }
    } catch (e) {
      log(String(e), "err");
    }

    console.log("");
    prompt();
  });

  prompt();
}

main().catch((e) => {
  log(String(e), "err");
  process.exit(1);
});
