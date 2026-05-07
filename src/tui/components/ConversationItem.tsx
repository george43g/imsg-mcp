import { Box, Text } from "ink";
import type { Conversation } from "../../types.js";
import { glyphs, theme } from "../theme.js";

function relativeDate(date: Date | null): string {
  if (!date) return "";
  const now = new Date();
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
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

/**
 * Width budget for the conversation row. Returning a precise budget for the
 * name text prevents the time/icons from wrapping onto the next row and
 * obscuring the snippet below — the original symptom of the layout bug.
 *
 * Layout (single row):
 *   [lineNum 4][cursor 2][envelope 2?][group 2?][NAME ...truncated...] (count?) icon time
 *                                                ^^^^^^^^^^^^^^^^^^^^
 *                                                this is what we budget
 */
function nameBudget(
  width: number,
  hasUnread: boolean,
  unreadCount: number,
  isGroup: boolean,
): number {
  const lineNumW = 4; // "123 "
  const cursorW = 2; // "▸ " or "  "
  const envelopeW = hasUnread ? 2 : 0;
  const groupW = isGroup ? 2 : 0;
  const countW = hasUnread ? ` (${unreadCount})`.length : 0;
  const iconW = 2; // " 💬"
  const timeW = 9; // max " 12:34 PM"
  const padding = 2; // safety margin
  return Math.max(
    width - lineNumW - cursorW - envelopeW - groupW - countW - iconW - timeW - padding,
    8,
  );
}

export function ConversationItem({
  conversation: c,
  selected,
  width,
  lineNum,
  focused,
  isLast,
}: Props) {
  const hasUnread = c.unreadCount > 0;
  const name = c.displayName ?? c.chatIdentifier;
  const time = relativeDate(c.lastMessageDate);
  const snippet = c.lastMessageSnippet ?? "";
  const serviceIcon = c.serviceType === "SMS" ? glyphs.sms : glyphs.iMessage;

  const nameW = nameBudget(width, hasUnread, c.unreadCount, c.isGroupChat);
  const truncatedName = name.length > nameW ? `${name.slice(0, Math.max(nameW - 1, 1))}…` : name;
  const snippetW = Math.max(width - 6, 8); // -5 for left padding, -1 safety
  const truncatedSnippet = snippet.length > snippetW ? snippet.slice(0, snippetW) : snippet;

  return (
    <Box flexDirection="column" width={width}>
      <Box
        flexDirection="column"
        width={width}
        backgroundColor={selected ? theme.sidebar.selected : undefined}
      >
        {/* Name row — left+right split so time can't wrap */}
        <Box width={width} justifyContent="space-between">
          {/* Left side */}
          <Box flexShrink={1}>
            {lineNum !== undefined && (
              <Text color={selected && focused ? theme.sent.bg : theme.lineNum}>
                {lineNum.padStart(3)}{" "}
              </Text>
            )}
            <Text color={selected && focused ? theme.sent.bg : undefined}>
              {selected && focused ? "▸" : " "}
            </Text>
            {hasUnread && <Text color={theme.dot}>{glyphs.envelope} </Text>}
            {c.isGroupChat && <Text color={theme.info.label}>{glyphs.group} </Text>}
            <Text
              color={
                selected
                  ? theme.sidebar.selectedFg
                  : hasUnread
                    ? theme.sidebar.unread
                    : theme.sidebar.read
              }
              bold={hasUnread}
              wrap="truncate"
            >
              {truncatedName}
            </Text>
          </Box>

          {/* Right side: count + service icon + time, fixed-width */}
          <Box flexShrink={0}>
            {hasUnread && <Text color={theme.sidebar.unread}> ({c.unreadCount})</Text>}
            <Text color={c.serviceType === "SMS" ? theme.sms : theme.info.label}>
              {" "}
              {serviceIcon}
            </Text>
            <Text color={theme.sidebar.time}> {time}</Text>
          </Box>
        </Box>

        {/* Snippet row — explicit width so it can't bleed into adjacent rows */}
        <Box width={width} paddingLeft={5}>
          <Text color={theme.sidebar.snippet} wrap="truncate">
            {truncatedSnippet}
          </Text>
        </Box>

        {/* Slug row — right-justified, italic, dim, subtle bg */}
        <Box
          width={width}
          justifyContent="flex-end"
          paddingRight={1}
          backgroundColor={theme.sidebar.slugBg}
        >
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

// Exported for tests
export { nameBudget };
