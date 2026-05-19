import { Box, Text } from "ink";
import { useTheme } from "../themes/ThemeContext.js";
import type { FocusPane, Mode } from "../types.js";

interface Props {
  mode: Mode;
  focus?: FocusPane;
}

const SIDEBAR_KEYS = [
  ["j/k", "move"],
  ["#j/k", "jump"],
  ["gg/G", "top/btm"],
  ["^d/u", "½page"],
  ["y", "copy slug"],
  ["Tab", "→msgs"],
  ["/", "filter"],
  ["d", "stats"],
  ["r", "refresh"],
  ["q", "quit"],
];

const THREAD_KEYS = [
  ["j/k", "move"],
  ["#j/k", "jump"],
  ["{/}", "grp jump"],
  ["gg/G", "top/btm"],
  ["^d/u", "½page"],
  ["V", "select"],
  [":", "date jump"],
  ["Enter", "details"],
  ["o", "open att"],
  ["c", "compose"],
  ["d", "stats"],
  ["Tab", "→list"],
];

const SELECT_KEYS = [
  ["j/k", "extend"],
  ["{/}", "grp"],
  ["gg/G", "top/btm"],
  ["^d/u", "½page"],
  ["e", "export"],
  ["y", "copy text"],
  ["Esc", "exit select"],
];

const EXPORT_KEYS = [
  ["Tab", "fmt: md/csv/json"],
  ["Enter", "save"],
  ["Esc", "cancel"],
];

const DATE_JUMP_KEYS = [
  ["Tab", "picker↔text"],
  ["←/→", "field"],
  ["↑/↓", "adjust"],
  ["Enter", "jump"],
  ["Esc", "cancel"],
];

const COMPOSE_KEYS = [
  ["Enter", "send"],
  ["Esc", "cancel"],
];

const FILTER_KEYS = [["Enter/Esc", "exit filter"]];

const DRAWER_KEYS = [
  ["j/k", "scroll"],
  ["o", "open attachment"],
  ["Esc/q", "close"],
];

export function HelpBar({ mode, focus }: Props) {
  const theme = useTheme();
  let keys: string[][];
  if (mode === "compose" || mode === "confirm") keys = COMPOSE_KEYS;
  else if (mode === "filter") keys = FILTER_KEYS;
  else if (mode === "drawer") keys = DRAWER_KEYS;
  else if (mode === "select") keys = SELECT_KEYS;
  else if (mode === "export") keys = EXPORT_KEYS;
  else if (mode === "date-jump") keys = DATE_JUMP_KEYS;
  else keys = focus === "thread" ? THREAD_KEYS : SIDEBAR_KEYS;

  return (
    <Box paddingX={1} height={1} gap={1}>
      {keys.map(([key, desc]) => (
        <Box key={key}>
          <Text color={theme.help.key}>{key}</Text>
          <Text color={theme.help.desc}>:{desc} </Text>
        </Box>
      ))}
    </Box>
  );
}
