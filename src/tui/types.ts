import type { Conversation, Message } from "../types.js";

export type FocusPane = "sidebar" | "thread";
export type Mode = "browse" | "compose" | "confirm" | "filter" | "drawer" | "select" | "export" | "date-jump";

export interface PendingMessage {
  text: string;
  sentAt: Date;
  status: "sending" | "sent" | "failed";
}

export interface AppState {
  conversations: Conversation[];
  messages: Message[];
  selectedIdx: number;
  selectedMsgIdx: number; // cursor position in messages list
  focus: FocusPane;
  mode: Mode;
  sidebarScroll: number;
  threadScroll: number;
  composeText: string;
  filterQuery: string;
  pending: PendingMessage[];
  loading: boolean;
  status: string;
  numBuffer: string; // for vim-style number prefix (e.g. "12j")
  showDevStats: boolean;

  // Lazy-loading bookkeeping
  conversationLoadedCount: number;     // how many we've requested from the DB so far
  conversationLoadingMore: boolean;     // true while a "load more" fetch is in-flight
  messageOldestLoadedId: number | null; // oldest message ROWID currently in `messages` (for "load older")
  messageLoadingOlder: boolean;         // true while a "load older" fetch is in-flight

  // Visual selection (vim V)
  selectionAnchor: number | null;       // where the user pressed V — selection extends from anchor to selectedMsgIdx

  // Export modal state
  exportFormat: "markdown" | "csv" | "json";
  exportPath: string;
  exportStatus: string;                 // last export status message (e.g. "Exported 247 msgs")

  // Date-jump modal state
  dateJumpInput: string;
  dateJumpError: string;
}

export type Action =
  | { type: "SET_CONVERSATIONS"; data: Conversation[] }
  | { type: "SET_MESSAGES"; data: Message[] }
  | { type: "SELECT"; index: number; visibleCount?: number }
  | { type: "SELECT_MSG"; index: number }
  | { type: "MOVE_MSG"; delta: number }
  | { type: "FOCUS"; pane: FocusPane }
  | { type: "SCROLL_SIDEBAR"; delta: number }
  | { type: "SCROLL_THREAD"; delta: number }
  | { type: "SCROLL_THREAD_TO"; position: number }
  | { type: "ENTER_COMPOSE" }
  | { type: "UPDATE_COMPOSE"; text: string }
  | { type: "CONFIRM_SEND" }
  | { type: "CANCEL_COMPOSE" }
  | { type: "ADD_PENDING"; msg: PendingMessage }
  | { type: "RESOLVE_PENDING"; text: string }
  | { type: "FAIL_PENDING"; text: string }
  | { type: "SET_LOADING"; loading: boolean; status?: string }
  | { type: "SET_STATUS"; status: string }
  | { type: "ENTER_FILTER" }
  | { type: "UPDATE_FILTER"; query: string }
  | { type: "EXIT_FILTER" }
  | { type: "OPEN_DRAWER" }
  | { type: "CLOSE_DRAWER" }
  | { type: "SET_NUM_BUFFER"; value: string }
  | { type: "TOGGLE_DEV_STATS" }
  | { type: "APPEND_CONVERSATIONS"; data: Conversation[]; loadedCount: number }
  | { type: "PREPEND_MESSAGES"; data: Message[]; oldestId: number }
  | { type: "SET_LOADING_OLDER"; loading: boolean }
  | { type: "ENTER_SELECT_MODE" }
  | { type: "EXIT_SELECT_MODE" }
  | { type: "ENTER_EXPORT_MODE"; defaultPath: string }
  | { type: "EXIT_EXPORT_MODE" }
  | { type: "SET_EXPORT_FORMAT"; format: "markdown" | "csv" | "json" }
  | { type: "SET_EXPORT_PATH"; path: string }
  | { type: "SET_EXPORT_STATUS"; status: string }
  | { type: "ENTER_DATE_JUMP" }
  | { type: "EXIT_DATE_JUMP" }
  | { type: "SET_DATE_JUMP_INPUT"; value: string }
  | { type: "SET_DATE_JUMP_ERROR"; error: string };

export const initialState: AppState = {
  conversations: [],
  messages: [],
  selectedIdx: 0,
  selectedMsgIdx: -1,
  focus: "sidebar",
  mode: "browse",
  sidebarScroll: 0,
  threadScroll: 0,
  composeText: "",
  filterQuery: "",
  pending: [],
  loading: true,
  status: "Loading...",
  numBuffer: "",
  showDevStats: false,
  conversationLoadedCount: 0,
  conversationLoadingMore: false,
  messageOldestLoadedId: null,
  messageLoadingOlder: false,
  selectionAnchor: null,
  exportFormat: "markdown",
  exportPath: "",
  exportStatus: "",
  dateJumpInput: "",
  dateJumpError: "",
};

/** Clamp message cursor and ensure it's visible by adjusting scroll */
function clampMsg(state: AppState, idx: number): Partial<AppState> {
  const total = state.messages.length;
  if (total === 0) return { selectedMsgIdx: -1 };
  const clamped = Math.max(0, Math.min(idx, total - 1));
  return { selectedMsgIdx: clamped };
}

/**
 * Compute a `sidebarScroll` value that keeps `selectedIdx` inside the
 * visible window. Adds a 2-row buffer at each edge so the user sees what's
 * coming next when navigating with j/k. Pure function — used by reducer.
 *
 * @param selectedIdx the cursor's target index
 * @param currentScroll the current sidebar scroll offset
 * @param visibleCount how many items fit on-screen at once
 * @param totalCount total items available (for clamping)
 */
export function ensureVisibleScroll(
  selectedIdx: number,
  currentScroll: number,
  visibleCount: number,
  totalCount: number,
): number {
  if (visibleCount <= 0 || totalCount <= 0) return 0;
  const buffer = Math.min(2, Math.floor(visibleCount / 4));
  // If cursor is above the visible window (with buffer), scroll up
  if (selectedIdx < currentScroll + buffer) {
    return Math.max(0, selectedIdx - buffer);
  }
  // If cursor is below the visible window (with buffer), scroll down
  const lastVisible = currentScroll + visibleCount - 1;
  if (selectedIdx > lastVisible - buffer) {
    return Math.min(
      Math.max(0, totalCount - visibleCount),
      selectedIdx - visibleCount + 1 + buffer,
    );
  }
  // Already visible — don't move
  return Math.max(0, Math.min(currentScroll, Math.max(0, totalCount - visibleCount)));
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_CONVERSATIONS":
      return {
        ...state,
        conversations: action.data,
        conversationLoadedCount: action.data.length,
        conversationLoadingMore: false,
      };
    case "APPEND_CONVERSATIONS": {
      // Merge new entries by threadSlug (DB returns the same recent ones too)
      const existing = new Set(state.conversations.map((c) => c.threadSlug));
      const fresh = action.data.filter((c) => !existing.has(c.threadSlug));
      return {
        ...state,
        conversations: [...state.conversations, ...fresh],
        conversationLoadedCount: action.loadedCount,
        conversationLoadingMore: false,
      };
    }
    case "SET_MESSAGES": {
      // Scroll to bottom: set cursor to last message
      const msgs = action.data;
      const lastIdx = Math.max(0, msgs.length - 1);
      // Set threadScroll high so the view shows the bottom
      const scrollToEnd = Math.max(0, msgs.length);
      const oldestId = msgs.length > 0 ? Math.min(...msgs.map((m) => m.id)) : null;
      return {
        ...state,
        messages: msgs,
        pending: [],
        selectedMsgIdx: lastIdx,
        threadScroll: scrollToEnd,
        messageOldestLoadedId: oldestId,
        messageLoadingOlder: false,
      };
    }
    case "PREPEND_MESSAGES": {
      // Merge older messages at the start; dedup by id; preserve cursor on the
      // same logical message by shifting selectedMsgIdx by the count added.
      const existingIds = new Set(state.messages.map((m) => m.id));
      const fresh = action.data.filter((m) => !existingIds.has(m.id));
      const merged = [...fresh, ...state.messages].sort((a, b) => a.date.getTime() - b.date.getTime());
      const shift = fresh.length;
      return {
        ...state,
        messages: merged,
        selectedMsgIdx: state.selectedMsgIdx >= 0 ? state.selectedMsgIdx + shift : state.selectedMsgIdx,
        messageOldestLoadedId: action.oldestId,
        messageLoadingOlder: false,
      };
    }
    case "SET_LOADING_OLDER":
      return { ...state, messageLoadingOlder: action.loading };
    case "ENTER_SELECT_MODE":
      return { ...state, mode: "select", selectionAnchor: state.selectedMsgIdx };
    case "EXIT_SELECT_MODE":
      return { ...state, mode: "browse", selectionAnchor: null };
    case "ENTER_EXPORT_MODE":
      return { ...state, mode: "export", exportPath: action.defaultPath };
    case "EXIT_EXPORT_MODE":
      return { ...state, mode: state.selectionAnchor != null ? "select" : "browse" };
    case "SET_EXPORT_FORMAT":
      return { ...state, exportFormat: action.format };
    case "SET_EXPORT_PATH":
      return { ...state, exportPath: action.path };
    case "SET_EXPORT_STATUS":
      return { ...state, exportStatus: action.status };
    case "ENTER_DATE_JUMP":
      return { ...state, mode: "date-jump", dateJumpInput: "", dateJumpError: "" };
    case "EXIT_DATE_JUMP":
      return { ...state, mode: "browse", dateJumpInput: "", dateJumpError: "" };
    case "SET_DATE_JUMP_INPUT":
      return { ...state, dateJumpInput: action.value, dateJumpError: "" };
    case "SET_DATE_JUMP_ERROR":
      return { ...state, dateJumpError: action.error };
    case "SELECT": {
      const idx = Math.max(0, Math.min(action.index, Math.max(0, state.conversations.length - 1)));
      const sidebarScroll = action.visibleCount
        ? ensureVisibleScroll(idx, state.sidebarScroll, action.visibleCount, state.conversations.length)
        : state.sidebarScroll;
      return { ...state, selectedIdx: idx, sidebarScroll };
    }
    case "SELECT_MSG": {
      const c = clampMsg(state, action.index);
      return { ...state, ...c };
    }
    case "MOVE_MSG": {
      const c = clampMsg(state, state.selectedMsgIdx + action.delta);
      return { ...state, ...c };
    }
    case "FOCUS":
      return { ...state, focus: action.pane, numBuffer: "" };
    case "SCROLL_SIDEBAR":
      return { ...state, sidebarScroll: Math.max(0, state.sidebarScroll + action.delta) };
    case "SCROLL_THREAD":
      return { ...state, threadScroll: Math.max(0, state.threadScroll + action.delta) };
    case "SCROLL_THREAD_TO":
      return { ...state, threadScroll: Math.max(0, action.position) };
    case "ENTER_COMPOSE":
      return { ...state, mode: "compose", composeText: "", focus: "thread" };
    case "UPDATE_COMPOSE":
      return { ...state, composeText: action.text };
    case "CONFIRM_SEND":
      return { ...state, mode: "confirm" };
    case "CANCEL_COMPOSE":
      return { ...state, mode: "browse", composeText: "" };
    case "ADD_PENDING":
      return { ...state, mode: "browse", composeText: "", pending: [...state.pending, action.msg] };
    case "RESOLVE_PENDING":
      return { ...state, pending: state.pending.filter((p) => p.text !== action.text) };
    case "FAIL_PENDING":
      return {
        ...state,
        pending: state.pending.map((p) => (p.text === action.text ? { ...p, status: "failed" as const } : p)),
      };
    case "SET_LOADING":
      return { ...state, loading: action.loading, status: action.status ?? state.status };
    case "SET_STATUS":
      return { ...state, status: action.status };
    case "ENTER_FILTER":
      return { ...state, mode: "filter", filterQuery: "", focus: "sidebar" };
    case "UPDATE_FILTER":
      return { ...state, filterQuery: action.query };
    case "EXIT_FILTER":
      return { ...state, mode: "browse", filterQuery: "" };
    case "OPEN_DRAWER":
      return { ...state, mode: "drawer" };
    case "CLOSE_DRAWER":
      return { ...state, mode: "browse" };
    case "SET_NUM_BUFFER":
      return { ...state, numBuffer: action.value };
    case "TOGGLE_DEV_STATS":
      return { ...state, showDevStats: !state.showDevStats };
    default:
      return state;
  }
}
