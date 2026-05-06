import React from "react";
import { Box, Text } from "ink";
import type { Conversation } from "../../types.js";
import { glyphs, theme } from "../theme.js";

function relativeDate(date: Date | null): string {
  if (!date) return "";
  const now = new Date();
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  if (date.toDateString() === now.toDateString()) return time;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (date.toDateString() === y.toDateString()) return "Yest";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

interface Props {
  conversation: Conversation;
  selected: boolean;
  width: number;
  lineNum?: string;
  focused?: boolean;
  isLast?: boolean;
}

export function ConversationItem({ conversation: c, selected, width, lineNum, focused, isLast }: Props) {
  const hasUnread = c.unreadCount > 0;
  const name = c.displayName ?? c.chatIdentifier;
  const time = relativeDate(c.lastMessageDate);
  const snippet = c.lastMessageSnippet ?? "";
  const serviceIcon = c.serviceType === "SMS" ? glyphs.sms : glyphs.iMessage;
  const lineNumW = 4;
  const contentW = width - lineNumW - 1;

  return (
    <Box flexDirection="column" width={width}>
      <Box
        flexDirection="column"
        backgroundColor={selected ? theme.sidebar.selected : undefined}
      >
        {/* Name row */}
        <Box>
          {/* Relative line number */}
          {lineNum !== undefined && (
            <Text color={selected && focused ? theme.sent.bg : theme.lineNum}>{lineNum.padStart(3)} </Text>
          )}

          {/* Cursor */}
          <Text color={selected && focused ? theme.sent.bg : undefined}>{selected && focused ? "▸" : " "}</Text>

          {/* Unread indicator */}
          {hasUnread && <Text color={theme.dot}>{glyphs.envelope} </Text>}

          {/* Group indicator */}
          {c.isGroupChat && <Text color={theme.info.label}>{glyphs.group} </Text>}

          {/* Name */}
          <Text
            color={selected ? theme.sidebar.selectedFg : hasUnread ? theme.sidebar.unread : theme.sidebar.read}
            bold={hasUnread}
          >
            {name.length > contentW - 12 ? `${name.slice(0, contentW - 14)}…` : name}
          </Text>

          {hasUnread && <Text color={theme.sidebar.unread}> ({c.unreadCount})</Text>}
          <Text color={c.serviceType === "SMS" ? theme.sms : theme.info.label}> {serviceIcon}</Text>

          {/* Time — right area */}
          <Text color={theme.sidebar.time}> {time}</Text>
        </Box>

        {/* Snippet row */}
        <Box paddingLeft={5}>
          <Text color={theme.sidebar.snippet}>{snippet.slice(0, contentW)}</Text>
        </Box>

        {/* Slug row -- right-justified, italic, dim, with subtle bg */}
        <Box justifyContent="flex-end" paddingRight={1} backgroundColor={theme.sidebar.slugBg}>
          <Text color={theme.sidebar.slug} dimColor italic>
            ~{c.threadSlug}
          </Text>
        </Box>
      </Box>

      {/* Separator between items */}
      {!isLast && (
        <Box paddingX={1}>
          <Text color={theme.sidebar.separator} dimColor>
            {glyphs.separator.repeat(Math.max(width - 4, 1))}
          </Text>
        </Box>
      )}
    </Box>
  );
}
