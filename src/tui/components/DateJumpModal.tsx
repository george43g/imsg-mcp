import { TextInput } from "@inkjs/ui";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

interface Props {
  value: string;
  error: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
}

export function DateJumpModal({ value, error, onChange, onSubmit }: Props) {
  return (
    <Box flexDirection="column" borderStyle="double" borderColor={theme.status.accent} paddingX={1}>
      <Text color={theme.status.accent} bold>
        Jump to date
      </Text>
      <Box>
        <Text color={theme.info.label}>Date: </Text>
        <TextInput
          defaultValue={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder="2024-03-15  |  3/15  |  yesterday  |  2 weeks ago  |  1y"
        />
      </Box>
      {error ? (
        <Box>
          <Text color={theme.edited}>{error}</Text>
        </Box>
      ) : (
        <Box>
          <Text color={theme.help.desc}>
            Formats: YYYY-MM-DD · M/D · today · yesterday · N days/weeks/months/years ago · 5d / 2w
            / 3m / 1y
          </Text>
        </Box>
      )}
      <Box>
        <Text color={theme.help.desc}>Enter: jump Esc: cancel</Text>
      </Box>
    </Box>
  );
}
