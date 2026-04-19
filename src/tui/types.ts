import type { Conversation, Message } from "../types.js";

export type FocusPane = "sidebar" | "thread";
export type Mode = "browse" | "compose" | "confirm" | "filter";

export interface PendingMessage {
  text: string;
  sentAt: Date;
  status: "sending" | "sent" | "failed";
}

export interface AppState {
  conversations: Conversation[];
  messages: Message[];
  selectedIdx: number;
  focus: FocusPane;
  mode: Mode;
  sidebarScroll: number;
  threadScroll: number;
  composeText: string;
  filterQuery: string;
  pending: PendingMessage[];
  loading: boolean;
  status: string;
}

export type Action =
  | { type: "SET_CONVERSATIONS"; data: Conversation[] }
  | { type: "SET_MESSAGES"; data: Message[] }
  | { type: "SELECT"; index: number }
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
  | { type: "EXIT_FILTER" };

export const initialState: AppState = {
  conversations: [],
  messages: [],
  selectedIdx: 0,
  focus: "sidebar",
  mode: "browse",
  sidebarScroll: 0,
  threadScroll: 0,
  composeText: "",
  filterQuery: "",
  pending: [],
  loading: true,
  status: "Loading...",
};

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_CONVERSATIONS":
      return { ...state, conversations: action.data };
    case "SET_MESSAGES":
      return { ...state, messages: action.data, pending: [], threadScroll: 0 };
    case "SELECT":
      return { ...state, selectedIdx: action.index };
    case "FOCUS":
      return { ...state, focus: action.pane };
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
    default:
      return state;
  }
}
