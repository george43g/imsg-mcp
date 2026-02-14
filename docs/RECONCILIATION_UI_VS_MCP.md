# Reconciliation: Messages.app UI vs imessage MCP Data

This document maps the macOS Messages.app UI (screenshot reference) to the data returned by the imessage MCP tool and the underlying `chat.db` schema.

## Left Pane (Conversation List)

| UI Element | MCP / DB Source | Notes |
|------------|-----------------|--------|
| **Contact/group row** | `chat` table: `chat_identifier`, `display_name` | UI shows `display_name` when set (e.g. "Alice Example", "George Example"); otherwise formatted phone (e.g. "+1 555 555 0101"). MCP `list_conversations` returns `chatIdentifier`, `displayName`. |
| **Last message snippet** | Last message in that chat (`message.text` or parsed `attributedBody`) | Messages.app shows a short preview. MCP `list_conversations` currently does **not** return last message text or date; `lastMessageDate` is null in the implementation. To reconcile fully, add a query for last message per chat. |
| **Timestamp (e.g. "8:00 AM", "Yesterday")** | `message.date` (Mac epoch) for the last message in the chat | Same as above; we’d derive this when adding last-message info to `list_conversations`. |
| **Ordering** | By last message time descending | UI sorts by most recent activity. MCP `list_conversations` returns chats in whatever order `imessage-parser`’s `getChats()` returns; ordering may differ from UI if not explicitly sorted by last message date. |
| **Unread indicator** | `message.is_read = 0` for incoming, aggregated per chat | UI can show a dot/badge. MCP returns `unreadCount` (currently 0); implementation could aggregate unread from `message` + `chat_message_join`. |

**Reconciliation gap:** `list_conversations` does not yet populate `lastMessageDate` or last-message snippet. The left pane is fully reproducible only after adding per-chat “last message” query and sorting by that date.

---

## Right Pane (Thread: e.g. "Alice Example")

| UI Element | MCP / DB Source | Notes |
|------------|------------------|--------|
| **Header "To: Alice Example"** | `chat.display_name` or `chat.chat_identifier` | MCP identifies the chat by `chatIdentifier` (phone/email). To open “Alice Example” via MCP you need a handle that matches that chat (e.g. phone number); display name alone isn’t stored as the primary key. |
| **Sent messages (blue, right)** | `message.is_from_me = 1` | MCP `Message.isFromMe === true`. |
| **Received messages (grey, left)** | `message.is_from_me = 0` | MCP `Message.isFromMe === false`. |
| **Message body** | `message.text` or decoded `attributedBody` | MCP returns `Message.text` (we use `imessage-parser` for attributedBody). Inline attachments show as U+FFFC in DB; we replace with 📎 or "(image/attachment)" in the MCP layer. |
| **Timestamps in thread ("Yesterday 5:57 PM", "Today 3:46 AM")** | `message.date` (Mac epoch → JS Date) | MCP `Message.date` is a Date; formatting “Today” / “Yesterday” is client-side. |
| **"Delivered" / "Read 3:51 AM"** | `message.is_delivered`, `message.date_delivered`, `message.is_read`, `message.date_read` | For outgoing messages, DB stores read/delivery status. MCP `Message.isRead`, `Message.dateRead`; delivery fields could be added if needed. |
| **Reactions on a bubble (e.g. heart-eyes on "Omg happy birthday!!!!")** | Separate rows: `message.associated_message_type` 2000–3006, `associated_message_guid` → target message | In the DB, tapbacks are separate message rows. MCP filters them out of `get_messages` by default; we have `Message.reaction` when the row is a reaction, and `Message.reactions` (reactions on this message) if requested. UI shows reactions on the bubble; MCP can expose them via `reactions` and/or optional `includeReactions`. |

**Reconciliation:** Thread content, order, direction (sent/received), and read status align with the MCP and schema. Matching by display name requires resolving “Alice Example” to a `chat_identifier` (e.g. via contact or by searching chats by display name).

---

## Specific Observations from Screenshot

- **"George Example" (8:00 AM, "Continue as per plan")**  
  Likely a self-chat or linked device. Same as any other chat in DB; `chat_identifier` could be the user’s Apple ID or phone.

- **"Alice Example" (3:51 AM, selected)**  
  Active thread; content and order in the right pane should match `get_messages(chatIdentifier)` for that chat’s identifier.

- **+15555550100 not in visible list**  
  Verification number from earlier instructions. Not in the top of the list; could be (1) further down, (2) on another device/account, or (3) no conversation yet until the first message is sent. MCP can still `send_message` and `wait_for_reply` for that number if the chat exists or gets created on send.

- **Phone formatting**  
  UI shows "+1 555 555 0101" (with spaces); DB/MCP typically use a canonical form (e.g. +15555550101). Our `findChatByHandle` normalizes (strips spaces, dashes, parentheses) so both should match.

---

## Summary

| Area | Aligned | Gap / Action |
|------|---------|----------------|
| Left pane: display name, chat list | Yes (chat_id, display_name) | Add last message date + snippet and sort by last message for full parity. |
| Right pane: messages, order, sent/received, read status | Yes | Match by chat_identifier; display name → identifier may need contact/lookup. |
| Reactions | Yes (DB + optional MCP) | Default behavior hides reaction rows; use options to include when needed. |
| Timestamps | Yes (Mac epoch → Date) | “Today”/“Yesterday” is display logic, not in MCP. |
| +15555550100 | N/A | Not visible in screenshot; MCP can still target it by number. |

This reconciliation is based on the current imessage MCP implementation and `docs/IMESSAGE_DB_SCHEMA.md`. Implement “last message per chat” and optional “sort by last message” in `list_conversations` to fully mirror the left pane.
