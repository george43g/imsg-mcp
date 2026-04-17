import { createInterface } from "node:readline";
import { checkLocalAccess, formatAccessReport } from "./access-check.js";
import { LocalMcpClient } from "./mcp-client.js";
import { APP_NAME, APP_VERSION } from "./meta.js";

const HELP = `
${APP_NAME} CLI

Usage:
  imsg-cli                     Interactive console
  imsg-cli console             Interactive console
  imsg-cli doctor              Check local permissions and setup
  imsg-cli conversations [n]   List recent conversations
  imsg-cli messages [chat] [n] Show recent messages
  imsg-cli unread [n]          Show unread messages
  imsg-cli search <query> [n]  Search messages
  imsg-cli wait <chat> [secs]  Wait for a reply
  imsg-cli send <target> <msg> Send a message
  imsg-cli logs [tail]         Show server logs
  imsg-cli last-error          Show last send failure
  imsg-cli tools               List MCP tools
  imsg-cli raw <json>          Send raw JSON-RPC params to tools/call
  imsg-cli tui                 Launch the TUI
  imsg-cli --tui              Launch the TUI

Global flags:
  --help      Show help
  --version   Show version

Notes:
  - Use ${APP_NAME} --doctor or imsg-cli doctor on a new machine before expecting live reads.
  - Use the separate ${APP_NAME} binary as the MCP stdio server.
  - The read-only TUI is also available as the standalone ${APP_NAME.replace("-mcp", "")} command.
`.trim();

const color = {
  dim: (value: string) => `\x1b[2m${value}\x1b[0m`,
  cyan: (value: string) => `\x1b[36m${value}\x1b[0m`,
  green: (value: string) => `\x1b[32m${value}\x1b[0m`,
  yellow: (value: string) => `\x1b[33m${value}\x1b[0m`,
  red: (value: string) => `\x1b[31m${value}\x1b[0m`,
};

function parseArgs(line: string): { cmd: string; args: string[] } {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === '"' || char === "'") && quote == null) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (char === " " && quote == null) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) parts.push(current);
  return { cmd: parts[0]?.toLowerCase() ?? "", args: parts.slice(1) };
}

function log(message: string, style: "dim" | "ok" | "warn" | "err" = "dim") {
  const fn =
    style === "ok"
      ? color.green
      : style === "warn"
        ? color.yellow
        : style === "err"
          ? color.red
          : color.dim;
  console.log(fn(message));
}

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
  if (result.isError) {
    throw new Error(text);
  }
  console.log(text);
}

async function runDoctor(): Promise<number> {
  const report = await checkLocalAccess();
  console.log(formatAccessReport(report));
  return report.ok ? 0 : 1;
}

async function runInteractiveConsole(): Promise<void> {
  console.log(HELP);
  console.log("");
  log("Starting local MCP server...", "dim");

  const client = new LocalMcpClient((line) => process.stderr.write(color.dim(`[server] ${line}`)));
  await client.start();
  log("Console ready. Type help for commands.", "ok");
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () =>
    rl.question(color.cyan("imsg-cli> "), async (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        prompt();
        return;
      }

      const { cmd, args } = parseArgs(trimmed);
      try {
        await runCommand(cmd, args, client);
      } catch (error) {
        log(error instanceof Error ? error.message : String(error), "err");
      }

      console.log("");
      prompt();
    });

  prompt();

  const shutdown = () => {
    client.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function runCommand(cmd: string, args: string[], client?: LocalMcpClient): Promise<void> {
  const runWithClient = async (fn: (activeClient: LocalMcpClient) => Promise<void>) => {
    if (client) {
      await fn(client);
      return;
    }
    await withClient(fn);
  };

  switch (cmd) {
    case "":
    case "console":
      await runInteractiveConsole();
      return;
    case "doctor":
      process.exitCode = await runDoctor();
      return;
    case "conversations":
    case "list":
      await runWithClient((activeClient) =>
        printToolResult(activeClient, "list_conversations", { limit: Number(args[0] ?? 20) }),
      );
      return;
    case "messages":
    case "msg":
      {
        const first = args[0];
        const firstIsLimit = first != null && /^\d+$/.test(first);
        const chatIdentifier = firstIsLimit ? undefined : first;
        const limit = Number(firstIsLimit ? first : (args[1] ?? 20));
        await runWithClient((activeClient) =>
          printToolResult(activeClient, "get_messages", {
            ...(chatIdentifier
              ? looksLikeThreadSlug(chatIdentifier)
                ? { threadSlug: chatIdentifier }
                : { chatIdentifier }
              : {}),
            limit,
          }),
        );
      }
      return;
    case "unread":
      await runWithClient((activeClient) =>
        printToolResult(activeClient, "get_unread_messages", args[0] ? { limit: Number(args[0]) } : {}),
      );
      return;
    case "search":
      if (!args[0]) throw new Error("Usage: imsg-cli search <query> [limit]");
      await runWithClient((activeClient) =>
        printToolResult(activeClient, "search_messages", {
          query: args[0],
          limit: Number(args[1] ?? 20),
        }),
      );
      return;
    case "wait":
      if (!args[0]) throw new Error("Usage: imsg-cli wait <chatIdentifier> [timeoutSeconds]");
      await runWithClient((activeClient) =>
        printToolResult(
          activeClient,
          "wait_for_reply",
          {
            ...(looksLikeThreadSlug(args[0]) ? { threadSlug: args[0] } : { chatIdentifier: args[0] }),
            timeoutSeconds: Number(args[1] ?? 60),
            pollIntervalSeconds: 5,
          },
          70_000,
        ),
      );
      return;
    case "send":
      if (args.length < 2) throw new Error("Usage: imsg-cli send <target> <message>");
      await runWithClient((activeClient) =>
        printToolResult(activeClient, "send_message", {
          ...(looksLikeThreadSlug(args[0]) ? { threadSlug: args[0] } : { recipient: args[0] }),
          message: args.slice(1).join(" "),
        }),
      );
      return;
    case "logs":
      await runWithClient((activeClient) =>
        printToolResult(activeClient, "get_logs", args[0] ? { tail: Number(args[0]) } : {}),
      );
      return;
    case "last-error":
    case "lasterror":
      await runWithClient((activeClient) => printToolResult(activeClient, "get_last_send_error", {}));
      return;
    case "tools":
      await runWithClient(async (activeClient) => {
        const tools = await activeClient.listTools();
        for (const tool of tools) {
          console.log(`${tool.name}${tool.description ? ` - ${tool.description}` : ""}`);
        }
      });
      return;
    case "raw":
      if (!args[0]) throw new Error("Usage: imsg-cli raw '<json>'");
      await runWithClient(async (activeClient) => {
        const parsed = JSON.parse(args.join(" ")) as { name?: string; arguments?: object };
        if (!parsed.name) {
          throw new Error("Expected JSON like {\"name\":\"tool_name\",\"arguments\":{...}}.");
        }
        await printToolResult(activeClient, parsed.name, parsed.arguments ?? {});
      });
      return;
    case "tui": {
      const { runTui } = await import("./tui.js");
      await runTui();
      return;
    }
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    case "--version":
    case "-v":
    case "version":
      console.log(APP_VERSION);
      return;
    case "quit":
    case "exit":
      process.exit(0);
      return;
    default:
      throw new Error(`Unknown command: ${cmd}. Run imsg-cli --help for usage.`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--tui")) {
    const { runTui } = await import("./tui.js");
    await runTui();
    return;
  }

  if (args.length === 0) {
    await runInteractiveConsole();
    return;
  }

  await runCommand(args[0] ?? "", args.slice(1));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
