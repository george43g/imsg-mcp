import { execSync } from "node:child_process";
import React, { useCallback, useEffect, useReducer, useRef } from "react";
import { Box, useApp, useInput } from "ink";
import { registerCleanup } from "../shutdown.js";
import { useScreenSize } from "fullscreen-ink";
import { useImsg } from "./hooks/useImsg.js";
import { useMouse } from "./hooks/useMouse.js";
import { initialState, reducer } from "./types.js";
import { CompactStats, DevStats } from "./components/DevStats.js";
import { HelpBar } from "./components/HelpBar.js";
import { MessageDrawer } from "./components/MessageDrawer.js";
import { Sidebar } from "./components/Sidebar.js";
import { StatusBar } from "./components/StatusBar.js";
import { ThreadPane, nextGroupBoundary, prevGroupBoundary } from "./components/ThreadPane.js";
import { useDevStats } from "./hooks/useDevStats.js";

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { exit } = useApp();
  const { width: columns, height: rows } = useScreenSize();
  const imsg = useImsg();
  const { stats: devStats, recordQueryTime } = useDevStats();
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

  const loadMessages = useCallback(async (idx: number) => {
    const conv = state.conversations[idx];
    if (!conv) return;
    dispatch({ type: "SET_LOADING", loading: true, status: `Loading ${conv.displayName ?? conv.chatIdentifier}...` });
    const t0 = performance.now();
    const msgs = await imsg.loadMessages(conv.chatIdentifier);
    recordQueryTime(performance.now() - t0);
    dispatch({ type: "SET_MESSAGES", data: msgs });
    dispatch({ type: "SET_LOADING", loading: false, status: "" });
  }, [state.conversations, imsg, recordQueryTime]);

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
  }, [imsg, loadMessages, selected?.threadSlug, state.selectedIdx]);

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
  const MSG_BATCH_SIZE = 100;

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
    const newOldestId = Math.min(...olderMsgs.map((m) => m.id));
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
    const cursorNearEnd =
      state.selectedIdx >= state.conversations.length - NEAR_END_THRESHOLD;
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
  useEffect(() => {
    registerCleanup(() => imsg.close());
    refreshAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (key.escape || key.return) {
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

    // Browse mode
    if (input === "d" && state.mode === "browse") { dispatch({ type: "TOGGLE_DEV_STATS" }); return; }
    if (input === "q") { await imsg.close(); exit(); return; }
    if (input === "r") { await refreshAll(); return; }
    if (input === "c" || (key.return && state.focus === "thread" && state.mode === "browse")) {
      if (state.focus === "thread" && key.return && state.selectedMsgIdx >= 0) {
        // Enter on a message opens drawer
        dispatch({ type: "OPEN_DRAWER" });
        return;
      }
      dispatch({ type: "ENTER_COMPOSE" });
      return;
    }
    if (input === "/" && state.mode === "browse") { dispatch({ type: "ENTER_FILTER" }); return; }
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
          ggTimerRef.current = setTimeout(() => { ggPendingRef.current = false; }, 500);
          return;
        }
      } else if (key.ctrl && input === "d") {
        // Half page down
        next = Math.min(state.selectedIdx + Math.floor(bodyHeight / 2), state.conversations.length - 1);
      } else if (key.ctrl && input === "u") {
        // Half page up
        next = Math.max(state.selectedIdx - Math.floor(bodyHeight / 2), 0);
      } else if (key.ctrl && input === "f" || key.pageDown) {
        next = Math.min(state.selectedIdx + bodyHeight, state.conversations.length - 1);
      } else if (key.ctrl && input === "b" || key.pageUp) {
        next = Math.max(state.selectedIdx - bodyHeight, 0);
      } else if (input === "H") {
        // High - first visible
        next = state.sidebarScroll;
      } else if (input === "M") {
        // Middle
        next = Math.min(state.sidebarScroll + Math.floor(bodyHeight / 2), state.conversations.length - 1);
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
          ggTimerRef.current = setTimeout(() => { ggPendingRef.current = false; }, 500);
        }
      } else if (key.ctrl && input === "d") {
        dispatch({ type: "MOVE_MSG", delta: Math.floor(bodyHeight / 2) });
      } else if (key.ctrl && input === "u") {
        dispatch({ type: "MOVE_MSG", delta: -Math.floor(bodyHeight / 2) });
      } else if (key.ctrl && input === "f" || key.pageDown) {
        dispatch({ type: "MOVE_MSG", delta: bodyHeight });
      } else if (key.ctrl && input === "b" || key.pageUp) {
        dispatch({ type: "MOVE_MSG", delta: -bodyHeight });
      } else if (input === "H") {
        // Jump to top of visible area (approximate)
        const visibleTop = Math.max(0, state.selectedMsgIdx - Math.floor(bodyHeight * 0.7));
        dispatch({ type: "SELECT_MSG", index: visibleTop });
      } else if (input === "L") {
        const visibleBottom = Math.min(state.messages.length - 1, state.selectedMsgIdx + Math.floor(bodyHeight * 0.3));
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
      } else if (input === "o" && state.selectedMsgIdx >= 0) {
        // Open attachment for selected message
        openAttachment(state.messages[state.selectedMsgIdx]);
      }
    }
  });

  // ── Open attachment ────────────────────────────────────────────────

  function openAttachment(msg: import("../types.js").Message | undefined) {
    if (!msg?.attachments?.length) return;
    const att = msg.attachments[0];
    if (!att.filename) return;
    // Expand ~ to home directory
    const filepath = att.filename.replace(/^~/, process.env.HOME ?? "~");
    const mime = att.mimeType ?? "";

    if (mime.startsWith("video/")) {
      // Open video in mpv
      import("node:child_process").then(({ spawn }) => {
        spawn("mpv", [filepath], { detached: true, stdio: "ignore" }).unref();
      });
    } else if (mime.startsWith("image/") || mime.startsWith("audio/")) {
      // Open with system default
      import("node:child_process").then(({ spawn }) => {
        spawn("open", [filepath], { detached: true, stdio: "ignore" }).unref();
      });
    }
  }

  // ── Mouse ──────────────────────────────────────────────────────────

  const handleMouse = useCallback((event: { type: string; x: number; y: number }) => {
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
  }, [sidebarWidth, state.sidebarScroll, state.conversations.length, loadMessages]);

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
          focused={state.focus === "thread"}
          width={threadWidth}
          height={bodyHeight}
          mode={state.mode}
          onChangeCompose={(text) => dispatch({ type: "UPDATE_COMPOSE", text })}
          onSubmitCompose={(text) => text.trim() && dispatch({ type: "CONFIRM_SEND" })}
        />
        {state.mode === "drawer" && selectedMsg && (
          <MessageDrawer
            message={selectedMsg}
            width={drawerWidth}
            height={bodyHeight}
          />
        )}
        {state.showDevStats && (
          <DevStats stats={devStats} width={devStatsWidth} />
        )}
      </Box>

      {/* Status + Help */}
      <StatusBar totalUnread={totalUnread} selected={selected} status={state.status} loading={state.loading}>
        {!state.showDevStats && <CompactStats stats={devStats} />}
      </StatusBar>
      <HelpBar mode={state.mode} focus={state.focus} />
    </Box>
  );
}
