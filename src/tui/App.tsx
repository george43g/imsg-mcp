import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { useScreenSize } from "fullscreen-ink";
import { Box, useApp, useInput } from "ink";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { registerCleanup } from "../shutdown.js";
import { minMessageId } from "../types.js";
import { getInstalledChatApps } from "../url-schemes.js";
import { ComposeRecipientModal } from "./components/ComposeRecipientModal.js";
import { DateJumpModal } from "./components/DateJumpModal.js";
import { CompactStats, DevStats } from "./components/DevStats.js";
import { ExportModal } from "./components/ExportModal.js";
import { HelpBar } from "./components/HelpBar.js";
import { MessageDrawer } from "./components/MessageDrawer.js";
import { SendViaModal } from "./components/SendViaModal.js";
import { Sidebar } from "./components/Sidebar.js";
import { StatusBar } from "./components/StatusBar.js";
import { nextGroupBoundary, prevGroupBoundary, ThreadPane } from "./components/ThreadPane.js";
import { formatJumpTarget, parseUserDate } from "./dateParse.js";
import { extensionFor, toCSV, toJSON, toMarkdown } from "./exportFormats.js";
import { firstFilterMatchIndex } from "./filter.js";
import { useDevStats } from "./hooks/useDevStats.js";
import { useImsg } from "./hooks/useImsg.js";
import { useMouse } from "./hooks/useMouse.js";
import { initialState, reducer } from "./types.js";

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { exit } = useApp();
  const { width: columns, height: rows } = useScreenSize();
  const imsg = useImsg();
  const { stats: devStats, recordQueryTime } = useDevStats(state.showDevStats);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ggPendingRef = useRef(false); // tracks if 'g' was pressed, waiting for second 'g'
  const ggTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const drawerWidth = state.mode === "drawer" ? Math.min(Math.floor(columns * 0.35), 50) : 0;
  const devStatsWidth = state.showDevStats ? 20 : 0;
  const sidebarWidth = Math.max(Math.floor((columns - drawerWidth - devStatsWidth) * 0.32), 28);
  const threadWidth = Math.max(columns - sidebarWidth - drawerWidth - devStatsWidth, 20);
  const bodyHeight = rows - 2; // status + help

  // Sidebar item layout: each item = 4 rows (name + snippet + slug + separator)
  // Header row + filter row + borders subtract from available height.
  // Mirror the calculation in Sidebar.tsx so SELECT dispatches include the
  // right visible-count and the cursor stays on screen as the user navigates.
  const SIDEBAR_ITEM_HEIGHT = 4;
  const sidebarVisibleCount = Math.max(
    Math.floor((bodyHeight - 1 - (state.filterQuery ? 1 : 0) - 2) / SIDEBAR_ITEM_HEIGHT),
    1,
  );

  const selected = state.conversations[state.selectedIdx];
  const totalUnread = state.conversations.reduce((s, c) => s + c.unreadCount, 0);
  const resolvedNames = selected ? imsg.resolveNames(selected.participants) : [];
  const selectedMsg = state.selectedMsgIdx >= 0 ? state.messages[state.selectedMsgIdx] : undefined;

  // ── Data loading ───────────────────────────────────────────────────

  const loadMessages = useCallback(
    async (idx: number) => {
      const conv = state.conversations[idx];
      if (!conv) return;
      dispatch({
        type: "SET_LOADING",
        loading: true,
        status: `Loading ${conv.displayName ?? conv.chatIdentifier}...`,
      });
      const t0 = performance.now();
      const msgs = await imsg.loadMessages(conv.chatIdentifier);
      recordQueryTime(performance.now() - t0);
      dispatch({ type: "SET_MESSAGES", data: msgs });
      dispatch({ type: "SET_LOADING", loading: false, status: "" });
    },
    [state.conversations, imsg, recordQueryTime],
  );

  const refreshAll = useCallback(async () => {
    dispatch({ type: "SET_LOADING", loading: true, status: "Refreshing..." });
    const convs = await imsg.loadConversations();
    dispatch({ type: "SET_CONVERSATIONS", data: convs });
    if (convs.length > 0) {
      const prevSlug = selected?.threadSlug;
      if (prevSlug) {
        const idx = convs.findIndex((c) => c.threadSlug === prevSlug);
        if (idx >= 0) dispatch({ type: "SELECT", index: idx, visibleCount: sidebarVisibleCount });
      }
      await loadMessages(state.selectedIdx);
    }
    imsg.refresh();
    dispatch({ type: "SET_LOADING", loading: false, status: "" });
  }, [imsg, loadMessages, selected?.threadSlug, state.selectedIdx, sidebarVisibleCount]);

  // ── Lazy-load more conversations when user nears the end ──────────────
  const NEAR_END_THRESHOLD = 20;
  const CONV_BATCH_SIZE = 100;

  const loadMoreConversations = useCallback(async () => {
    if (state.conversationLoadingMore) return;
    const targetCount = state.conversationLoadedCount + CONV_BATCH_SIZE;
    dispatch({ type: "SET_STATUS", status: `Loading more conversations (${targetCount})...` });
    const convs = await imsg.loadConversations(targetCount);
    dispatch({ type: "APPEND_CONVERSATIONS", data: convs, loadedCount: targetCount });
    dispatch({ type: "SET_STATUS", status: "" });
  }, [imsg, state.conversationLoadingMore, state.conversationLoadedCount]);

  // ── Lazy-load older messages when cursor nears the top ────────────────
  const NEAR_TOP_THRESHOLD = 10;
  const _MSG_BATCH_SIZE = 100;

  const loadOlderMessages = useCallback(async () => {
    if (!selected) return;
    if (state.messageLoadingOlder) return;
    if (state.messageOldestLoadedId == null) return;
    dispatch({ type: "SET_LOADING_OLDER", loading: true });
    const olderMsgs = await imsg.loadOlderMessages(
      selected.chatIdentifier,
      state.messageOldestLoadedId,
    );
    if (olderMsgs.length === 0) {
      // Chat history exhausted — keep flag clear, mark id at -1 sentinel so we
      // don't keep retrying on every cursor move at the top.
      dispatch({ type: "PREPEND_MESSAGES", data: [], oldestId: -1 });
      return;
    }
    const newOldestId = minMessageId(olderMsgs) ?? -1;
    dispatch({ type: "PREPEND_MESSAGES", data: olderMsgs, oldestId: newOldestId });
  }, [imsg, selected, state.messageLoadingOlder, state.messageOldestLoadedId]);

  // Trigger when cursor approaches the start of the message list
  useEffect(() => {
    if (state.loading || state.messageLoadingOlder) return;
    if (state.messages.length === 0) return;
    if (state.messageOldestLoadedId === -1) return; // exhausted
    if (state.selectedMsgIdx >= 0 && state.selectedMsgIdx < NEAR_TOP_THRESHOLD) {
      loadOlderMessages();
    }
  }, [
    state.selectedMsgIdx,
    state.messages.length,
    state.messageOldestLoadedId,
    state.messageLoadingOlder,
    state.loading,
    loadOlderMessages,
  ]);

  // Trigger lazy-load when cursor or scroll is near the end of loaded items.
  // Important: only fire when we've actually grown — DB returns N when N requested,
  // so once `conversations.length === conversationLoadedCount` and we asked for
  // 200, asking for 300 may yield no new entries (chat history exhausted).
  useEffect(() => {
    if (state.loading || state.conversationLoadingMore) return;
    if (state.conversations.length === 0) return;
    const cursorNearEnd = state.selectedIdx >= state.conversations.length - NEAR_END_THRESHOLD;
    const scrollNearEnd =
      state.sidebarScroll + sidebarVisibleCount >= state.conversations.length - NEAR_END_THRESHOLD;
    if (cursorNearEnd || scrollNearEnd) {
      // Only ask for more if we haven't seen this chat-count plateau yet
      if (state.conversationLoadedCount === state.conversations.length) {
        loadMoreConversations();
      }
    }
  }, [
    state.selectedIdx,
    state.sidebarScroll,
    state.conversations.length,
    state.conversationLoadedCount,
    state.conversationLoadingMore,
    state.loading,
    sidebarVisibleCount,
    loadMoreConversations,
  ]);

  // Initial load + register cleanup
  // biome-ignore lint/correctness/useExhaustiveDependencies: we intentionally run this only on mount to prevent a render-loop
  useEffect(() => {
    registerCleanup(() => imsg.close());
    refreshAll();
  }, [imsg.close]);

  // ── Send logic ─────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    if (!selected || !state.composeText.trim()) return;
    const text = state.composeText.trim();
    dispatch({ type: "ADD_PENDING", msg: { text, sentAt: new Date(), status: "sending" } });

    const result = await imsg.send(selected.threadSlug, text);
    if (!result.success) {
      dispatch({ type: "FAIL_PENDING", text });
      return;
    }

    let attempt = 0;
    const poll = async () => {
      // Check if we are still polling for this request (unmounted or cancelled)
      if (!pollTimerRef.current) return;
      attempt++;
      const msgs = await imsg.loadMessages(selected.chatIdentifier);
      const found = msgs.some((m) => m.isFromMe && m.text?.includes(text));
      if (found) {
        dispatch({ type: "SET_MESSAGES", data: msgs });
        dispatch({ type: "RESOLVE_PENDING", text });
      } else if (attempt < 7) {
        pollTimerRef.current = setTimeout(poll, 1500);
      }
    };
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(poll, 1500);
  }, [selected, state.composeText, imsg]);

  // ── Vim number prefix helper ───────────────────────────────────────

  const getCount = useCallback((): number => {
    const n = state.numBuffer ? Number.parseInt(state.numBuffer, 10) : 1;
    dispatch({ type: "SET_NUM_BUFFER", value: "" });
    return Math.max(1, Math.min(n, 999));
  }, [state.numBuffer]);

  // ── Keyboard ───────────────────────────────────────────────────────

  useInput(async (input, key) => {
    // Ctrl-C always exits
    if (key.ctrl && input === "c") {
      await imsg.close();
      exit();
      return;
    }

    // Filter mode
    if (state.mode === "filter") {
      if (key.return) {
        // Enter commits the filter: jump cursor to the first matching
        // conversation, then exit filter. Esc-only path below preserves the
        // pre-filter cursor (cancel semantics). Previously both keys exited
        // without navigating, which made the filter feel inert.
        const matchIdx = firstFilterMatchIndex(state.conversations, state.filterQuery);
        if (matchIdx !== null) {
          dispatch({ type: "SELECT", index: matchIdx });
        }
        dispatch({ type: "EXIT_FILTER" });
      } else if (key.escape) {
        dispatch({ type: "EXIT_FILTER" });
      } else if (key.backspace || key.delete) {
        dispatch({ type: "UPDATE_FILTER", query: state.filterQuery.slice(0, -1) });
      } else if (input && !key.ctrl && !key.meta) {
        dispatch({ type: "UPDATE_FILTER", query: state.filterQuery + input });
      }
      return;
    }

    // Compose mode
    if (state.mode === "compose") {
      if (key.escape) {
        dispatch({ type: "CANCEL_COMPOSE" });
      } else if (key.return && state.composeText.trim()) {
        dispatch({ type: "CONFIRM_SEND" });
      }
      return;
    }

    // Confirm mode
    if (state.mode === "confirm") {
      if (key.return) {
        await sendMessage();
      } else {
        dispatch({ type: "CANCEL_COMPOSE" });
      }
      return;
    }

    // Drawer mode
    if (state.mode === "drawer") {
      if (key.escape || input === "q") {
        dispatch({ type: "CLOSE_DRAWER" });
      } else if (input === "o" && selectedMsg) {
        // Open attachment in external viewer
        openAttachment(selectedMsg);
      }
      return;
    }

    // Date-jump modal mode — Esc cancels; Enter handled by TextInput.onSubmit
    if (state.mode === "date-jump") {
      if (key.escape) {
        dispatch({ type: "EXIT_DATE_JUMP" });
      }
      return;
    }

    // Send-via modal: digit picks an app + launches its URL-scheme deep link.
    if (state.mode === "send-via") {
      if (key.escape) {
        dispatch({ type: "EXIT_SEND_VIA" });
        return;
      }
      if (input && /^[1-9]$/.test(input) && selected) {
        const apps = getInstalledChatApps();
        const idx = Number.parseInt(input, 10) - 1;
        const app = apps[idx];
        if (app) {
          const lastMsgText = state.messages.length
            ? (state.messages[state.messages.length - 1]?.text ?? undefined)
            : undefined;
          const built = app.buildUri(selected.chatIdentifier, lastMsgText);
          if (built) {
            (await import("node:child_process"))
              .spawn("open", [built], { detached: true, stdio: "ignore" })
              .unref();
            dispatch({ type: "SET_STATUS", status: `Launched ${app.name}` });
          } else {
            dispatch({
              type: "SET_STATUS",
              status: `${app.name}: handle not compatible with this scheme`,
            });
          }
        }
        dispatch({ type: "EXIT_SEND_VIA" });
        setTimeout(() => dispatch({ type: "SET_STATUS", status: "" }), 2500);
      }
      return;
    }

    // Export-modal mode — Tab cycles format, Esc cancels.
    // Path text input + Enter handled by the inline TextInput inside the modal.
    if (state.mode === "export") {
      if (key.escape) {
        dispatch({ type: "EXIT_EXPORT_MODE" });
      } else if (key.tab) {
        const order: Array<"markdown" | "csv" | "json"> = ["markdown", "csv", "json"];
        const next = order[(order.indexOf(state.exportFormat) + 1) % order.length];
        dispatch({ type: "SET_EXPORT_FORMAT", format: next });
        // Update path extension to match new format
        const stripped = state.exportPath.replace(/\.(md|csv|json)$/, "");
        dispatch({ type: "SET_EXPORT_PATH", path: `${stripped}.${extensionFor(next)}` });
      }
      return;
    }

    // Select mode — V'd. j/k extend, Esc exits, e opens export modal,
    // y copies selected text to clipboard.
    if (state.mode === "select") {
      if (key.escape) {
        dispatch({ type: "EXIT_SELECT_MODE" });
        return;
      }
      if (input === "e") {
        const slug = selected?.threadSlug ?? "messages";
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const defaultPath = join(homedir(), `imsg-export-${slug}-${stamp}.md`);
        dispatch({ type: "ENTER_EXPORT_MODE", defaultPath });
        return;
      }
      if (input === "y" && state.selectionAnchor != null) {
        const [lo, hi] = [
          Math.min(state.selectionAnchor, state.selectedMsgIdx),
          Math.max(state.selectionAnchor, state.selectedMsgIdx),
        ];
        const text = state.messages
          .slice(lo, hi + 1)
          .map(
            (m) =>
              `[${m.date.toISOString()}] ${m.isFromMe ? "Me" : (m.displayName ?? m.handle)}: ${m.text ?? "(no text)"}`,
          )
          .join("\n");
        try {
          execSync("pbcopy", { input: text });
          dispatch({ type: "SET_STATUS", status: `Copied ${hi - lo + 1} msgs` });
        } catch {
          dispatch({ type: "SET_STATUS", status: "Copy failed" });
        }
        setTimeout(() => dispatch({ type: "SET_STATUS", status: "" }), 2000);
        return;
      }
      // j/k/G/gg/Ctrl-d/Ctrl-u — fall through to browse-mode movement (anchor stays)
    }

    // Browse mode
    if (input === "d" && !key.ctrl && !key.meta && state.mode === "browse") {
      dispatch({ type: "TOGGLE_DEV_STATS" });
      return;
    }
    if (input === "V" && state.focus === "thread" && state.selectedMsgIdx >= 0) {
      dispatch({ type: "ENTER_SELECT_MODE" });
      return;
    }
    if (input === ":" && state.focus === "thread" && state.mode === "browse") {
      dispatch({ type: "ENTER_DATE_JUMP" });
      return;
    }
    // O — open the current thread in Messages.app via the imessage:// URL scheme.
    // For 1:1 chats this focuses or composes that thread. Groups have no URL
    // scheme — we fall back to AppleScript activate.
    if (
      input === "O" &&
      !key.ctrl &&
      !key.meta &&
      state.focus === "thread" &&
      state.mode === "browse" &&
      selected
    ) {
      const handle = selected.chatIdentifier;
      const uri = `imessage://${encodeURIComponent(handle)}`;
      (await import("node:child_process"))
        .spawn("open", [uri], { detached: true, stdio: "ignore" })
        .unref();
      dispatch({ type: "SET_STATUS", status: `Opened ${handle} in Messages.app` });
      setTimeout(() => dispatch({ type: "SET_STATUS", status: "" }), 2500);
      return;
    }
    // S — send-via picker: list installed external chat apps and let the user
    // launch one. Body is the most recent message text in the thread (best-
    // effort context); the URI carries it only on schemes that support body.
    if (
      input === "S" &&
      !key.ctrl &&
      !key.meta &&
      state.focus === "thread" &&
      state.mode === "browse" &&
      selected
    ) {
      dispatch({ type: "ENTER_SEND_VIA" });
      return;
    }
    if (input === "q") {
      await imsg.close();
      exit();
      return;
    }
    if (input === "r") {
      await refreshAll();
      return;
    }
    // N (uppercase) opens compose-to-new-thread from anywhere in browse mode.
    // Distinct from `c` which composes WITHIN the currently-selected thread.
    if (input === "N" && state.mode === "browse") {
      dispatch({ type: "ENTER_COMPOSE_NEW" });
      return;
    }
    if (input === "c" || (key.return && state.focus === "thread" && state.mode === "browse")) {
      if (state.focus === "thread" && key.return && state.selectedMsgIdx >= 0) {
        // Enter on a message opens drawer
        dispatch({ type: "OPEN_DRAWER" });
        return;
      }
      // `c` from sidebar with no selected thread → fall through to compose-new
      // so the user always gets a meaningful action.
      if (state.focus === "sidebar" && !selected) {
        dispatch({ type: "ENTER_COMPOSE_NEW" });
        return;
      }
      dispatch({ type: "ENTER_COMPOSE" });
      return;
    }
    if (input === "/" && state.mode === "browse") {
      dispatch({ type: "ENTER_FILTER" });
      return;
    }
    if (key.tab) {
      dispatch({ type: "FOCUS", pane: state.focus === "sidebar" ? "thread" : "sidebar" });
      return;
    }

    if (state.loading) return;

    // Number buffer for vim-style counts (e.g. "12j" to jump 12 lines)
    if (input && input >= "0" && input <= "9" && !key.ctrl && !key.meta) {
      // Don't buffer leading zeros unless building a number
      if (input === "0" && !state.numBuffer) {
        // '0' alone: go to first item (like vim)
        if (state.focus === "sidebar") {
          dispatch({ type: "SELECT", index: 0, visibleCount: sidebarVisibleCount });
          loadMessages(0);
        } else {
          dispatch({ type: "SELECT_MSG", index: 0 });
        }
        return;
      }
      dispatch({ type: "SET_NUM_BUFFER", value: state.numBuffer + input });
      return;
    }

    if (state.focus === "sidebar") {
      // Copy thread slug to clipboard
      if (input === "y" && selected) {
        try {
          execSync("pbcopy", { input: `~${selected.threadSlug}` });
          dispatch({ type: "SET_STATUS", status: `Copied ~${selected.threadSlug}` });
          setTimeout(() => dispatch({ type: "SET_STATUS", status: "" }), 2000);
        } catch {
          dispatch({ type: "SET_STATUS", status: "Failed to copy" });
        }
        return;
      }

      const count = getCount();
      let next: number | null = null;

      if (input === "j" || key.downArrow) {
        next = Math.min(state.selectedIdx + count, state.conversations.length - 1);
      } else if (input === "k" || key.upArrow) {
        next = Math.max(state.selectedIdx - count, 0);
      } else if (input === "G") {
        next = state.conversations.length - 1;
      } else if (input === "g") {
        // Handle gg (go to top)
        if (ggPendingRef.current) {
          ggPendingRef.current = false;
          if (ggTimerRef.current) clearTimeout(ggTimerRef.current);
          next = 0;
        } else {
          ggPendingRef.current = true;
          // 350ms is the typical vim chord window — feels snappy without
          // false-positive-firing on a slow second keypress. Was 500ms.
          ggTimerRef.current = setTimeout(() => {
            ggPendingRef.current = false;
          }, 350);
          return;
        }
      } else if (key.ctrl && input === "d") {
        // Half page down
        next = Math.min(
          state.selectedIdx + Math.floor(bodyHeight / 2),
          state.conversations.length - 1,
        );
      } else if (key.ctrl && input === "u") {
        // Half page up
        next = Math.max(state.selectedIdx - Math.floor(bodyHeight / 2), 0);
      } else if ((key.ctrl && input === "f") || key.pageDown) {
        next = Math.min(state.selectedIdx + bodyHeight, state.conversations.length - 1);
      } else if ((key.ctrl && input === "b") || key.pageUp) {
        next = Math.max(state.selectedIdx - bodyHeight, 0);
      } else if (input === "H") {
        // High - first visible
        next = state.sidebarScroll;
      } else if (input === "M") {
        // Middle
        next = Math.min(
          state.sidebarScroll + Math.floor(bodyHeight / 2),
          state.conversations.length - 1,
        );
      } else if (input === "L") {
        // Low - last visible
        next = Math.min(state.sidebarScroll + bodyHeight - 1, state.conversations.length - 1);
      }

      if (next !== null && next !== state.selectedIdx) {
        dispatch({ type: "SELECT", index: next, visibleCount: sidebarVisibleCount });
        // Debounce message loading
        if (moveDebounceRef.current) clearTimeout(moveDebounceRef.current);
        const target = next;
        moveDebounceRef.current = setTimeout(() => {
          moveDebounceRef.current = null;
          loadMessages(target);
        }, 80);
      }
    } else {
      // Thread focus — message cursor movement
      const count = getCount();

      if (input === "j" || key.downArrow) {
        dispatch({ type: "MOVE_MSG", delta: count });
      } else if (input === "k" || key.upArrow) {
        dispatch({ type: "MOVE_MSG", delta: -count });
      } else if (input === "G") {
        dispatch({ type: "SELECT_MSG", index: state.messages.length - 1 });
      } else if (input === "g") {
        if (ggPendingRef.current) {
          ggPendingRef.current = false;
          if (ggTimerRef.current) clearTimeout(ggTimerRef.current);
          dispatch({ type: "SELECT_MSG", index: 0 });
        } else {
          ggPendingRef.current = true;
          // 350ms is the typical vim chord window — feels snappy without
          // false-positive-firing on a slow second keypress. Was 500ms.
          ggTimerRef.current = setTimeout(() => {
            ggPendingRef.current = false;
          }, 350);
        }
      } else if (key.ctrl && input === "d") {
        dispatch({ type: "MOVE_MSG", delta: Math.floor(bodyHeight / 2) });
      } else if (key.ctrl && input === "u") {
        dispatch({ type: "MOVE_MSG", delta: -Math.floor(bodyHeight / 2) });
      } else if ((key.ctrl && input === "f") || key.pageDown) {
        dispatch({ type: "MOVE_MSG", delta: bodyHeight });
      } else if ((key.ctrl && input === "b") || key.pageUp) {
        dispatch({ type: "MOVE_MSG", delta: -bodyHeight });
      } else if (input === "H") {
        // Jump to top of visible area (approximate)
        const visibleTop = Math.max(0, state.selectedMsgIdx - Math.floor(bodyHeight * 0.7));
        dispatch({ type: "SELECT_MSG", index: visibleTop });
      } else if (input === "L") {
        const visibleBottom = Math.min(
          state.messages.length - 1,
          state.selectedMsgIdx + Math.floor(bodyHeight * 0.3),
        );
        dispatch({ type: "SELECT_MSG", index: visibleBottom });
      } else if (input === "M") {
        // Stay at current (middle)
      } else if (input === "}" || input === "]") {
        // Jump to next sender group
        const next = nextGroupBoundary(state.messages, state.selectedMsgIdx);
        dispatch({ type: "SELECT_MSG", index: next });
      } else if (input === "{" || input === "[") {
        // Jump to previous sender group
        const prev = prevGroupBoundary(state.messages, state.selectedMsgIdx);
        dispatch({ type: "SELECT_MSG", index: prev });
      } else if (input === "o") {
        // Open attachment for selected message. Always call so the no-msg/
        // no-attachment toast fires when the user presses `o` without a
        // valid selection — silent no-op is confusing UX.
        openAttachment(
          state.selectedMsgIdx >= 0 ? state.messages[state.selectedMsgIdx] : undefined,
        );
      }
    }
  });

  // ── Date jump ──────────────────────────────────────────────────────

  const MAX_JUMP_BATCHES = 100; // bounded loop: 100 × 100 = 10,000 messages

  const doDateJump = useCallback(
    async (input: string) => {
      const target = parseUserDate(input);
      if (!target) {
        dispatch({
          type: "SET_DATE_JUMP_ERROR",
          error: `Could not parse "${input}". Try YYYY-MM-DD or "1 week ago".`,
        });
        return;
      }
      if (!selected) {
        dispatch({ type: "EXIT_DATE_JUMP" });
        return;
      }
      let batches = 0;
      // Loop: load older messages until oldest <= target, or exhausted
      while (batches < MAX_JUMP_BATCHES) {
        const oldest = state.messages.length > 0 ? state.messages[0].date : new Date();
        if (oldest <= target) break;
        if (state.messageOldestLoadedId == null || state.messageOldestLoadedId === -1) break;
        const older = await imsg.loadOlderMessages(
          selected.chatIdentifier,
          state.messageOldestLoadedId,
        );
        if (older.length === 0) break;
        const newOldestId = minMessageId(older) ?? -1;
        dispatch({ type: "PREPEND_MESSAGES", data: older, oldestId: newOldestId });
        batches++;
        // Yield to render between batches
        await new Promise((r) => setTimeout(r, 10));
      }
      // Find first message at or after target
      const idx = state.messages.findIndex((m) => m.date >= target);
      if (idx >= 0) {
        dispatch({ type: "SELECT_MSG", index: idx });
      }
      dispatch({ type: "EXIT_DATE_JUMP" });
      dispatch({
        type: "SET_STATUS",
        status:
          batches >= MAX_JUMP_BATCHES
            ? `Jumped (capped) — load more manually for older history`
            : `Jumped to ${formatJumpTarget(target)}`,
      });
      setTimeout(() => dispatch({ type: "SET_STATUS", status: "" }), 4000);
    },
    [imsg, selected, state.messages, state.messageOldestLoadedId],
  );

  // ── Export action ──────────────────────────────────────────────────

  const doExport = useCallback(() => {
    const messagesToExport =
      state.selectionAnchor != null
        ? state.messages.slice(
            Math.min(state.selectionAnchor, state.selectedMsgIdx),
            Math.max(state.selectionAnchor, state.selectedMsgIdx) + 1,
          )
        : state.messages;
    if (messagesToExport.length === 0) {
      dispatch({ type: "SET_STATUS", status: "Nothing to export" });
      return;
    }
    const expandedPath = state.exportPath.replace(/^~/, homedir());
    try {
      let content: string;
      const header = {
        thread: selected?.displayName ?? selected?.chatIdentifier ?? "thread",
        participants: selected?.participants ?? [],
        serviceType: selected?.serviceType,
      };
      switch (state.exportFormat) {
        case "markdown":
          content = toMarkdown(messagesToExport, header);
          break;
        case "csv":
          content = toCSV(messagesToExport);
          break;
        case "json":
          content = toJSON(messagesToExport, header);
          break;
      }
      writeFileSync(expandedPath, content, "utf8");
      dispatch({ type: "EXIT_EXPORT_MODE" });
      dispatch({ type: "EXIT_SELECT_MODE" });
      dispatch({
        type: "SET_STATUS",
        status: `Exported ${messagesToExport.length} msgs to ${expandedPath}`,
      });
      setTimeout(() => dispatch({ type: "SET_STATUS", status: "" }), 4000);
    } catch (err) {
      dispatch({
        type: "SET_STATUS",
        status: `Export failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, [
    state.exportFormat,
    state.exportPath,
    state.messages,
    state.selectedMsgIdx,
    state.selectionAnchor,
    selected,
  ]);

  // ── Open attachment ────────────────────────────────────────────────

  function openAttachment(msg: import("../types.js").Message | undefined) {
    // Surface UX feedback when `o` can't do anything — previously this
    // silently no-op'd, leaving the user wondering if the key worked.
    if (!msg) {
      dispatch({ type: "SET_STATUS", status: "No message selected." });
      return;
    }
    if (!msg.attachments?.length) {
      dispatch({ type: "SET_STATUS", status: "No attachment on this message." });
      return;
    }
    const att = msg.attachments[0];
    if (!att.filename) {
      dispatch({ type: "SET_STATUS", status: "Attachment has no file path." });
      return;
    }
    // Expand ~ to home directory
    const filepath = att.filename.replace(/^~/, process.env.HOME ?? "~");
    const mime = att.mimeType ?? "";

    // macOS Quick Look (qlmanage -p) handles images, PDFs, audio, docs, and
    // most archives natively — same UX as Finder spacebar preview. For video,
    // mpv is preferred when installed (better scrubbing); otherwise fall back
    // to Quick Look. All spawns are detached + unref'd so the TUI never blocks.
    import("node:child_process").then(({ spawn }) => {
      const spawnQuickLook = () =>
        spawn("qlmanage", ["-p", filepath], { detached: true, stdio: "ignore" }).unref();

      if (mime.startsWith("video/")) {
        const child = spawn("mpv", [filepath], { detached: true, stdio: "ignore" });
        child.on("error", spawnQuickLook);
        child.unref();
      } else {
        spawnQuickLook();
      }
    });
  }

  // ── Mouse ──────────────────────────────────────────────────────────

  const handleMouse = useCallback(
    (event: { type: string; x: number; y: number }) => {
      if (event.type === "click") {
        if (event.x <= sidebarWidth) {
          dispatch({ type: "FOCUS", pane: "sidebar" });
          const convIdx = Math.floor((event.y - 2 + state.sidebarScroll * 3) / 3);
          if (convIdx >= 0 && convIdx < state.conversations.length) {
            dispatch({ type: "SELECT", index: convIdx, visibleCount: sidebarVisibleCount });
            loadMessages(convIdx);
          }
        } else {
          dispatch({ type: "FOCUS", pane: "thread" });
        }
      } else if (event.type === "scroll-up") {
        // Wheel delta: 1 line per event for fine-grained control. macOS / iTerm
        // typically batch 2-3 wheel events per touchpad swipe so this still feels
        // responsive in practice.
        if (event.x <= sidebarWidth) {
          dispatch({ type: "SCROLL_SIDEBAR", delta: -1 });
        } else {
          dispatch({ type: "MOVE_MSG", delta: -1 });
        }
      } else if (event.type === "scroll-down") {
        if (event.x <= sidebarWidth) {
          dispatch({ type: "SCROLL_SIDEBAR", delta: 1 });
        } else {
          dispatch({ type: "MOVE_MSG", delta: 1 });
        }
      }
    },
    [
      sidebarWidth,
      state.sidebarScroll,
      state.conversations.length,
      loadMessages,
      sidebarVisibleCount,
    ],
  );

  useMouse(handleMouse);

  // ── Cleanup ────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (moveDebounceRef.current) clearTimeout(moveDebounceRef.current);
      if (ggTimerRef.current) clearTimeout(ggTimerRef.current);
    };
  }, []);

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      {/* Main layout */}
      <Box flexGrow={1} height={bodyHeight}>
        <Sidebar
          conversations={state.conversations}
          selectedIdx={state.selectedIdx}
          scrollOffset={state.sidebarScroll}
          filterQuery={state.filterQuery}
          focused={state.focus === "sidebar"}
          width={sidebarWidth}
          height={bodyHeight}
        />
        <ThreadPane
          conversation={selected}
          messages={state.messages}
          pending={state.pending}
          resolvedNames={resolvedNames}
          scrollOffset={state.threadScroll}
          selectedMsgIdx={state.selectedMsgIdx}
          selectionAnchor={state.selectionAnchor}
          gapMarkers={state.gapMarkers}
          focused={state.focus === "thread"}
          width={threadWidth}
          height={bodyHeight}
          mode={state.mode}
          onChangeCompose={(text) => dispatch({ type: "UPDATE_COMPOSE", text })}
          onSubmitCompose={(text) => text.trim() && dispatch({ type: "CONFIRM_SEND" })}
        />
        {state.mode === "drawer" && selectedMsg && (
          <MessageDrawer message={selectedMsg} width={drawerWidth} height={bodyHeight} />
        )}
        {state.showDevStats && <DevStats stats={devStats} width={devStatsWidth} />}
      </Box>

      {/* Date-jump modal */}
      {state.mode === "date-jump" && (
        <DateJumpModal
          value={state.dateJumpInput}
          error={state.dateJumpError}
          onChange={(v) => dispatch({ type: "SET_DATE_JUMP_INPUT", value: v })}
          onSubmit={(v) => doDateJump(v)}
        />
      )}

      {/* Send-via picker — launch external chat apps for the current thread */}
      {state.mode === "send-via" && selected && (
        <SendViaModal handle={selected.chatIdentifier} apps={getInstalledChatApps()} />
      )}

      {/* Compose-to-new-thread modal — `N` (or `c` from sidebar with no
          selected thread). Two-stage: recipient input → message body. */}
      {state.mode === "compose-new" && (
        <ComposeRecipientModal
          resolve={imsg.resolveRecipientInput}
          onSend={async (handle, text) => {
            const result = await imsg.sendToRecipient(handle, text);
            if (result.success) {
              dispatch({
                type: "SET_STATUS",
                status: `Sent to ${handle}`,
              });
              // Trigger a refresh so the new conversation shows up in the sidebar.
              await refreshAll();
            }
            return result;
          }}
          onCancel={() => dispatch({ type: "EXIT_COMPOSE_NEW" })}
        />
      )}

      {/* Export modal — overlays the bottom of the body when active */}
      {state.mode === "export" && (
        <ExportModal
          format={state.exportFormat}
          path={state.exportPath}
          rangeSummary={(() => {
            if (state.selectionAnchor != null) {
              const lo = Math.min(state.selectionAnchor, state.selectedMsgIdx);
              const hi = Math.max(state.selectionAnchor, state.selectedMsgIdx);
              const n = hi - lo + 1;
              return `${n} selected message${n === 1 ? "" : "s"}`;
            }
            const m = state.messages.length;
            return `entire loaded thread (${m} message${m === 1 ? "" : "s"})`;
          })()}
          onChangePath={(p) => dispatch({ type: "SET_EXPORT_PATH", path: p })}
          onSubmit={doExport}
        />
      )}

      {/* Status + Help */}
      <StatusBar
        totalUnread={totalUnread}
        selected={selected}
        status={state.status}
        loading={state.loading}
      >
        {!state.showDevStats && <CompactStats stats={devStats} />}
      </StatusBar>
      <HelpBar mode={state.mode} focus={state.focus} />
    </Box>
  );
}
