import readline from "node:readline";
import { checkLocalAccess, formatAccessReport } from "./access-check.js";
import { getContactsDbPaths, getImsgDbPath, getSlugsDbPath } from "./config.js";
import { IMessageDB } from "./imessage-db.js";
import { APP_NAME, APP_VERSION } from "./meta.js";
import type { Conversation, Message } from "./types.js";

type FocusPane = "sidebar" | "thread";

function relativeDate(date: Date | null): string {
  if (!date) return "";
  const now = new Date();
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function wrap(text: string, width: number): string[] {
  if (width <= 4) return [text.slice(0, Math.max(width, 1))];
  const lines: string[] = [];
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

function padRight(text: string, width: number): string {
  return text.length >= width ? text : `${text}${" ".repeat(width - text.length)}`;
}

function ansi(code: string, text: string): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}

export async function runTui(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("The TUI requires an interactive terminal (TTY).");
  }

  const report = await checkLocalAccess();
  if (!report.ok) {
    console.log(formatAccessReport(report));
    process.exit(1);
  }

  const app = new ImsgTui();
  await app.start();
}

class ImsgTui {
  private readonly db = new IMessageDB(getImsgDbPath(), getContactsDbPaths(), getSlugsDbPath());
  private conversations: Conversation[] = [];
  private messages: Message[] = [];
  private selectedConversation = 0;
  private focus: FocusPane = "sidebar";
  private sidebarScroll = 0;
  private messageScroll = 0;
  private loading = false;
  private status = "Loading conversations...";

  async start(): Promise<void> {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdout.write("\x1b[?1049h\x1b[?25l");

    process.stdin.on("keypress", this.onKeypress);
    process.on("SIGINT", this.shutdown);
    process.on("SIGTERM", this.shutdown);
    process.on("SIGWINCH", this.onResize);

    await this.refreshAll();
  }

  private onKeypress = async (_: string, key: readline.Key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      await this.shutdown();
      return;
    }

    if (key.name === "tab") {
      this.focus = this.focus === "sidebar" ? "thread" : "sidebar";
      this.status = this.focus === "sidebar" ? "Sidebar focus" : "Thread focus";
      this.render();
      return;
    }

    if (key.name === "r") {
      await this.refreshAll();
      return;
    }

    if (this.loading) return;

    if (this.focus === "sidebar") {
      if (key.name === "down" || key.name === "j") {
        await this.moveConversation(1);
      } else if (key.name === "up" || key.name === "k") {
        await this.moveConversation(-1);
      }
      return;
    }

    if (key.name === "down" || key.name === "j") {
      this.messageScroll = Math.min(this.messageScroll + 1, Math.max(this.threadLines().length - 1, 0));
      this.render();
      return;
    }
    if (key.name === "up" || key.name === "k") {
      this.messageScroll = Math.max(this.messageScroll - 1, 0);
      this.render();
      return;
    }
    if (key.name === "pagedown") {
      this.messageScroll = Math.min(this.messageScroll + 10, Math.max(this.threadLines().length - 1, 0));
      this.render();
      return;
    }
    if (key.name === "pageup") {
      this.messageScroll = Math.max(this.messageScroll - 10, 0);
      this.render();
    }
  };

  private async moveConversation(delta: number): Promise<void> {
    if (this.conversations.length === 0) return;
    this.selectedConversation = Math.max(
      0,
      Math.min(this.selectedConversation + delta, this.conversations.length - 1),
    );
    await this.loadSelectedMessages();
  }

  private async refreshAll(): Promise<void> {
    this.loading = true;
    this.status = "Refreshing...";
    this.render();

    const previousSlug = this.conversations[this.selectedConversation]?.threadSlug;
    this.conversations = await this.db.listConversations(200);

    if (previousSlug) {
      const nextIndex = this.conversations.findIndex((conversation) => conversation.threadSlug === previousSlug);
      if (nextIndex >= 0) this.selectedConversation = nextIndex;
    }
    if (this.selectedConversation >= this.conversations.length) {
      this.selectedConversation = Math.max(this.conversations.length - 1, 0);
    }

    await this.loadSelectedMessages();
    this.loading = false;
    this.status = "Ready. Tab switches panes, arrows/jk move, r refresh, q quit.";
    this.render();
  }

  private async loadSelectedMessages(): Promise<void> {
    const selected = this.conversations[this.selectedConversation];
    if (!selected) {
      this.messages = [];
      this.render();
      return;
    }

    this.loading = true;
    this.status = `Loading ${selected.displayName ?? selected.chatIdentifier}...`;
    this.render();

    this.messages = await this.db.getMessagesForChat(selected.chatIdentifier, 200);
    this.messageScroll = Math.max(this.threadLines().length - this.threadBodyHeight(), 0);
    this.loading = false;
    this.status = `${selected.displayName ?? selected.chatIdentifier} loaded.`;
    this.render();
  }

  private sidebarLines(width: number, height: number): string[] {
    const lines: string[] = [];
    for (const conversation of this.conversations) {
      const name = truncate(conversation.displayName ?? conversation.chatIdentifier, Math.max(width - 12, 8));
      const time = relativeDate(conversation.lastMessageDate);
      const unread = conversation.unreadCount > 0 ? ` (${conversation.unreadCount})` : "";
      lines.push(`${name}${unread}`);
      lines.push(
        truncate(
          `${conversation.lastMessageSnippet ?? ""}${time ? `  ${time}` : ""}`,
          Math.max(width - 1, 1),
        ),
      );
      lines.push("");
    }

    const visibleRows = height - 4;
    const selectedRow = this.selectedConversation * 3;
    if (selectedRow < this.sidebarScroll) {
      this.sidebarScroll = selectedRow;
    } else if (selectedRow >= this.sidebarScroll + visibleRows) {
      this.sidebarScroll = selectedRow - visibleRows + 3;
    }

    return lines.slice(this.sidebarScroll, this.sidebarScroll + visibleRows);
  }

  private threadBodyHeight(): number {
    return Math.max((process.stdout.rows ?? 40) - 6, 5);
  }

  private threadLines(): string[] {
    const selected = this.conversations[this.selectedConversation];
    const width = Math.max((process.stdout.columns ?? 120) - this.sidebarWidth() - 5, 20);
    const lines: string[] = [];

    if (!selected) {
      return ["No conversation selected."];
    }

    for (const message of this.messages) {
      const who = message.isFromMe ? "me" : selected.displayName ?? selected.chatIdentifier;
      const prefix = message.isFromMe ? ">" : "<";
      const header = `${prefix} ${who}  ${message.date.toLocaleString()}`;
      lines.push(header);
      if (message.isReply && message.replyTo?.replyToText) {
        lines.push(`  reply: ${truncate(message.replyTo.replyToText, width - 2)}`);
      }
      for (const wrapped of wrap(message.text ?? "(no text)", width - 2)) {
        lines.push(`  ${wrapped}`);
      }
      lines.push("");
    }

    return lines;
  }

  private sidebarWidth(): number {
    return Math.max(Math.floor((process.stdout.columns ?? 120) * 0.38), 28);
  }

  private render(): void {
    const columns = process.stdout.columns ?? 120;
    const rows = process.stdout.rows ?? 40;
    const sidebarWidth = this.sidebarWidth();
    const threadWidth = Math.max(columns - sidebarWidth - 3, 20);
    const selected = this.conversations[this.selectedConversation];
    const threadLines = this.threadLines();
    const threadVisible = threadLines.slice(this.messageScroll, this.messageScroll + this.threadBodyHeight());
    const sidebarVisible = this.sidebarLines(sidebarWidth, rows);

    const output: string[] = [];
    output.push("\x1b[H\x1b[2J");
    output.push(
      ansi(
        "1",
        `${APP_NAME.replace("-mcp", "")} TUI ${APP_VERSION}  ${this.loading ? "[loading]" : "[read-only]"}`,
      ),
    );
    output.push(
      `${ansi(this.focus === "sidebar" ? "7" : "0", padRight(" Conversations ", sidebarWidth))} | ${ansi(
        this.focus === "thread" ? "7" : "0",
        padRight(` ${selected?.displayName ?? selected?.chatIdentifier ?? "Thread"} `, threadWidth),
      )}`,
    );

    const bodyRows = rows - 5;
    for (let index = 0; index < bodyRows; index += 1) {
      const left = padRight(sidebarVisible[index] ?? "", sidebarWidth);
      const right = padRight(threadVisible[index] ?? "", threadWidth);
      const isSelectedRow = index + this.sidebarScroll === this.selectedConversation * 3;
      output.push(`${isSelectedRow ? ansi("7", left) : left} | ${right}`);
    }

    output.push("-".repeat(columns));
    output.push(truncate(this.status, columns));
    output.push("Tab: focus  Up/Down or j/k: move  PgUp/PgDn: scroll thread  r: refresh  q: quit");

    process.stdout.write(output.join("\n"));
  }

  private onResize = () => {
    this.render();
  };

  private shutdown = async () => {
    process.stdin.off("keypress", this.onKeypress);
    process.off("SIGWINCH", this.onResize);
    process.stdout.write("\x1b[?25h\x1b[?1049l");
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    await this.db.close();
    process.exit(0);
  };
}

if (process.argv[1]?.endsWith("tui.js")) {
  runTui().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
