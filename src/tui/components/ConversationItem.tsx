import React from "react";
import { Box, Text } from "ink";
import type { Conversation } from "../../types.js";
import { theme } from "../theme.js";

function relativeDate(date: Date | null): string {
  if (!date) return "";
  const now = new Date();
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  if (date.toDateString() === now.toDateString()) return time;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (date.toDateString() === y.toDateString()) return `Yesterday`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

interface Props {
  conversation: Conversation;
  selected: boolean;
  width: number;
}

export function ConversationItem({ conversation: c, selected, width }: Props) {
  const hasUnread = c.unreadCount > 0;
  const name = c.displayName ?? c.chatIdentifier;
  const time = relativeDate(c.lastMessageDate);
  const snippet = c.lastMessageSnippet ?? "";

  return (
    <Box
      flexDirection="column"
      width={width}
      paddingX={1}
      backgroundColor={selected ? theme.sidebar.selected : undefined}
    >
      <Box justifyContent="space-between">
        <Box>
          {hasUnread && <Text color={theme.dot}>● </Text>}
          <Text color={selected ? theme.sidebar.selectedFg : hasUnread ? theme.sidebar.unread : theme.sidebar.read} bold={hasUnread}>
            {name}
          </Text>
          {hasUnread && <Text color={theme.sidebar.unread}> ({c.unreadCount})</Text>}
          {c.serviceType === "SMS" && <Text color={theme.sms}> SMS</Text>}
        </Box>
        <Text color={theme.sidebar.time}>{time}</Text>
      </Box>
      <Text color={theme.sidebar.slug} dimColor>~{c.threadSlug}</Text>
      <Text color={theme.sidebar.snippet}>{snippet.slice(0, width - 4)}</Text>
    </Box>
  );
}
