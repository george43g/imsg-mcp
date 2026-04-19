/** iMessage-inspired color theme for the TUI. */
export const theme = {
  sent: { bg: "#1982FC", fg: "#FFFFFF", border: "#1464C8" },
  received: { bg: "#E5E5EA", fg: "#1E1E1E", border: "#BEC0C3" },
  pending: { bg: "#3C3C41", fg: "#B4B4B9", border: "#505055" },
  sidebar: {
    selected: "#1E3C6E",
    selectedFg: "#FFFFFF",
    unread: "#FFFFFF",
    read: "#B4B4B9",
    snippet: "#78787D",
    slug: "#505055",
    time: "#78787D",
  },
  border: "#3C3C41",
  dot: "#1982FC",
  header: { focused: { bg: "#2D2D32", fg: "#FFFFFF" }, dim: { bg: "#1E1E23", fg: "#78787D" } },
  info: { label: "#969699", value: "#D2D2D7" },
  timestamp: "#64646A",
  status: { bg: "#1E1E23", fg: "#B4B4B9", accent: "#1982FC" },
  help: { key: "#B4B4B9", desc: "#64646A" },
  sms: "#5AC85A",
  edited: "#96821E",
  compose: { bg: "#28282D", fg: "#FFFFFF", placeholder: "#64646A" },
} as const;

export const TAPBACK_EMOJI: Record<string, string> = {
  love: "❤️",
  like: "👍",
  dislike: "👎",
  laugh: "😂",
  emphasize: "‼️",
  question: "❓",
};
