import React from "react";
import { Box, Text } from "ink";
import type { Message, Reaction } from "../../types.js";
import { TAPBACK_EMOJI, theme } from "../theme.js";

function relativeDate(date: Date): string {
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

interface Props {
  message: Message;
  maxWidth: number;
  showSender?: boolean;
  senderName?: string;
}

export function MessageBubble({ message: m, maxWidth, showSender, senderName }: Props) {
  const isSent = m.isFromMe;
  const bubbleStyle = isSent ? theme.sent : theme.received;
  const text = m.text ?? "(no text)";
  const timestamp = relativeDate(m.date);
  const reactions = m.reactions ? formatReactions(m.reactions) : "";
  const bubbleW = Math.min(Math.max(text.length + 4, 12), maxWidth);

  return (
    <Box flexDirection="column" alignItems={isSent ? "flex-end" : "flex-start"} marginBottom={1}>
      {/* Sender name for group received messages */}
      {showSender && !isSent && senderName && (
        <Text color={theme.info.value} dimColor> {senderName}</Text>
      )}

      {/* Reply context */}
      {m.isReply && m.replyTo?.replyToText && (
        <Text color={theme.timestamp} italic> ↩ {m.replyTo.replyToText.slice(0, maxWidth - 6)}</Text>
      )}

      {/* Bubble */}
      <Box
        borderStyle="round"
        borderColor={bubbleStyle.border}
        width={bubbleW}
        paddingX={1}
      >
        <Text color={bubbleStyle.fg} backgroundColor={bubbleStyle.bg} wrap="wrap">
          {text}
        </Text>
      </Box>

      {/* Timestamp + status */}
      <Box>
        <Text color={theme.timestamp}> {timestamp}</Text>
        {m.isEdited && <Text color={theme.edited}> (edited)</Text>}
      </Box>

      {/* Reactions */}
      {reactions && <Text> {reactions}</Text>}
    </Box>
  );
}

interface PendingBubbleProps {
  text: string;
  status: "sending" | "sent" | "failed";
  maxWidth: number;
}

export function PendingBubble({ text, status, maxWidth }: PendingBubbleProps) {
  const bubbleW = Math.min(Math.max(text.length + 4, 12), maxWidth);
  const indicator = status === "sending" ? "⏳ Sending..." : status === "failed" ? "⚠️ May not have sent" : "⏳ Sent";

  return (
    <Box flexDirection="column" alignItems="flex-end" marginBottom={1}>
      <Box borderStyle="round" borderColor={theme.pending.border} width={bubbleW} paddingX={1}>
        <Text color={theme.pending.fg} backgroundColor={theme.pending.bg} wrap="wrap">{text}</Text>
      </Box>
      <Text color={status === "failed" ? theme.edited : theme.timestamp}> {indicator}</Text>
    </Box>
  );
}
