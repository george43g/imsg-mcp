import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { Conversation } from "../../types.js";
import { theme } from "../theme.js";
import { ConversationItem } from "./ConversationItem.js";

interface Props {
  conversations: Conversation[];
  selectedIdx: number;
  scrollOffset: number;
  filterQuery: string;
  focused: boolean;
  width: number;
  height: number;
}

export function Sidebar({ conversations, selectedIdx, scrollOffset, filterQuery, focused, width, height }: Props) {
  const filtered = useMemo(() => {
    if (!filterQuery) return conversations;
    const q = filterQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        (c.displayName?.toLowerCase().includes(q) ?? false) ||
        c.chatIdentifier.toLowerCase().includes(q) ||
        c.threadSlug.toLowerCase().includes(q),
    );
  }, [conversations, filterQuery]);

  // Each conversation item takes ~4 rows (name, slug, snippet, gap)
  const itemHeight = 4;
  const visibleCount = Math.floor(height / itemHeight);
  const visible = filtered.slice(scrollOffset, scrollOffset + visibleCount);

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="single"
      borderColor={focused ? theme.header.focused.fg : theme.border}
      overflow="hidden"
    >
      <Box paddingX={1} backgroundColor={focused ? theme.header.focused.bg : theme.header.dim.bg}>
        <Text color={focused ? theme.header.focused.fg : theme.header.dim.fg} bold={focused}>
          Conversations ({filtered.length})
        </Text>
      </Box>

      {filterQuery && (
        <Box paddingX={1}>
          <Text color={theme.status.accent}>/ </Text>
          <Text color={theme.compose.fg}>{filterQuery}</Text>
        </Box>
      )}

      <Box flexDirection="column" flexGrow={1}>
        {visible.length === 0 ? (
          <Box paddingX={1}><Text color={theme.sidebar.snippet}>No conversations</Text></Box>
        ) : (
          visible.map((conv, i) => {
            const realIdx = scrollOffset + i;
            return (
              <ConversationItem
                key={conv.threadSlug}
                conversation={conv}
                selected={realIdx === selectedIdx}
                width={width - 2}
              />
            );
          })
        )}
      </Box>
    </Box>
  );
}
