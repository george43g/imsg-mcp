import { TextInput } from "@inkjs/ui";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

interface Props {
  format: "markdown" | "csv" | "json";
  path: string;
  rangeSummary: string;
  onChangePath: (p: string) => void;
  onSubmit: () => void;
}

/**
 * Export modal — full-width banner at the top of the body area.
 * The format is cycled via Tab in App.tsx (which dispatches SET_EXPORT_FORMAT
 * before rendering this). The path is the only inline-editable field here.
 */
export function ExportModal({ format, path, rangeSummary, onChangePath, onSubmit }: Props) {
  return (
    <Box flexDirection="column" borderStyle="double" borderColor={theme.status.accent} paddingX={1}>
      <Box>
        <Text color={theme.status.accent} bold>
          Export messages
        </Text>
      </Box>
      <Box>
        <Text color={theme.info.label}>Range: </Text>
        <Text color={theme.info.value}>{rangeSummary}</Text>
      </Box>
      <Box>
        <Text color={theme.info.label}>Format: </Text>
        <Text
          color={format === "markdown" ? theme.status.accent : theme.info.value}
          bold={format === "markdown"}
        >
          [Markdown]
        </Text>
        <Text> </Text>
        <Text
          color={format === "csv" ? theme.status.accent : theme.info.value}
          bold={format === "csv"}
        >
          [CSV]
        </Text>
        <Text> </Text>
        <Text
          color={format === "json" ? theme.status.accent : theme.info.value}
          bold={format === "json"}
        >
          [JSON]
        </Text>
        <Text color={theme.help.desc}> (Tab cycles)</Text>
      </Box>
      <Box>
        <Text color={theme.info.label}>Path: </Text>
        <TextInput
          defaultValue={path}
          onChange={onChangePath}
          onSubmit={onSubmit}
          placeholder="/absolute/path/to/file"
        />
      </Box>
      <Box>
        <Text color={theme.help.desc}>Enter: save Esc: cancel Tab: cycle format</Text>
      </Box>
    </Box>
  );
}
