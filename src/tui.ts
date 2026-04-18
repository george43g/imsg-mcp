import readline from "node:readline";
import { checkLocalAccess, formatAccessReport } from "./access-check.js";
import { sendMessageAlt, sendToChat, sendToChatId } from "./applescript.js";
import { getContactsDbPaths, getImsgDbPath, getSlugsDbPath } from "./config.js";
import { IMessageDB } from "./imessage-db.js";
import { APP_VERSION } from "./meta.js";
import type { Conversation, Message, Reaction, TapbackType } from "./types.js";

// ── True color helpers ─────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";

function fgRgb(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}
function bgRgb(r: number, g: number, b: number): string {
  return `\x1b[48;2;${r};${g};${b}m`;
}

const T = {
  sentFg: fgRgb(255, 255, 255),
  sentBg: bgRgb(25, 130, 252),
  sentBorder: fgRgb(20, 100, 200),
  recvFg: fgRgb(30, 30, 30),
  recvBg: bgRgb(229, 229, 234),
  recvBorder: fgRgb(190, 190, 195),
  pendingFg: fgRgb(180, 180, 185),
  pendingBg: bgRgb(60, 60, 65),
  pendingBorder: fgRgb(80, 80, 85),
  sideSelFg: fgRgb(255, 255, 255),
  sideSelBg: bgRgb(30, 60, 110),
  sideUnread: `${BOLD}${fgRgb(255, 255, 255)}`,
  sideRead: fgRgb(180, 180, 185),
  sideSnippet: fgRgb(120, 120, 125),
  sideSlug: `${ITALIC}${fgRgb(80, 80, 85)}`,
  sideTime: fgRgb(120, 120, 125),
  dot: fgRgb(25, 130, 252),
  border: fgRgb(60, 60, 65),
  hdrFocFg: fgRgb(255, 255, 255),
  hdrFocBg: bgRgb(45, 45, 50),
  hdrDimFg: fgRgb(120, 120, 125),
  hdrDimBg: bgRgb(30, 30, 35),
  infoLabel: fgRgb(150, 150, 155),
  infoVal: fgRgb(210, 210, 215),
  infoSlug: `${ITALIC}${fgRgb(80, 80, 85)}`,
  ts: fgRgb(100, 100, 105),
  statusFg: fgRgb(180, 180, 185),
  statusBg: bgRgb(30, 30, 35),
  statusAccent: fgRgb(25, 130, 252),
  helpKey: fgRgb(180, 180, 185),
  helpDesc: fgRgb(100, 100, 105),
  reply: `${ITALIC}${fgRgb(100, 100, 105)}`,
  smsBadge: fgRgb(90, 200, 90),
  edited: fgRgb(150, 130, 50),
  appName: `${BOLD}${fgRgb(25, 130, 252)}`,
  composeFg: fgRgb(255, 255, 255),
  composeBg: bgRgb(40, 40, 45),
} as const;

// ── String helpers ─────────────────────────────────────────────────────

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function displayWidth(text: string): number {
  return stripAnsi(text).length;
}

function padStyled(text: string, width: number): string {
  const pad = width - displayWidth(text);
  return pad > 0 ? `${text}${" ".repeat(pad)}` : text;
}

function truncPlain(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

function wrap(text: string, width: number): string[] {
  if (width <= 4) return [text.slice(0, Math.max(width, 1))];
  const lines: string[] = [];
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  let current = "";
  for (const word of words) {
    if (!current) { current = word; continue; }
    if (`${current} ${word}`.length <= width) { current = `${current} ${word}`; continue; }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

// ── Box drawing ────────────────────────────────────────────────────────

const TAPBACK_EMOJI: Record<string, string> = {
  love: "❤️", like: "👍", dislike: "👎",
  laugh: "😂", emphasize: "‼️", question: "❓",
};

function hLine(w: number): string {
  return `${T.border}${"─".repeat(w)}${RESET}`;
}

function drawBubble(text: string, maxW: number, type: "sent" | "received" | "pending"): string[] {
  const contentW = Math.max(maxW - 4, 8); // 2 border + 2 padding
  const wrapped = wrap(text, contentW);
  const innerW = Math.max(...wrapped.map((l) => l.length), 1);
  const bFg = type === "sent" ? T.sentBorder : type === "received" ? T.recvBorder : T.pendingBorder;
  const cFg = type === "sent" ? T.sentFg : type === "received" ? T.recvFg : T.pendingFg;
  const cBg = type === "sent" ? T.sentBg : type === "received" ? T.recvBg : T.pendingBg;
  const top = `${bFg}┌${"─".repeat(innerW + 2)}┐${RESET}`;
  const bot = `${bFg}└${"─".repeat(innerW + 2)}┘${RESET}`;
  const mid = wrapped.map((l) => {
    const padded = l + " ".repeat(innerW - l.length);
    return `${bFg}│${RESET}${cBg}${cFg} ${padded} ${RESET}${bFg}│${RESET}`;
  });
  return [top, ...mid, bot];
}

function relativeDate(date: Date | null): string {
  if (!date) return "";
  const now = new Date();
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  if (date.toDateString() === now.toDateString()) return time;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (date.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

function formatReactions(reactions: Reaction[]): string {
  const counts = new Map<string, number>();
  for (const r of reactions) {
    if (r.isRemoval) continue;
    const emoji = r.emoji ?? TAPBACK_EMOJI[r.type] ?? r.type;
    counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
  }
  if (counts.size === 0) return "";
  return [...counts.entries()].map(([e, c]) => (c > 1 ? `${e}${c}` : e)).join(" ");
}

// ── Pending message type ───────────────────────────────────────────────

interface PendingMessage {
  text: string;
  sentAt: Date;
  status: "sending" | "sent" | "failed";
}

// ── TUI app ────────────────────────────────────────────────────────────

type FocusPane = "sidebar" | "thread";
type Mode = "browse" | "compose" | "confirm";

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
  private status = "Loading...";
  private mode: Mode = "browse";
  private composeText = "";
  private pendingMessages: PendingMessage[] = [];

  // ── Lifecycle ──────────────────────────────────────────────────────

  async start(): Promise<void> {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdout.write("\x1b[?1049h\x1b[?25l"); // alt screen, hide cursor
    process.stdin.on("keypress", this.onKeypress);
    process.on("SIGINT", this.shutdown);
    process.on("SIGTERM", this.shutdown);
    process.on("SIGWINCH", this.onResize);
    await this.refreshAll();
  }

  private onResize = () => this.render();

  private shutdown = async () => {
    process.stdin.off("keypress", this.onKeypress);
    process.off("SIGWINCH", this.onResize);
    process.stdout.write("\x1b[?25h\x1b[?1049l"); // show cursor, restore screen
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    await this.db.close();
    process.exit(0);
  };

  // ── Input handling ─────────────────────────────────────────────────

  private onKeypress = async (_ch: string | undefined, key: readline.Key) => {
    if (key.ctrl && key.name === "c") { await this.shutdown(); return; }

    if (this.mode === "compose") {
      await this.handleComposeKey(_ch, key);
      return;
    }
    if (this.mode === "confirm") {
      await this.handleConfirmKey(key);
      return;
    }

    // Browse mode
    if (key.name === "q") { await this.shutdown(); return; }
    if (key.name === "tab") {
      this.focus = this.focus === "sidebar" ? "thread" : "sidebar";
      this.render();
      return;
    }
    if (key.name === "r") { await this.refreshAll(); return; }
    if (key.name === "c" || (key.name === "return" && this.focus === "thread")) {
      this.enterCompose();
      return;
    }
    if (this.loading) return;

    if (this.focus === "sidebar") {
      if (key.name === "down" || key.name === "j") await this.moveConversation(1);
      else if (key.name === "up" || key.name === "k") await this.moveConversation(-1);
      return;
    }

    const maxScroll = Math.max(this.threadLineCache.length - 1, 0);
    if (key.name === "down" || key.name === "j") {
      this.messageScroll = Math.min(this.messageScroll + 1, maxScroll);
      this.render();
    } else if (key.name === "up" || key.name === "k") {
      this.messageScroll = Math.max(this.messageScroll - 1, 0);
      this.render();
    } else if (key.name === "pagedown") {
      this.messageScroll = Math.min(this.messageScroll + 10, maxScroll);
      this.render();
    } else if (key.name === "pageup") {
      this.messageScroll = Math.max(this.messageScroll - 10, 0);
      this.render();
    }
  };

  // ── Compose mode ───────────────────────────────────────────────────

  private enterCompose(): void {
    if (this.conversations.length === 0) return;
    this.mode = "compose";
    this.composeText = "";
    this.focus = "thread";
    process.stdout.write("\x1b[?25h"); // show cursor
    this.render();
  }

  private async handleComposeKey(ch: string | undefined, key: readline.Key): Promise<void> {
    if (key.name === "escape") {
      this.mode = "browse";
      this.composeText = "";
      process.stdout.write("\x1b[?25l");
      this.render();
      return;
    }
    if (key.name === "return") {
      if (this.composeText.trim()) {
        this.mode = "confirm";
        this.render();
      }
      return;
    }
    if (key.name === "backspace") {
      this.composeText = this.composeText.slice(0, -1);
      this.render();
      return;
    }
    if (ch && !key.ctrl && !key.meta) {
      this.composeText += ch;
      this.render();
    }
  }

  private async handleConfirmKey(key: readline.Key): Promise<void> {
    if (key.name === "return") {
      await this.sendComposedMessage();
      return;
    }
    // Anything else cancels back to compose
    this.mode = "compose";
    this.render();
  }

  private async sendComposedMessage(): Promise<void> {
    const selected = this.conversations[this.selectedConversation];
    if (!selected) return;
    const text = this.composeText.trim();
    if (!text) return;

    this.mode = "browse";
    this.composeText = "";
    process.stdout.write("\x1b[?25l");

    const pending: PendingMessage = { text, sentAt: new Date(), status: "sending" };
    this.pendingMessages.push(pending);
    this.invalidateThreadCache();
    this.messageScroll = Math.max(this.threadLineCache.length - this.threadBodyHeight(), 0);
    this.render();

    const slugRecord = this.db.getSlugRecord(selected.threadSlug);
    let result: { success: boolean; error?: string };

    if (slugRecord?.isGroup) {
      result = slugRecord.displayName && !slugRecord.displayName.startsWith("chat")
        ? await sendToChat(slugRecord.displayName, text)
        : await sendToChatId(slugRecord?.chatGuid ?? selected.chatId, text);
    } else {
      result = await sendMessageAlt(slugRecord?.chatIdentifier ?? selected.chatIdentifier, text);
    }

    pending.status = result.success ? "sent" : "failed";
    this.invalidateThreadCache();
    this.render();

    if (result.success) {
      this.pollForSentMessage(text, 0);
    }
  }

  private pollForSentMessage(text: string, attempt: number): void {
    if (attempt > 6) return; // stop after ~10s
    setTimeout(async () => {
      const selected = this.conversations[this.selectedConversation];
      if (!selected) return;
      this.messages = await this.db.getMessagesForChat(selected.chatIdentifier, 200, { includeReactionDetails: true });
      const found = this.messages.some((m) => m.isFromMe && m.text?.includes(text));
      if (found) {
        this.pendingMessages = this.pendingMessages.filter((p) => p.text !== text);
      }
      this.invalidateThreadCache();
      this.messageScroll = Math.max(this.threadLineCache.length - this.threadBodyHeight(), 0);
      this.render();
      if (!found) this.pollForSentMessage(text, attempt + 1);
    }, 1500);
  }

  // ── Data loading ───────────────────────────────────────────────────

  private async moveConversation(delta: number): Promise<void> {
    if (this.conversations.length === 0) return;
    this.selectedConversation = Math.max(0, Math.min(this.selectedConversation + delta, this.conversations.length - 1));
    await this.loadSelectedMessages();
  }

  private async refreshAll(): Promise<void> {
    this.loading = true;
    this.status = "Refreshing...";
    this.render();
    const prevSlug = this.conversations[this.selectedConversation]?.threadSlug;
    this.conversations = await this.db.listConversations(200);
    if (prevSlug) {
      const idx = this.conversations.findIndex((c) => c.threadSlug === prevSlug);
      if (idx >= 0) this.selectedConversation = idx;
    }
    if (this.selectedConversation >= this.conversations.length) {
      this.selectedConversation = Math.max(this.conversations.length - 1, 0);
    }
    await this.loadSelectedMessages();
    this.db.scheduleBackgroundRefresh();
    this.loading = false;
    this.status = "";
    this.render();
  }

  private async loadSelectedMessages(): Promise<void> {
    const selected = this.conversations[this.selectedConversation];
    if (!selected) { this.messages = []; this.invalidateThreadCache(); this.render(); return; }
    this.loading = true;
    this.status = `Loading ${selected.displayName ?? selected.chatIdentifier}...`;
    this.render();
    this.messages = await this.db.getMessagesForChat(selected.chatIdentifier, 200, { includeReactionDetails: true });
    this.pendingMessages = [];
    this.invalidateThreadCache();
    this.messageScroll = Math.max(this.threadLineCache.length - this.threadBodyHeight(), 0);
    this.loading = false;
    this.status = "";
    this.render();
  }

  private get totalUnread(): number {
    return this.conversations.reduce((s, c) => s + c.unreadCount, 0);
  }

  // ── Layout metrics ─────────────────────────────────────────────────

  private sidebarWidth(): number {
    return Math.max(Math.floor((process.stdout.columns ?? 120) * 0.32), 28);
  }

  private threadBodyHeight(): number {
    // rows - title(1) - topBorder(1) - infoLines(4) - botBorder(1) - status(1) - help(1) - compose(mode === compose ? 1 : 0)
    const extra = this.mode === "compose" || this.mode === "confirm" ? 1 : 0;
    return Math.max((process.stdout.rows ?? 40) - 9 - extra, 5);
  }

  // ── Sidebar rendering ─────────────────────────────────────────────

  private sidebarContent(innerW: number, visibleRows: number): string[] {
    const lines: string[] = [];
    for (const conv of this.conversations) {
      const hasUnread = conv.unreadCount > 0;
      const name = truncPlain(conv.displayName ?? conv.chatIdentifier, Math.max(innerW - 14, 6));
      const time = relativeDate(conv.lastMessageDate);
      const unreadBadge = hasUnread ? ` (${conv.unreadCount})` : "";
      const smsBadge = conv.serviceType === "SMS" ? `${T.smsBadge} SMS${RESET}` : "";

      const nameStyled = hasUnread
        ? `${T.dot}● ${RESET}${T.sideUnread}${name}${unreadBadge}${RESET}${smsBadge}`
        : `  ${T.sideRead}${name}${RESET}${smsBadge}`;
      const timeStyled = `${T.sideTime}${time}${RESET}`;
      lines.push(`${nameStyled}  ${timeStyled}`);

      lines.push(`  ${T.sideSlug}~${conv.threadSlug}${RESET}`);

      const snippet = truncPlain(conv.lastMessageSnippet ?? "", Math.max(innerW - 4, 4));
      lines.push(`  ${T.sideSnippet}${snippet}${RESET}`);

      lines.push(""); // separator
    }

    // Scrolling
    const selRow = this.selectedConversation * 4;
    if (selRow < this.sidebarScroll) this.sidebarScroll = selRow;
    else if (selRow >= this.sidebarScroll + visibleRows) this.sidebarScroll = selRow - visibleRows + 4;

    return lines.slice(this.sidebarScroll, this.sidebarScroll + visibleRows);
  }

  // ── Thread info header ─────────────────────────────────────────────

  private threadInfoContent(w: number): string[] {
    const sel = this.conversations[this.selectedConversation];
    if (!sel) return ["", "", ""];

    const name = sel.displayName ?? sel.chatIdentifier;
    const ident = sel.displayName ? `  ${T.infoLabel}(${sel.rawIdentifier})${RESET}` : "";
    const svc = sel.serviceType === "SMS"
      ? `  ${T.smsBadge}SMS${RESET}`
      : `  ${T.infoLabel}iMessage${RESET}`;
    const grp = sel.isGroupChat ? `  ${T.infoLabel}Group${RESET}` : "";
    const line1 = `${BOLD}${T.infoVal}${truncPlain(name, w - 30)}${RESET}${ident}${svc}${grp}`;

    const resolved = this.db.resolveParticipantNames(sel.participants);
    const parts: string[] = [];
    for (let i = 0; i < sel.participants.length; i++) {
      const h = sel.participants[i];
      const d = resolved[i];
      parts.push(d !== h ? `${T.infoVal}${d}${RESET} ${T.infoLabel}(${h})${RESET}` : `${T.infoLabel}${h}${RESET}`);
    }
    const line2 = `${T.infoLabel}Members:${RESET} ${parts.join(", ")}`;
    const line3 = `${T.infoSlug}~${sel.threadSlug}${RESET}`;

    return [line1, line2, line3];
  }

  // ── Thread messages ────────────────────────────────────────────────

  private threadLineCache: string[] = [];
  private threadLineCacheDirty = true;

  private invalidateThreadCache(): void {
    this.threadLineCacheDirty = true;
  }

  private buildThreadLines(): string[] {
    if (!this.threadLineCacheDirty) return this.threadLineCache;
    const sel = this.conversations[this.selectedConversation];
    const paneW = Math.max((process.stdout.columns ?? 120) - this.sidebarWidth() - 3, 20);
    const maxBubbleW = Math.max(Math.floor(paneW * 0.75), 16);
    const lines: string[] = [];

    if (!sel) { this.threadLineCache = ["  No conversation selected."]; this.threadLineCacheDirty = false; return this.threadLineCache; }

    for (const msg of this.messages) {
      if (msg.isReaction) continue;
      const isSent = msg.isFromMe;
      const who = isSent ? "me" : msg.displayName ?? sel.displayName ?? sel.chatIdentifier;

      // Group chat: show sender name for received messages
      if (!isSent && sel.isGroupChat) {
        lines.push(`  ${T.infoVal}${who}${RESET}`);
      }

      // Reply context
      if (msg.isReply && msg.replyTo?.replyToText) {
        const replyText = truncPlain(msg.replyTo.replyToText, maxBubbleW - 6);
        const padding = isSent ? " ".repeat(Math.max(paneW - maxBubbleW - 2, 0)) : "";
        lines.push(`${padding}  ${T.reply}↩ ${replyText}${RESET}`);
      }

      // Build bubble
      const bubbleText = msg.text ?? "(no text)";
      const bubble = drawBubble(bubbleText, maxBubbleW, isSent ? "sent" : "received");
      const timestamp = `${T.ts}${relativeDate(msg.date)}${RESET}`;
      const bubbleOuterW = displayWidth(bubble[0]);

      for (let i = 0; i < bubble.length; i++) {
        if (isSent) {
          // Right-aligned: timestamp on first line left, bubble right
          const gap = Math.max(paneW - bubbleOuterW - 2, 0);
          const prefix = i === 0 ? padStyled(timestamp, gap) : " ".repeat(gap);
          lines.push(`${prefix}  ${bubble[i]}`);
        } else {
          // Left-aligned: bubble left, timestamp on first line right
          const gap = Math.max(paneW - bubbleOuterW - 2, 0);
          const suffix = i === 0 ? `  ${timestamp}` : "";
          lines.push(`  ${bubble[i]}${suffix}`);
        }
      }

      // Reactions
      if (msg.reactions && msg.reactions.length > 0) {
        const rxText = formatReactions(msg.reactions);
        if (rxText) {
          const padding = isSent ? " ".repeat(Math.max(paneW - bubbleOuterW, 0)) : "  ";
          lines.push(`${padding}  ${rxText}`);
        }
      }

      // Edited indicator
      if (msg.isEdited) {
        const padding = isSent ? " ".repeat(Math.max(paneW - bubbleOuterW, 0)) : "  ";
        lines.push(`${padding}  ${T.edited}(edited)${RESET}`);
      }

      lines.push(""); // spacing between messages
    }

    // Pending messages
    for (const pm of this.pendingMessages) {
      const bubble = drawBubble(pm.text, maxBubbleW, "pending");
      const bubbleOuterW = displayWidth(bubble[0]);
      const indicator = pm.status === "sending" ? `${T.pendingFg}⏳ Sending...${RESET}`
        : pm.status === "failed" ? `${T.edited}⚠️ May not have sent${RESET}`
        : `${T.pendingFg}⏳ Sent${RESET}`;

      for (let i = 0; i < bubble.length; i++) {
        const gap = Math.max(paneW - bubbleOuterW - 2, 0);
        const prefix = i === 0 ? padStyled(indicator, gap) : " ".repeat(gap);
        lines.push(`${prefix}  ${bubble[i]}`);
      }
      lines.push("");
    }

    this.threadLineCache = lines;
    this.threadLineCacheDirty = false;
    return lines;
  }

  // ── Main render ────────────────────────────────────────────────────

  private render(): void {
    const cols = process.stdout.columns ?? 120;
    const rows = process.stdout.rows ?? 40;
    const sw = this.sidebarWidth();
    const tw = Math.max(cols - sw - 3, 20); // thread inner width (between borders)
    const sel = this.conversations[this.selectedConversation];

    const threadLines = this.buildThreadLines();
    const bodyH = this.threadBodyHeight();
    const threadVisible = threadLines.slice(this.messageScroll, this.messageScroll + bodyH);
    const sideBodyH = rows - 4 - (this.mode !== "browse" ? 1 : 0);
    const sideVisible = this.sidebarContent(sw, sideBodyH);

    const out: string[] = [];
    out.push("\x1b[H\x1b[2J");

    // Title bar
    const titleLeft = `${T.appName} imsg${RESET} ${DIM}v${APP_VERSION}${RESET}`;
    const titleRight = this.loading ? `${T.statusAccent}loading...${RESET}` : "";
    out.push(padStyled(`  ${titleLeft}`, cols - displayWidth(titleRight) - 1) + titleRight);

    // Top border with pane titles
    const sideTitle = ` Conversations (${this.conversations.length}) `;
    const threadTitle = ` ${truncPlain(sel?.displayName ?? sel?.chatIdentifier ?? "Thread", tw - 4)} `;
    const sideTitleStyled = this.focus === "sidebar"
      ? `${T.hdrFocFg}${sideTitle}${RESET}` : `${T.hdrDimFg}${sideTitle}${RESET}`;
    const threadTitleStyled = this.focus === "thread"
      ? `${T.hdrFocFg}${threadTitle}${RESET}` : `${T.hdrDimFg}${threadTitle}${RESET}`;
    const sideBar = sw - sideTitle.length - 1;
    const threadBar = tw - threadTitle.length - 1;
    out.push(
      `${T.border}┌─${RESET}${sideTitleStyled}${T.border}${"─".repeat(Math.max(sideBar, 0))}┬─${RESET}` +
      `${threadTitleStyled}${T.border}${"─".repeat(Math.max(threadBar, 0))}┐${RESET}`,
    );

    // Info lines (right pane top)
    const infoLines = this.threadInfoContent(tw);
    const infoCount = infoLines.length + 1; // +1 for separator

    // Body
    const totalBodyRows = rows - 4 - (this.mode !== "browse" ? 1 : 0);
    for (let i = 0; i < totalBodyRows; i++) {
      // Sidebar
      const sideText = sideVisible[i] ?? "";
      const selStart = (this.selectedConversation * 4) - this.sidebarScroll;
      const isSelected = i >= selStart && i < selStart + 3 && selStart >= 0;
      const styledSide = isSelected
        ? `${T.sideSelBg}${T.sideSelFg}${padStyled(sideText, sw)}${RESET}`
        : padStyled(sideText, sw);

      // Thread (info header, then messages)
      let threadText: string;
      if (i < infoLines.length) {
        threadText = padStyled(` ${infoLines[i]}`, tw);
      } else if (i === infoLines.length) {
        threadText = `${T.border}${"─".repeat(tw)}${RESET}`;
      } else {
        const msgIdx = i - infoCount;
        threadText = padStyled(` ${threadVisible[msgIdx] ?? ""}`, tw);
      }

      out.push(`${T.border}│${RESET}${styledSide}${T.border}│${RESET}${threadText}${T.border}│${RESET}`);
    }

    // Bottom border
    out.push(`${T.border}└${"─".repeat(sw + 1)}┴${"─".repeat(tw + 1)}┘${RESET}`);

    // Compose bar (if in compose/confirm mode)
    if (this.mode === "compose") {
      const label = `${T.composeBg}${T.composeFg} > ${this.composeText}█ ${RESET}`;
      out.push(padStyled(label, cols));
    } else if (this.mode === "confirm") {
      const name = sel?.displayName ?? sel?.chatIdentifier ?? "?";
      const label = `${T.composeBg}${T.statusAccent} Send to ${name}? ${T.composeFg}Enter: send  Esc: cancel ${RESET}`;
      out.push(padStyled(label, cols));
    }

    // Status bar
    const unreadPart = this.totalUnread > 0 ? `${T.statusAccent}● ${this.totalUnread} unread${RESET}  ` : "";
    const threadPart = sel ? `${T.statusFg}${sel.displayName ?? sel.chatIdentifier}${RESET}  ` : "";
    const svcPart = sel ? `${T.infoLabel}${sel.serviceType}${RESET}` : "";
    const statusExtra = this.status ? `  ${T.statusFg}${this.status}${RESET}` : "";
    out.push(`${T.statusBg} ${unreadPart}${threadPart}${svcPart}${statusExtra}${" ".repeat(Math.max(cols - 10, 0))}${RESET}`);

    // Help line
    const helpParts = this.mode === "browse"
      ? [
          ["Tab", "panes"], ["j/k", "move"], ["PgUp/Dn", "scroll"],
          ["c", "compose"], ["r", "refresh"], ["q", "quit"],
        ]
      : [["Enter", "send"], ["Esc", "cancel"]];
    const helpLine = helpParts.map(([k, d]) => `${T.helpKey}${k}${RESET}${T.helpDesc}: ${d}${RESET}`).join("  ");
    out.push(` ${helpLine}`);

    process.stdout.write(out.join("\n"));
  }
}

if (process.argv[1]?.endsWith("tui.js")) {
  runTui().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
