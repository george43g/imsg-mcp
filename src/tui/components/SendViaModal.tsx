/**
 * Send-via modal — pick an installed external chat app and launch its URL
 * scheme deep-link for the current thread's handle. Triggered by `S` in
 * thread pane (TUI handler in App.tsx).
 *
 * Renders a numbered list of installed apps. Press `1`–`9` to launch,
 * Esc to cancel. The TUI's mode-level `useInput` handler in App.tsx
 * actually does the launching; this component is presentation-only.
 */
import { Box, Text } from "ink";
import type { ChatAppDef } from "../../url-schemes.js";
import { useTheme } from "../themes/ThemeContext.js";

interface Props {
  handle: string;
  apps: ChatAppDef[];
}

export function SendViaModal({ handle, apps }: Props) {
  const theme = useTheme();
  return (
    <Box flexDirection="column" borderStyle="double" borderColor={theme.status.accent} paddingX={1}>
      <Text color={theme.status.accent} bold>
        Send via external app
      </Text>
      <Text color={theme.help.desc}>Handle: {handle}</Text>
      <Box flexDirection="column" marginTop={1}>
        {apps.length === 0 ? (
          <Text color={theme.help.desc}>No compatible apps installed.</Text>
        ) : (
          apps.map((a, i) => (
            <Box key={a.name}>
              <Text color={theme.help.key}>{i + 1}</Text>
              <Text color={theme.help.desc}>
                {": "}
                {a.name}
                {a.supportsBody ? "" : " (no body support)"}
              </Text>
            </Box>
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.help.desc}>1-9: launch · Esc: cancel</Text>
      </Box>
    </Box>
  );
}
