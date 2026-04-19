import React, { useCallback, useEffect, useReducer, useRef } from "react";
import { Box, useApp, useInput } from "ink";
import { useScreenSize } from "fullscreen-ink";
import { APP_VERSION } from "../meta.js";
import { useImsg } from "./hooks/useImsg.js";
import { useMouse } from "./hooks/useMouse.js";
import { initialState, reducer } from "./types.js";
import { HelpBar } from "./components/HelpBar.js";
import { Sidebar } from "./components/Sidebar.js";
import { StatusBar } from "./components/StatusBar.js";
import { ThreadPane } from "./components/ThreadPane.js";

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { exit } = useApp();
  const { width: columns, height: rows } = useScreenSize();
  const imsg = useImsg();
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sidebarWidth = Math.max(Math.floor(columns * 0.32), 28);
  const threadWidth = Math.max(columns - sidebarWidth, 20);
  const bodyHeight = rows - 3; // status + help + title

  const selected = state.conversations[state.selectedIdx];
  const totalUnread = state.conversations.reduce((s, c) => s + c.unreadCount, 0);
  const resolvedNames = selected ? imsg.resolveNames(selected.participants) : [];

  // ── Data loading ───────────────────────────────────────────────────

  const loadMessages = useCallback(async (idx: number) => {
    const conv = state.conversations[idx];
    if (!conv) return;
    dispatch({ type: "SET_LOADING", loading: true, status: `Loading ${conv.displayName ?? conv.chatIdentifier}...` });
    const msgs = await imsg.loadMessages(conv.chatIdentifier);
    dispatch({ type: "SET_MESSAGES", data: msgs });
    dispatch({ type: "SET_LOADING", loading: false, status: "" });
  }, [state.conversations, imsg]);

  const refreshAll = useCallback(async () => {
    dispatch({ type: "SET_LOADING", loading: true, status: "Refreshing..." });
    const convs = await imsg.loadConversations();
    dispatch({ type: "SET_CONVERSATIONS", data: convs });
    if (convs.length > 0) {
      const prevSlug = selected?.threadSlug;
      if (prevSlug) {
        const idx = convs.findIndex((c) => c.threadSlug === prevSlug);
        if (idx >= 0) dispatch({ type: "SELECT", index: idx });
      }
      await loadMessages(state.selectedIdx);
    }
    imsg.refresh();
    dispatch({ type: "SET_LOADING", loading: false, status: "" });
  }, [imsg, loadMessages, selected?.threadSlug, state.selectedIdx]);

  // Initial load
  useEffect(() => {
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

    // Poll for the message to appear in DB
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
      // TextInput handles the rest
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

    // Browse mode
    if (input === "q") { await imsg.close(); exit(); return; }
    if (input === "r") { await refreshAll(); return; }
    if (input === "c" || (key.return && state.focus === "thread")) {
      dispatch({ type: "ENTER_COMPOSE" });
      return;
    }
    if (input === "/") { dispatch({ type: "ENTER_FILTER" }); return; }
    if (key.tab) {
      dispatch({ type: "FOCUS", pane: state.focus === "sidebar" ? "thread" : "sidebar" });
      return;
    }

    if (state.loading) return;

    if (state.focus === "sidebar") {
      if (input === "j" || key.downArrow) {
        const next = Math.min(state.selectedIdx + 1, state.conversations.length - 1);
        if (next !== state.selectedIdx) {
          dispatch({ type: "SELECT", index: next });
          await loadMessages(next);
        }
      } else if (input === "k" || key.upArrow) {
        const next = Math.max(state.selectedIdx - 1, 0);
        if (next !== state.selectedIdx) {
          dispatch({ type: "SELECT", index: next });
          await loadMessages(next);
        }
      } else if (input === "G") {
        const last = state.conversations.length - 1;
        dispatch({ type: "SELECT", index: last });
        await loadMessages(last);
      } else if (key.pageDown) {
        const next = Math.min(state.selectedIdx + 10, state.conversations.length - 1);
        dispatch({ type: "SELECT", index: next });
        await loadMessages(next);
      } else if (key.pageUp) {
        const next = Math.max(state.selectedIdx - 10, 0);
        dispatch({ type: "SELECT", index: next });
        await loadMessages(next);
      }
    } else {
      // Thread focus -- scroll messages
      if (input === "j" || key.downArrow) {
        dispatch({ type: "SCROLL_THREAD", delta: 1 });
      } else if (input === "k" || key.upArrow) {
        dispatch({ type: "SCROLL_THREAD", delta: -1 });
      } else if (key.pageDown) {
        dispatch({ type: "SCROLL_THREAD", delta: 10 });
      } else if (key.pageUp) {
        dispatch({ type: "SCROLL_THREAD", delta: -10 });
      } else if (input === "G") {
        dispatch({ type: "SCROLL_THREAD_TO", position: state.messages.length });
      }
    }
  });

  // ── Mouse ──────────────────────────────────────────────────────────

  const handleMouse = useCallback((event: { type: string; x: number; y: number }) => {
    if (event.type === "click") {
      if (event.x <= sidebarWidth) {
        dispatch({ type: "FOCUS", pane: "sidebar" });
        // Map y coordinate to conversation index (each item ~4 rows, +2 for header/border)
        const convIdx = Math.floor((event.y - 2 + state.sidebarScroll * 4) / 4);
        if (convIdx >= 0 && convIdx < state.conversations.length) {
          dispatch({ type: "SELECT", index: convIdx });
          loadMessages(convIdx);
        }
      } else {
        dispatch({ type: "FOCUS", pane: "thread" });
      }
    } else if (event.type === "scroll-up") {
      if (event.x <= sidebarWidth) {
        dispatch({ type: "SCROLL_SIDEBAR", delta: -3 });
      } else {
        dispatch({ type: "SCROLL_THREAD", delta: -3 });
      }
    } else if (event.type === "scroll-down") {
      if (event.x <= sidebarWidth) {
        dispatch({ type: "SCROLL_SIDEBAR", delta: 3 });
      } else {
        dispatch({ type: "SCROLL_THREAD", delta: 3 });
      }
    }
  }, [sidebarWidth, state.sidebarScroll, state.conversations.length, loadMessages]);

  useMouse(handleMouse);

  // ── Cleanup ────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
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
          focused={state.focus === "thread"}
          width={threadWidth}
          height={bodyHeight}
          mode={state.mode}
          onChangeCompose={(text) => dispatch({ type: "UPDATE_COMPOSE", text })}
          onSubmitCompose={(text) => text.trim() && dispatch({ type: "CONFIRM_SEND" })}
        />
      </Box>

      {/* Status + Help */}
      <StatusBar totalUnread={totalUnread} selected={selected} status={state.status} loading={state.loading} />
      <HelpBar mode={state.mode} />
    </Box>
  );
}
