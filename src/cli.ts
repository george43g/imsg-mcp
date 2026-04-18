import { createInterface } from "node:readline";
import { Command } from "commander";
import { checkLocalAccess, formatAccessReport } from "./access-check.js";
import { LocalMcpClient } from "./mcp-client.js";
import { APP_NAME, APP_VERSION } from "./meta.js";

// ── Colour helpers ─────────────────────────────────────────────────────

const color = {
  dim: (v: string) => `\x1b[2m${v}\x1b[0m`,
  cyan: (v: string) => `\x1b[36m${v}\x1b[0m`,
  green: (v: string) => `\x1b[32m${v}\x1b[0m`,
  yellow: (v: string) => `\x1b[33m${v}\x1b[0m`,
  red: (v: string) => `\x1b[31m${v}\x1b[0m`,
};

function log(message: string, style: "dim" | "ok" | "warn" | "err" = "dim") {
  const fn =
    style === "ok" ? color.green : style === "warn" ? color.yellow : style === "err" ? color.red : color.dim;
  console.log(fn(message));
}

// ── MCP client helpers ─────────────────────────────────────────────────

function looksLikeThreadSlug(value: string | undefined): boolean {
  return Boolean(value?.includes("~"));
}

async function withClient<T>(run: (client: LocalMcpClient) => Promise<T>): Promise<T> {
  const client = new LocalMcpClient((line) => process.stderr.write(color.dim(`[server] ${line}`)));
  try {
    await client.start();
    return await run(client);
  } finally {
    client.close();
  }
}

async function printToolResult(client: LocalMcpClient, name: string, args: object, timeoutMs?: number) {
  const result = await client.callTool(name, args, timeoutMs);
  const text = result.content?.[0]?.text ?? JSON.stringify(result, null, 2);
  if (result.isError) throw new Error(text);
  console.log(text);
}

// ── Interactive console ────────────────────────────────────────────────

function parseConsoleInput(line: string): { cmd: string; args: string[] } {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (const char of line) {
    if ((char === '"' || char === "'") && quote == null) { quote = char; continue; }
    if (char === quote) { quote = null; continue; }
    if (char === " " && quote == null) {
      if (current) { parts.push(current); current = ""; }
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return { cmd: parts[0]?.toLowerCase() ?? "", args: parts.slice(1) };
}

async function runConsoleCommand(cmd: string, args: string[], client: LocalMcpClient): Promise<void> {
  switch (cmd) {
    case "conversations":
    case "list":
      await printToolResult(client, "list_conversations", { limit: Number(args[0] ?? 20) });
      return;
    case "messages":
    case "msg": {
      const first = args[0];
      const firstIsLimit = first != null && /^\d+$/.test(first);
      const chatIdentifier = firstIsLimit ? undefined : first;
      const limit = Number(firstIsLimit ? first : (args[1] ?? 20));
      await printToolResult(client, "get_messages", {
        ...(chatIdentifier
          ? looksLikeThreadSlug(chatIdentifier) ? { threadSlug: chatIdentifier } : { chatIdentifier }
          : {}),
        limit,
      });
      return;
    }
    case "unread":
      await printToolResult(client, "get_unread_messages", args[0] ? { limit: Number(args[0]) } : {});
      return;
    case "search":
      if (!args[0]) throw new Error("Usage: search <query> [limit]");
      await printToolResult(client, "search_messages", { query: args[0], limit: Number(args[1] ?? 20) });
      return;
    case "wait":
      if (!args[0]) throw new Error("Usage: wait <chat> [timeoutSeconds]");
      await printToolResult(
        client,
        "wait_for_reply",
        {
          ...(looksLikeThreadSlug(args[0]) ? { threadSlug: args[0] } : { chatIdentifier: args[0] }),
          timeoutSeconds: Number(args[1] ?? 60),
          pollIntervalSeconds: 5,
        },
        70_000,
      );
      return;
    case "send":
      if (args.length < 2) throw new Error("Usage: send <target> <message>");
      await printToolResult(client, "send_message", {
        ...(looksLikeThreadSlug(args[0]) ? { threadSlug: args[0] } : { recipient: args[0] }),
        message: args.slice(1).join(" "),
      });
      return;
    case "logs":
      await printToolResult(client, "get_logs", args[0] ? { tail: Number(args[0]) } : {});
      return;
    case "last-error":
    case "lasterror":
      await printToolResult(client, "get_last_send_error", {});
      return;
    case "tools":
      for (const tool of await client.listTools()) {
        console.log(`${tool.name}${tool.description ? ` - ${tool.description}` : ""}`);
      }
      return;
    case "raw":
      if (!args[0]) throw new Error("Usage: raw '<json>'");
      {
        const parsed = JSON.parse(args.join(" ")) as { name?: string; arguments?: object };
        if (!parsed.name) throw new Error('Expected JSON like {"name":"tool_name","arguments":{...}}.');
        await printToolResult(client, parsed.name, parsed.arguments ?? {});
      }
      return;
    case "tui": {
      const { runTui } = await import("./tui.js");
      await runTui();
      return;
    }
    case "help":
    case "?":
      console.log(CONSOLE_HELP);
      return;
    case "quit":
    case "exit":
      process.exit(0);
    default:
      throw new Error(`Unknown command: ${cmd}. Type "help" for available commands.`);
  }
}

const CONSOLE_HELP = `
Available commands:
  conversations [n]    List recent conversations (default 20)
  messages [chat] [n]  Show recent messages
  unread [n]           Show unread messages
  search <query> [n]   Search messages
  wait <chat> [secs]   Wait for a reply (default 60s)
  send <target> <msg>  Send a message
  logs [tail]          Show server debug logs
  last-error           Show last send failure
  tools                List available MCP tools
  raw <json>           Send raw JSON-RPC to tools/call
  tui                  Launch the read-only TUI
  help                 Show this help
  quit                 Exit
`.trim();

async function runInteractiveConsole(): Promise<void> {
  log("Starting local MCP server...", "dim");
  const client = new LocalMcpClient((line) => process.stderr.write(color.dim(`[server] ${line}`)));
  await client.start();
  log("Console ready. Type help for commands.\n", "ok");

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () =>
    rl.question(color.cyan("imsg> "), async (line) => {
      const trimmed = line.trim();
      if (!trimmed) { prompt(); return; }

      const { cmd, args } = parseConsoleInput(trimmed);
      try {
        await runConsoleCommand(cmd, args, client);
      } catch (error) {
        log(error instanceof Error ? error.message : String(error), "err");
      }
      console.log("");
      prompt();
    });

  prompt();

  const shutdown = () => { client.close(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ── CLI program (Commander) ────────────────────────────────────────────

const program = new Command()
  .name("imsg-cli")
  .version(APP_VERSION, "-v, --version")
  .description("CLI for the imsg-mcp iMessage MCP server")
  .addHelpText("after", `
Notes:
  Use "imsg-mcp --doctor" or "imsg-cli doctor" on a new machine.
  The MCP stdio server is the separate "imsg-mcp" binary.
  The read-only TUI is also available as "imsg".`);

program
  .command("console", { isDefault: true })
  .description("Launch interactive console (default when no command given)")
  .action(runInteractiveConsole);

program
  .command("doctor")
  .description("Check local permissions and database access")
  .action(async () => {
    const report = await checkLocalAccess();
    console.log(formatAccessReport(report));
    process.exitCode = report.ok ? 0 : 1;
  });

program
  .command("conversations")
  .alias("list")
  .description("List recent conversations")
  .argument("[limit]", "Number of conversations", "20")
  .action(async (limit: string) => {
    await withClient((c) => printToolResult(c, "list_conversations", { limit: Number(limit) }));
  });

program
  .command("messages")
  .alias("msg")
  .description("Show recent messages from a conversation")
  .argument("[chat]", "Phone number, email, or thread slug")
  .argument("[limit]", "Number of messages", "20")
  .action(async (chat: string | undefined, limit: string) => {
    const firstIsLimit = chat != null && /^\d+$/.test(chat);
    const chatIdentifier = firstIsLimit ? undefined : chat;
    const finalLimit = Number(firstIsLimit ? chat : limit);
    await withClient((c) =>
      printToolResult(c, "get_messages", {
        ...(chatIdentifier
          ? looksLikeThreadSlug(chatIdentifier) ? { threadSlug: chatIdentifier } : { chatIdentifier }
          : {}),
        limit: finalLimit,
      }),
    );
  });

program
  .command("unread")
  .description("Show unread messages across all conversations")
  .argument("[limit]", "Number of messages", "100")
  .action(async (limit: string) => {
    await withClient((c) => printToolResult(c, "get_unread_messages", { limit: Number(limit) }));
  });

program
  .command("search")
  .description("Search messages by text content")
  .argument("<query>", "Search query")
  .argument("[limit]", "Number of results", "20")
  .action(async (query: string, limit: string) => {
    await withClient((c) => printToolResult(c, "search_messages", { query, limit: Number(limit) }));
  });

program
  .command("wait")
  .description("Wait for a reply in a conversation")
  .argument("<chat>", "Phone number, email, or thread slug")
  .argument("[timeout]", "Timeout in seconds", "60")
  .action(async (chat: string, timeout: string) => {
    await withClient((c) =>
      printToolResult(
        c,
        "wait_for_reply",
        {
          ...(looksLikeThreadSlug(chat) ? { threadSlug: chat } : { chatIdentifier: chat }),
          timeoutSeconds: Number(timeout),
          pollIntervalSeconds: 5,
        },
        70_000,
      ),
    );
  });

program
  .command("send")
  .description("Send a message via Messages.app")
  .argument("<target>", "Phone number, email, or thread slug")
  .argument("<message...>", "Message text")
  .action(async (target: string, messageParts: string[]) => {
    await withClient((c) =>
      printToolResult(c, "send_message", {
        ...(looksLikeThreadSlug(target) ? { threadSlug: target } : { recipient: target }),
        message: messageParts.join(" "),
      }),
    );
  });

program
  .command("logs")
  .description("Show server debug logs")
  .argument("[tail]", "Show only last N lines")
  .action(async (tail: string | undefined) => {
    await withClient((c) => printToolResult(c, "get_logs", tail ? { tail: Number(tail) } : {}));
  });

program
  .command("last-error")
  .description("Show last send_message failure details")
  .action(async () => {
    await withClient((c) => printToolResult(c, "get_last_send_error", {}));
  });

program
  .command("tools")
  .description("List available MCP tools")
  .action(async () => {
    await withClient(async (c) => {
      for (const tool of await c.listTools()) {
        console.log(`${tool.name}${tool.description ? ` - ${tool.description}` : ""}`);
      }
    });
  });

program
  .command("raw")
  .description("Send raw JSON-RPC params to tools/call")
  .argument("<json>", 'JSON like {"name":"tool_name","arguments":{...}}')
  .action(async (json: string) => {
    const parsed = JSON.parse(json) as { name?: string; arguments?: object };
    if (!parsed.name) throw new Error('Expected JSON like {"name":"tool_name","arguments":{...}}.');
    await withClient((c) => printToolResult(c, parsed.name!, parsed.arguments ?? {}));
  });

program
  .command("tui")
  .description("Launch the read-only terminal UI")
  .action(async () => {
    const { runTui } = await import("./tui.js");
    await runTui();
  });

// Handle --tui as a global flag for backwards compat
if (process.argv.includes("--tui")) {
  import("./tui.js").then(({ runTui }) => runTui()).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
} else {
  program.parseAsync(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
