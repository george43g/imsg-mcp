/** iMessage-inspired color theme for the TUI — optimized for scannability. */
export const theme = {
  sent: { bg: "#1982FC", fg: "#FFFFFF", border: "#1464C8" },
  received: { bg: "#E5E5EA", fg: "#1E1E1E", border: "#BEC0C3" },
  pending: { bg: "#3C3C41", fg: "#B4B4B9", border: "#505055" },

  // Compact message colors
  sentText: "#8CB8FF", // light blue for sent message text
  receivedText: "#D2D2D7", // light gray for received message text
  senderName: "#5AC8C8", // teal for other people's names
  replyContext: "#9090A0", // muted but readable on dark group bgs
  attachment: "#FFB347", // orange for attachment indicator
  lineNum: "#646470", // visible on group backgrounds without screaming

  // Alternating group backgrounds for sender contrast
  groupBg: {
    sent: "#14213D", // dark navy tint for sent groups
    received: "#1A1A2E", // dark purple-gray tint for received groups
  },

  // Background tint for messages in an active visual selection (V mode)
  selectionBg: "#3C3814", // muted yellow — visible against dark group bgs but not screaming

  sidebar: {
    selected: "#1E3C6E",
    selectedFg: "#FFFFFF",
    unread: "#FFFFFF",
    read: "#B4B4B9",
    snippet: "#78787D",
    slug: "#7878A0",
    slugBg: "#1A1A1F",
    separator: "#2D2D32",
    time: "#78787D",
  },
  border: "#3C3C41",
  dot: "#1982FC",
  header: { focused: { bg: "#2D2D32", fg: "#FFFFFF" }, dim: { bg: "#1E1E23", fg: "#78787D" } },
  info: { label: "#969699", value: "#D2D2D7" },
  timestamp: "#9090A0",
  status: { bg: "#1E1E23", fg: "#B4B4B9", accent: "#1982FC" },
  help: { key: "#B4B4B9", desc: "#64646A" },
  sms: "#5AC85A",
  edited: "#96821E",
  compose: { bg: "#28282D", fg: "#FFFFFF", placeholder: "#64646A" },

  // Date separator
  dateSep: "#505055",

  // Drawer
  drawer: { bg: "#1E1E23", border: "#3C3C41", label: "#969699", value: "#D2D2D7" },
} as const;

/** Nerd Font / Powerline glyphs and Unicode symbols. */
export const glyphs = {
  /** Powerline arrow separators */
  arrowRight: "\uE0B0", //
  arrowRightThin: "\uE0B1", //
  arrowLeft: "\uE0B2", //
  arrowLeftThin: "\uE0B3", //

  /** Direction indicators for messages.
   * ASCII-safe / East-Asian fixed-width chars, NOT Powerline glyphs.
   * Powerline arrows are private-use Unicode that many terminal fonts
   * render at fractional cell width, which made vertical dividers in
   * the thread pane drift left/right between rows. */
  sent: "\u25B6", // sent (us -> them)
  received: "\u25C0", // received (them -> us)

  /** Status indicators */
  unreadDot: "●",
  envelope: "✉",

  /** Service icons */
  iMessage: "💬",
  sms: "📱",

  /** Misc */
  paperclip: "📎",
  group: "☰",
  search: "⌕",
  pencil: "✎",
  refresh: "↻",
  separator: "─",
} as const;

export const TAPBACK_EMOJI: Record<string, string> = {
  love: "❤️",
  like: "👍",
  dislike: "👎",
  laugh: "😂",
  emphasize: "‼️",
  question: "❓",
};
