import { Box, Text } from "ink";
import type { Message } from "../../types.js";
import { TAPBACK_EMOJI } from "../theme.js";
import { useTheme } from "../themes/ThemeContext.js";

interface Props {
  message: Message;
  width: number;
  height: number;
}

function formatFullDate(date: Date): string {
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function Label({ children }: { children: string }) {
  const theme = useTheme();
  return <Text color={theme.drawer.label}>{children}: </Text>;
}

export function MessageDrawer({ message: m, width, height }: Props) {
  const theme = useTheme();
  const hasAttachments = m.attachments && m.attachments.length > 0;

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="single"
      borderColor={theme.drawer.border}
      overflow="hidden"
    >
      {/* Header */}
      <Box paddingX={1} backgroundColor={theme.header.focused.bg}>
        <Text color={theme.header.focused.fg} bold>
          Message Details
        </Text>
      </Box>

      <Box flexDirection="column" paddingX={1} paddingY={0} gap={0}>
        {/* Sender */}
        <Box>
          <Label>From</Label>
          <Text color={theme.drawer.value}>{m.isFromMe ? "Me" : (m.displayName ?? m.handle)}</Text>
        </Box>

        {/* Handle */}
        {!m.isFromMe && m.displayName && (
          <Box>
            <Label>Handle</Label>
            <Text color={theme.drawer.value}>{m.handle}</Text>
          </Box>
        )}

        {/* Date */}
        <Box>
          <Label>Sent</Label>
          <Text color={theme.drawer.value}>{formatFullDate(m.date)}</Text>
        </Box>

        {/* Read/Delivered */}
        {m.dateDelivered && (
          <Box>
            <Label>Delivered</Label>
            <Text color={theme.drawer.value}>{formatFullDate(m.dateDelivered)}</Text>
          </Box>
        )}
        {m.dateRead && (
          <Box>
            <Label>Read</Label>
            <Text color={theme.drawer.value}>{formatFullDate(m.dateRead)}</Text>
          </Box>
        )}

        {/* Service */}
        <Box>
          <Label>Service</Label>
          <Text color={m.service === "SMS" ? theme.sms : theme.info.label}>{m.service}</Text>
        </Box>

        {/* Chat ID */}
        <Box>
          <Label>Chat</Label>
          <Text color={theme.drawer.value}>{m.chatId}</Text>
        </Box>

        {/* GUID */}
        <Box>
          <Label>GUID</Label>
          <Text color={theme.drawer.value} wrap="truncate">
            {m.guid}
          </Text>
        </Box>

        {/* Edited */}
        {m.isEdited && (
          <Box>
            <Label>Status</Label>
            <Text color={theme.edited}>Edited</Text>
          </Box>
        )}

        {/* Reactions */}
        {m.reactions && m.reactions.length > 0 && (
          <Box flexDirection="column">
            <Text color={theme.drawer.label}>Reactions:</Text>
            {m.reactions
              .filter((r) => !r.isRemoval)
              .map((r) => (
                <Box
                  key={`${r.fromHandle}-${r.type}-${r.emoji ?? ""}-${r.targetMessageGuid}-${r.targetMessagePart}`}
                  paddingLeft={1}
                >
                  <Text color={theme.drawer.value}>
                    {r.emoji ?? TAPBACK_EMOJI[r.type] ?? r.type} {r.fromHandle ?? "unknown"}
                  </Text>
                </Box>
              ))}
          </Box>
        )}

        {/* Attachments */}
        {hasAttachments && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={theme.attachment} bold>
              Attachments ({m.attachments!.length}):
            </Text>
            {m.attachments!.map((att) => {
              return (
                <Box
                  key={`${att.filename}-${att.transferName ?? ""}-${att.mimeType ?? ""}-${att.totalBytes}`}
                  flexDirection="column"
                  paddingLeft={1}
                >
                  <Text color={theme.drawer.value} wrap="truncate">
                    {att.transferName ?? att.filename}
                  </Text>
                  <Text color={theme.drawer.label}>
                    {att.mimeType ?? "unknown"} ·{" "}
                    {att.totalBytes > 0 ? formatBytes(att.totalBytes) : "?"}
                    <Text color={theme.senderName}> (press o to preview)</Text>
                  </Text>
                </Box>
              );
            })}
            <Box marginTop={1}>
              <Text color={theme.help.key}>o</Text>
              <Text color={theme.help.desc}>: open attachment</Text>
            </Box>
          </Box>
        )}

        {/* Full message text */}
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.drawer.label}>Full text:</Text>
          <Box borderStyle="single" borderColor={theme.drawer.border} paddingX={1}>
            <Text color={theme.drawer.value} wrap="wrap">
              {m.text ?? "(no text)"}
            </Text>
          </Box>
        </Box>

        {/* Reply context */}
        {m.isReply && m.replyTo && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={theme.drawer.label}>Reply to:</Text>
            <Text color={theme.replyContext} italic wrap="wrap">
              {m.replyTo.replyToText ?? "(unknown)"}
            </Text>
          </Box>
        )}
      </Box>

      {/* Footer hint */}
      <Box flexGrow={1} />
      <Box paddingX={1}>
        <Text color={theme.help.desc}>Esc/q to close</Text>
      </Box>
    </Box>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
