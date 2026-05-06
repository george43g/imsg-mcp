import React from "react";
import { Box, Text } from "ink";
import type { Message, Reaction } from "../../types.js";
import { TAPBACK_EMOJI, glyphs, theme } from "../theme.js";

function relativeDate(date: Date): string {
  const now = new Date();
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  if (date.toDateString() === now.toDateString()) return time;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (date.toDateString() === y.toDateString()) return `Yest ${time}`;
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
  return [...counts.entries()].map(([e, c]) => (c > 1 ? `${e}${c}` : e)).join("");
}

/** Check if two dates are on different calendar days */
export function isDifferentDay(a: Date, b: Date): boolean {
  return a.toDateString() !== b.toDateString();
}

/** Format a date separator label */
export function dateSeparator(date: Date): string {
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (date.toDateString() === y.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** Determine if a message is the first in a group from the same sender */
export function isGroupStart(msg: Message, prev: Message | undefined): boolean {
  if (!prev) return true;
  return msg.isFromMe !== prev.isFromMe || msg.handle !== prev.handle;
}

/** Determine if a message is the last in a group from the same sender */
export function isGroupEnd(msg: Message, next: Message | undefined): boolean {
  if (!next) return true;
  return msg.isFromMe !== next.isFromMe || msg.handle !== next.handle;
}

interface Props {
  message: Message;
  maxWidth: number;
  showSender?: boolean;
  senderName?: string;
  selected?: boolean;
  lineNum?: string;
  isFirstInGroup?: boolean; // first message from this sender in a consecutive run
  isLastInGroup?: boolean;  // last message from this sender in a consecutive run
  bgTint?: string;          // alternating background for sender groups
}

/**
 * Compact message row — no borders, minimal vertical space.
 * Sender groups get alternating background tints.
 * First message in group shows sender name; subsequent ones are indented.
 */
export function MessageBubble({
  message: m,
  maxWidth,
  showSender,
  senderName,
  selected,
  lineNum,
  isFirstInGroup,
  isLastInGroup,
  bgTint,
}: Props) {
  const isSent = m.isFromMe;
  const text = m.text ?? "(attachment)";
  const timestamp = relativeDate(m.date);
  const reactions = m.reactions ? formatReactions(m.reactions) : "";
  const hasAttachments = m.hasAttachments;

  // Cursor indicator
  const cursor = selected ? "▸" : " ";
  const cursorColor = selected ? theme.sent.bg : undefined;

  // Only show sender on first message in a group
  const sender = isFirstInGroup
    ? (showSender && !isSent && senderName ? senderName : isSent ? "Me" : undefined)
    : undefined;

  // Group separator: thin line between groups
  const groupSepChar = isFirstInGroup ? "┌" : isLastInGroup ? "└" : "│";
  const groupColor = isSent ? theme.sent.border : theme.received.border;

  return (
    <Box flexDirection="column" backgroundColor={selected ? theme.sidebar.selected : bgTint}>
      <Box>
        {/* Line number */}
        {lineNum !== undefined && (
          <Text color={selected ? theme.sent.bg : theme.lineNum}>{lineNum.padStart(3)} </Text>
        )}

        {/* Cursor */}
        <Text color={cursorColor}>{cursor}</Text>

        {/* Group gutter — visual thread indicator */}
        <Text color={groupColor}>{groupSepChar} </Text>

        {/* Timestamp — only on first in group or if selected */}
        {isFirstInGroup ? (
          <Text color={theme.timestamp}>{timestamp.padEnd(13)}</Text>
        ) : (
          <Text color={theme.timestamp}>{"             "}</Text>
        )}

        {/* Direction indicator + sender (only first in group) */}
        {isFirstInGroup ? (
          <>
            {isSent ? (
              <Text color={theme.sent.bg} bold>{glyphs.sent} </Text>
            ) : (
              <Text color={theme.received.border} bold>{glyphs.received} </Text>
            )}
            {sender && (
              <Text color={isSent ? theme.sent.bg : theme.senderName} bold>
                {sender.length > 12 ? `${sender.slice(0, 11)}…` : sender}
                {": "}
              </Text>
            )}
          </>
        ) : (
          // Continuation: indent to align with first message text
          <Text>{"  "}{sender ? "                " : ""}</Text>
        )}

        {/* Message text */}
        <Text
          color={isSent ? theme.sentText : theme.receivedText}
          wrap="truncate"
        >
          {text}
        </Text>

        {/* Reactions */}
        {reactions && <Text> {reactions}</Text>}

        {/* Attachment indicator */}
        {hasAttachments && <Text color={theme.attachment}> 📎</Text>}

        {/* Edited indicator */}
        {m.isEdited && <Text color={theme.edited}> ✎</Text>}
      </Box>

      {/* Reply context - indented under the message */}
      {m.isReply && m.replyTo?.replyToText && (
        <Box>
          {lineNum !== undefined && <Text>{"    "}</Text>}
          <Text>{"  "}</Text>
          <Text color={theme.replyContext} italic>{"  ↩ "}{m.replyTo.replyToText.slice(0, maxWidth - 12)}</Text>
        </Box>
      )}
    </Box>
  );
}

interface PendingBubbleProps {
  text: string;
  status: "sending" | "sent" | "failed";
  maxWidth: number;
}

export function PendingBubble({ text, status }: PendingBubbleProps) {
  const indicator = status === "sending" ? "⏳" : status === "failed" ? "⚠" : "✓";
  const color = status === "failed" ? theme.edited : theme.pending.fg;

  return (
    <Box backgroundColor={theme.groupBg.sent}>
      <Text>{"    "}</Text>
      <Text color={color}>{indicator} </Text>
      <Text color={theme.timestamp}>{"now".padEnd(13)}</Text>
      <Text color={theme.sent.bg} bold>{"▶ Me: "}</Text>
      <Text color={theme.pending.fg} wrap="truncate">{text}</Text>
    </Box>
  );
}
