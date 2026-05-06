/**
 * Direct MCP tool handler test — bypasses stdio transport, calls handlers
 * directly so we can iterate without restart races.
 */
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface ToolResult {
  content?: { type: string; text?: string }[];
  isError?: boolean;
}

class McpClient {
  private proc: ReturnType<typeof spawn>;
  private requestId = 0;
  private buffer = "";
  private pending = new Map<number, (msg: JsonRpcResponse) => void>();

  constructor(envFile: string) {
    this.proc = spawn(
      "node",
      [`--env-file=${envFile}`, "dist/index.js"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.proc.stdout!.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          if (typeof msg.id === "number") {
            const cb = this.pending.get(msg.id);
            if (cb) {
              this.pending.delete(msg.id);
              cb(msg);
            }
          }
        } catch {
          // ignore
        }
      }
    });
    this.proc.stderr!.on("data", () => {
      // Ignore stderr for now
    });
  }

  async init(): Promise<void> {
    await this.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    this.proc.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  }

  async call(method: string, params: object, timeoutMs = 30_000): Promise<unknown> {
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      });
      this.proc.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async callTool(name: string, args: object): Promise<ToolResult> {
    return this.call("tools/call", { name, arguments: args }) as Promise<ToolResult>;
  }

  close(): void {
    this.proc.stdin!.end();
    this.proc.kill();
  }
}

function checkResult(result: ToolResult, expectations: { hasText?: string[]; isError?: boolean }): boolean {
  if (expectations.isError !== undefined && (result.isError ?? false) !== expectations.isError) {
    return false;
  }
  if (expectations.hasText) {
    const text = result.content?.map((c) => c.text ?? "").join("\n") ?? "";
    for (const expected of expectations.hasText) {
      if (!text.includes(expected)) return false;
    }
  }
  return true;
}

async function main() {
  const envFile = process.argv[2] ?? ".env.test";
  console.log(`\x1b[1mMCP tool integration test\x1b[0m`);
  console.log(`Env file: ${envFile}`);
  console.log(`Engine: ${process.env.IMSG_DISABLE_NATIVE === "1" ? "TS (forced)" : "auto"}`);

  const client = new McpClient(envFile);
  await client.init();

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  const test = async (name: string, fn: () => Promise<boolean>) => {
    try {
      const ok = await fn();
      if (ok) {
        console.log(`  \x1b[32m✓\x1b[0m ${name}`);
        passed++;
      } else {
        console.log(`  \x1b[31m✗\x1b[0m ${name}`);
        failures.push(name);
        failed++;
      }
    } catch (e) {
      console.log(`  \x1b[31m✗\x1b[0m ${name} — ${e instanceof Error ? e.message : String(e)}`);
      failures.push(name);
      failed++;
    }
  };

  // Test list_conversations
  await test("list_conversations(20) returns rows", async () => {
    const r = await client.callTool("list_conversations", { limit: 20 });
    return checkResult(r, { hasText: ["conversation"] });
  });

  await test("list_conversations(500) accepts > 50 limit", async () => {
    const r = await client.callTool("list_conversations", { limit: 500 });
    return checkResult(r, { hasText: ["conversation"] });
  });

  await test("list_conversations(501) rejects > 500", async () => {
    const r = await client.callTool("list_conversations", { limit: 501 });
    return r.isError === true;
  });

  // Test get_messages
  await test("get_messages(20) returns recent", async () => {
    const r = await client.callTool("get_messages", { limit: 20 });
    return checkResult(r, { hasText: ["message"] });
  });

  await test("get_messages(1000) accepts large limit", async () => {
    const r = await client.callTool("get_messages", { limit: 1000 });
    return checkResult(r, { hasText: ["message"] });
  });

  await test("get_messages(1001) rejects > 1000", async () => {
    const r = await client.callTool("get_messages", { limit: 1001 });
    return r.isError === true;
  });

  // Test response includes performance metadata
  await test("get_messages response includes engine + query time", async () => {
    const r = await client.callTool("get_messages", { limit: 5 });
    return checkResult(r, { hasText: ["Engine:", "Query:"] });
  });

  // Test get_unread_messages
  await test("get_unread_messages works", async () => {
    const r = await client.callTool("get_unread_messages", {});
    return r.content !== undefined;
  });

  // Test search_messages
  await test("search_messages works", async () => {
    const r = await client.callTool("search_messages", { query: "the", limit: 5 });
    return r.content !== undefined;
  });

  await test("search_messages(500) accepts large limit", async () => {
    const r = await client.callTool("search_messages", { query: "the", limit: 500 });
    return r.content !== undefined;
  });

  // Test get_logs with all sources
  await test("get_logs(memory) works", async () => {
    const r = await client.callTool("get_logs", { source: "memory", tail: 10 });
    return checkResult(r, { hasText: ["Memory"] });
  });

  await test("get_logs(file) works", async () => {
    const r = await client.callTool("get_logs", { source: "file", tail: 10 });
    return checkResult(r, { hasText: ["File"] });
  });

  await test("get_logs(all) works", async () => {
    const r = await client.callTool("get_logs", { source: "all", tail: 5 });
    return checkResult(r, { hasText: ["Memory", "File"] });
  });

  // Test specific thread fetch (the one that used to hang)
  await test("get_messages for jed (was hanging) — completes < 3s", async () => {
    const start = Date.now();
    const r = await client.callTool("get_messages", { chatIdentifier: "+15555550102", limit: 100 });
    const ms = Date.now() - start;
    return ms < 3000 && checkResult(r, { hasText: ["message"] });
  });

  console.log(`\n\x1b[1mResults:\x1b[0m ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log("  -", f);
  }

  client.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
