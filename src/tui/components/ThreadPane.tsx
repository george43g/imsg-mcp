import React from "react";
import { Box, Text } from "ink";
import type { Conversation, Message } from "../../types.js";
import { theme } from "../theme.js";
import type { Mode, PendingMessage } from "../types.js";
import { ComposeBar } from "./ComposeBar.js";
import { InfoHeader } from "./InfoHeader.js";
import { MessageBubble, PendingBubble } from "./MessageBubble.js";

interface Props {
  conversation: Conversation | undefined;
  messages: Message[];
  pending: PendingMessage[];
  resolvedNames: string[];
  scrollOffset: number;
  focused: boolean;
  width: number;
  height: number;
  mode: Mode;
  onChangeCompose: (text: string) => void;
  onSubmitCompose: (text: string) => void;
}

export function ThreadPane({
  conversation,
  messages,
  pending,
  resolvedNames,
  scrollOffset,
  focused,
  width,
  height,
  mode,
  onChangeCompose,
  onSubmitCompose,
}: Props) {
  const isGroup = conversation?.isGroupChat ?? false;
  const maxBubbleW = Math.max(Math.floor((width - 4) * 0.75), 16);
  const composing = mode === "compose" || mode === "confirm";

  // Calculate visible messages based on scroll
  const infoHeight = conversation ? 4 : 1;
  const composeHeight = composing ? 1 : 0;
  const msgAreaHeight = Math.max(height - infoHeight - composeHeight - 2, 3); // -2 for borders

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="single"
      borderColor={focused ? theme.header.focused.fg : theme.border}
      overflow="hidden"
    >
      {/* Header */}
      <Box paddingX={1} backgroundColor={focused ? theme.header.focused.bg : theme.header.dim.bg}>
        <Text color={focused ? theme.header.focused.fg : theme.header.dim.fg} bold={focused}>
          {conversation?.displayName ?? conversation?.chatIdentifier ?? "Thread"}
        </Text>
      </Box>

      {/* Info header */}
      <InfoHeader conversation={conversation} resolvedNames={resolvedNames} />

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
        {messages.length === 0 && pending.length === 0 ? (
          <Text color={theme.sidebar.snippet}>No messages</Text>
        ) : (
          <>
            {messages.slice(scrollOffset).map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                maxWidth={maxBubbleW}
                showSender={isGroup}
                senderName={msg.displayName ?? msg.handle}
              />
            ))}
            {pending.map((pm) => (
              <PendingBubble key={pm.text} text={pm.text} status={pm.status} maxWidth={maxBubbleW} />
            ))}
          </>
        )}
      </Box>

      {/* Compose bar */}
      {composing && (
        <ComposeBar
          mode={mode}
          recipientName={conversation?.displayName ?? conversation?.chatIdentifier ?? ""}
          onChangeText={onChangeCompose}
          onSubmit={onSubmitCompose}
        />
      )}
    </Box>
  );
}
