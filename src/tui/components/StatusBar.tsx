import React from "react";
import { Box, Text } from "ink";
import type { Conversation } from "../../types.js";
import { theme } from "../theme.js";

interface Props {
  totalUnread: number;
  selected: Conversation | undefined;
  status: string;
  loading: boolean;
}

export function StatusBar({ totalUnread, selected, status, loading }: Props) {
  return (
    <Box backgroundColor={theme.status.bg} paddingX={1} height={1} justifyContent="space-between">
      <Box gap={2}>
        {totalUnread > 0 && (
          <Text color={theme.status.accent} bold>● {totalUnread} unread</Text>
        )}
        {selected && (
          <Text color={theme.status.fg}>{selected.displayName ?? selected.chatIdentifier}</Text>
        )}
        {selected && (
          <Text color={selected.serviceType === "SMS" ? theme.sms : theme.info.label}>{selected.serviceType}</Text>
        )}
      </Box>
      <Text color={theme.status.fg}>{loading ? "loading..." : status}</Text>
    </Box>
  );
}
