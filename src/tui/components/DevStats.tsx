import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { DevStatsData } from "../hooks/useDevStats.js";

interface Props {
  stats: DevStatsData;
  width: number;
}

export function DevStats({ stats, width }: Props) {
  const engineColor = stats.engine === "Rust" ? "#FF6B35" : theme.status.accent;
  const cpuColor = stats.cpuPercent > 50 ? "#FF4444" : stats.cpuPercent > 20 ? theme.edited : theme.info.value;

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor={theme.border}
      overflow="hidden"
    >
      <Box paddingX={1} backgroundColor={theme.header.dim.bg}>
        <Text color={theme.header.dim.fg} bold>Stats</Text>
      </Box>
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Text color={theme.info.label}>Engine</Text>
          <Text color={engineColor} bold>{stats.engine}</Text>
        </Box>
        <Box justifyContent="space-between">
          <Text color={theme.info.label}>CPU</Text>
          <Text color={cpuColor}>{stats.cpuPercent}%</Text>
        </Box>
        <Box justifyContent="space-between">
          <Text color={theme.info.label}>Mem</Text>
          <Text color={theme.info.value}>{stats.memMB}MB</Text>
        </Box>
        <Box justifyContent="space-between">
          <Text color={theme.info.label}>PID</Text>
          <Text color={theme.info.value}>{stats.pid}</Text>
        </Box>
        <Box justifyContent="space-between">
          <Text color={theme.info.label}>Up</Text>
          <Text color={theme.info.value}>{stats.uptime}</Text>
        </Box>
        {stats.lastQueryMs !== null && (
          <Box justifyContent="space-between">
            <Text color={theme.info.label}>Query</Text>
            <Text color={stats.lastQueryMs > 500 ? theme.edited : theme.sms}>{stats.lastQueryMs}ms</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

/** Compact inline stats for the status bar (when full panel is hidden) */
export function CompactStats({ stats }: { stats: DevStatsData }) {
  const engineColor = stats.engine === "Rust" ? "#FF6B35" : theme.status.accent;
  return (
    <Box gap={1}>
      <Text color={engineColor}>{stats.engine}</Text>
      <Text color={theme.info.label}>{stats.cpuPercent}%</Text>
      <Text color={theme.info.label}>{stats.memMB}MB</Text>
      <Text color={theme.info.label}>PID:{stats.pid}</Text>
    </Box>
  );
}
