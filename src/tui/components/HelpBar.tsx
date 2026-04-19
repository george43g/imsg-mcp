import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { Mode } from "../types.js";

interface Props {
  mode: Mode;
}

const BROWSE_KEYS = [
  ["Tab", "panes"],
  ["j/k", "move"],
  ["PgUp/Dn", "scroll"],
  ["c", "compose"],
  ["/", "filter"],
  ["r", "refresh"],
  ["q", "quit"],
];

const COMPOSE_KEYS = [
  ["Enter", "send"],
  ["Esc", "cancel"],
];

const FILTER_KEYS = [
  ["Enter/Esc", "exit filter"],
];

export function HelpBar({ mode }: Props) {
  const keys = mode === "compose" || mode === "confirm" ? COMPOSE_KEYS : mode === "filter" ? FILTER_KEYS : BROWSE_KEYS;

  return (
    <Box paddingX={1} height={1} gap={2}>
      {keys.map(([key, desc]) => (
        <Box key={key}>
          <Text color={theme.help.key}>{key}</Text>
          <Text color={theme.help.desc}>: {desc}</Text>
        </Box>
      ))}
    </Box>
  );
}
