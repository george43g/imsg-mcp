//! SQLite query layer — reads chat.db and returns structured data.
//!
//! All functions are synchronous and meant to be called from `spawn_blocking`.
//! Uses rusqlite directly with WAL mode for concurrent reads.

use napi::Error;
use rayon::prelude::*;
use rusqlite::{params, Connection, OpenFlags};
use std::collections::HashMap;

use crate::attributed_body;
use crate::contacts::ContactsDb;
use crate::types::*;

/// Mac epoch offset: seconds between Unix epoch (1970) and Mac epoch (2001-01-01).
const MAC_EPOCH_OFFSET: f64 = 978_307_200.0;
/// Timestamps in DB are nanoseconds.
const NANOS_PER_SECOND: f64 = 1_000_000_000.0;

/// Convert macOS nanosecond timestamp to JS millisecond timestamp.
fn mac_ts_to_js(ts: i64) -> f64 {
    if ts == 0 {
        return 0.0;
    }
    let unix_seconds = (ts as f64) / NANOS_PER_SECOND + MAC_EPOCH_OFFSET;
    unix_seconds * 1000.0
}

fn open_readonly(path: &str) -> napi::Result<Connection> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| Error::from_reason(format!("Failed to open {path}: {e}")))?;
    // WAL mode for concurrent reads
    conn.pragma_update(None, "journal_mode", "wal")
        .ok(); // Ignore if already set or read-only
    Ok(conn)
}

// ── listConversations ────────────────────────────────────────────────

struct ChatRow {
    rowid: i64,
    guid: String,
    chat_identifier: String,
    display_name: Option<String>,
}

struct LastMessage {
    chat_id: i64,
    last_date: i64,
    snippet: Option<String>,
    last_service: Option<String>,
}

pub fn list_conversations_sync(
    db_path: &str,
    contacts_main_path: &str,
    contacts_sources_dir: Option<&str>,
    _slugs_db_path: &str,
    limit: usize,
) -> napi::Result<Vec<NativeConversation>> {
    let conn = open_readonly(db_path)?;
    let contacts = ContactsDb::open(contacts_main_path, contacts_sources_dir);

    // 1. Get all chats
    let chats = get_all_chats(&conn)?;

    // 2. Get last message per chat
    let last_by_chat = get_last_message_by_chat(&conn)?;

    // 3. Get unread counts
    let unread_by_chat = get_unread_by_chat(&conn)?;

    // 4. Build conversations with enrichment
    let mut entries: Vec<(NativeConversation, i64)> = chats
        .iter()
        .map(|chat| {
            let last = last_by_chat.get(&chat.rowid);
            let last_date = last.map(|l| l.last_date).unwrap_or(0);
            let is_group = is_group_identifier(&chat.chat_identifier) || is_group_guid(&chat.guid);

            let display_name = match &chat.display_name {
                Some(name) if !name.trim().is_empty() => Some(name.clone()),
                _ => if !is_group {
                    contacts.lookup_handle(&chat.chat_identifier)
                } else {
                    None
                },
            };

            let participants = if is_group {
                fetch_chat_participants(&conn, chat.rowid).unwrap_or_default()
            } else {
                vec![chat.chat_identifier.clone()]
            };

            let service_type = last
                .and_then(|l| l.last_service.as_deref())
                .map(|s| if s == "SMS" { "SMS" } else { "iMessage" })
                .unwrap_or("iMessage")
                .to_string();

            let snippet = last.and_then(|l| l.snippet.clone());
            let js_date = if last_date > 0 { Some(mac_ts_to_js(last_date)) } else { None };

            let conv = NativeConversation {
                chat_id: chat.guid.clone(),
                chat_identifier: chat.chat_identifier.clone(),
                display_name,
                raw_identifier: chat.chat_identifier.clone(),
                participants,
                last_message_date: js_date,
                last_message_snippet: snippet,
                unread_count: *unread_by_chat.get(&chat.rowid).unwrap_or(&0),
                thread_slug: chat.chat_identifier.clone(), // TODO: integrate slug store
                is_group_chat: is_group,
                service_type,
            };
            (conv, last_date)
        })
        .collect();

    // Sort by last_date descending
    entries.sort_by(|a, b| b.1.cmp(&a.1));

    // Take top N
    let result: Vec<NativeConversation> = entries.into_iter().take(limit).map(|(c, _)| c).collect();
    Ok(result)
}

// ── getMessagesForChat ───────────────────────────────────────────────

pub fn get_messages_sync(
    db_path: &str,
    chat_identifier: &str,
    limit: usize,
    include_reactions: bool,
) -> napi::Result<Vec<NativeMessage>> {
    let conn = open_readonly(db_path)?;

    // Find chat(s) matching the identifier
    let chat_rowids = resolve_chat_rowids(&conn, chat_identifier)?;
    if chat_rowids.is_empty() {
        return Ok(vec![]);
    }

    let per_chat_limit = std::cmp::max(limit * 2, 50);
    let mut all_rows: Vec<RawMessageRow> = Vec::new();

    for chat_id in &chat_rowids {
        let rows = fetch_messages_for_chat(&conn, *chat_id, per_chat_limit)?;
        all_rows.extend(rows);
    }

    // Parse attributedBody blobs in parallel using rayon
    let messages: Vec<NativeMessage> = all_rows
        .into_par_iter()
        .filter_map(|row| {
            let text = if let Some(ref t) = row.text {
                if is_placeholder_text(t) {
                    // Try attributedBody
                    row.attributed_body.as_ref().and_then(|b| attributed_body::extract_text(b))
                } else {
                    Some(t.clone())
                }
            } else {
                row.attributed_body.as_ref().and_then(|b| attributed_body::extract_text(b))
            };

            // Skip reaction messages unless requested
            if !include_reactions && row.associated_message_type >= 1000 {
                return None;
            }

            let is_reaction = row.associated_message_type >= 1000;
            let is_reply = row.thread_originator_guid.is_some();

            let date_js = mac_ts_to_js(row.date);
            let date_read_js = if row.date_read > 0 { Some(mac_ts_to_js(row.date_read)) } else { None };
            let date_delivered_js = if row.date_delivered > 0 { Some(mac_ts_to_js(row.date_delivered)) } else { None };

            Some(NativeMessage {
                id: row.rowid,
                guid: row.guid,
                text,
                handle: row.handle_id.unwrap_or_default(),
                display_name: None, // Resolved by JS layer or contacts
                is_from_me: row.is_from_me != 0,
                date: date_js,
                date_read: date_read_js,
                date_delivered: date_delivered_js,
                is_read: row.is_read != 0,
                is_delivered: row.is_delivered != 0,
                chat_id: chat_identifier.to_string(),
                service: row.service.unwrap_or_else(|| "iMessage".to_string()),

                is_reaction,
                is_reply,
                reply_to_text: None, // Would need additional query
                reply_to_guid: row.thread_originator_guid,

                reactions: None, // Populated separately if needed
                rich_content_type: None,
                rich_content_summary: None,

                is_edited: row.is_edited != 0,
                is_retracted: false,

                has_attachments: row.cache_has_attachments != 0,
                attachments: None, // Populated separately if needed
            })
        })
        .collect();

    // Sort chronologically ascending, take last N
    let mut sorted = messages;
    sorted.sort_by(|a, b| a.date.partial_cmp(&b.date).unwrap_or(std::cmp::Ordering::Equal));
    let start = if sorted.len() > limit { sorted.len() - limit } else { 0 };
    Ok(sorted[start..].to_vec())
}

// ── Raw SQL helpers ──────────────────────────────────────────────────

fn get_all_chats(conn: &Connection) -> napi::Result<Vec<ChatRow>> {
    let mut stmt = conn
        .prepare("SELECT ROWID, guid, chat_identifier, display_name FROM chat ORDER BY ROWID DESC")
        .map_err(|e| Error::from_reason(format!("SQL error: {e}")))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ChatRow {
                rowid: row.get(0)?,
                guid: row.get(1)?,
                chat_identifier: row.get(2)?,
                display_name: row.get(3)?,
            })
        })
        .map_err(|e| Error::from_reason(format!("Query error: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

fn get_last_message_by_chat(conn: &Connection) -> napi::Result<HashMap<i64, LastMessage>> {
    let mut stmt = conn
        .prepare(
            "SELECT chat_id, last_date, last_service, snippet FROM (
                SELECT cmj.chat_id, m.date as last_date,
                    m.service as last_service,
                    COALESCE(TRIM(SUBSTR(m.text, 1, 200)), '') as snippet,
                    ROW_NUMBER() OVER (PARTITION BY cmj.chat_id ORDER BY m.date DESC) as rn
                FROM message m
                JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
                WHERE m.associated_message_type = 0
                    AND COALESCE(m.item_type, 0) = 0
            ) WHERE rn = 1",
        )
        .map_err(|e| Error::from_reason(format!("SQL error: {e}")))?;

    let mut map = HashMap::new();
    let rows = stmt
        .query_map([], |row| {
            Ok(LastMessage {
                chat_id: row.get(0)?,
                last_date: row.get(1)?,
                last_service: row.get(2)?,
                snippet: row.get::<_, Option<String>>(3)?.filter(|s| !s.is_empty()),
            })
        })
        .map_err(|e| Error::from_reason(format!("Query error: {e}")))?;

    for row in rows.flatten() {
        map.insert(row.chat_id, row);
    }
    Ok(map)
}

fn get_unread_by_chat(conn: &Connection) -> napi::Result<HashMap<i64, u32>> {
    let mut stmt = conn
        .prepare(
            "SELECT cmj.chat_id, COUNT(*) as unread
            FROM message m
            JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
            WHERE m.associated_message_type = 0
                AND COALESCE(m.item_type, 0) = 0
                AND m.is_from_me = 0 AND m.is_read = 0
            GROUP BY cmj.chat_id",
        )
        .map_err(|e| Error::from_reason(format!("SQL error: {e}")))?;

    let mut map = HashMap::new();
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, u32>(1)?)))
        .map_err(|e| Error::from_reason(format!("Query error: {e}")))?;

    for row in rows.flatten() {
        map.insert(row.0, row.1);
    }
    Ok(map)
}

fn fetch_chat_participants(conn: &Connection, chat_rowid: i64) -> napi::Result<Vec<String>> {
    let mut stmt = conn
        .prepare(
            "SELECT h.id FROM handle h
            JOIN chat_handle_join chj ON h.ROWID = chj.handle_id
            WHERE chj.chat_id = ?",
        )
        .map_err(|e| Error::from_reason(format!("SQL error: {e}")))?;

    let rows = stmt
        .query_map(params![chat_rowid], |row| row.get::<_, String>(0))
        .map_err(|e| Error::from_reason(format!("Query error: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

fn resolve_chat_rowids(conn: &Connection, chat_identifier: &str) -> napi::Result<Vec<i64>> {
    let normalized = chat_identifier.replace([' ', '-', '(', ')'], "").to_lowercase();

    let mut stmt = conn
        .prepare("SELECT ROWID, chat_identifier FROM chat")
        .map_err(|e| Error::from_reason(format!("SQL error: {e}")))?;

    let rows: Vec<i64> = stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| Error::from_reason(format!("Query error: {e}")))?
        .filter_map(|r| r.ok())
        .filter(|(_, id)| {
            let id_norm = id.replace([' ', '-', '(', ')'], "").to_lowercase();
            id_norm.contains(&normalized) || normalized.contains(&id_norm)
        })
        .map(|(rowid, _)| rowid)
        .collect();

    Ok(rows)
}

struct RawMessageRow {
    rowid: i64,
    guid: String,
    text: Option<String>,
    attributed_body: Option<Vec<u8>>,
    date: i64,
    date_read: i64,
    date_delivered: i64,
    is_from_me: i32,
    is_read: i32,
    is_delivered: i32,
    handle_id: Option<String>,
    cache_has_attachments: i32,
    associated_message_type: i32,
    thread_originator_guid: Option<String>,
    service: Option<String>,
    is_edited: i32,
}

fn fetch_messages_for_chat(conn: &Connection, chat_rowid: i64, limit: usize) -> napi::Result<Vec<RawMessageRow>> {
    // Try with is_edited first (iOS 16+), fallback without
    let sql_with_edited = "SELECT
                m.ROWID, m.guid, m.text, m.attributedBody, m.date,
                m.date_read, m.date_delivered,
                m.is_from_me, m.is_read, m.is_delivered,
                h.id as handle_id, m.cache_has_attachments,
                m.associated_message_type, m.thread_originator_guid,
                m.service, m.is_edited
            FROM message m
            LEFT JOIN handle h ON m.handle_id = h.ROWID
            LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
            WHERE cmj.chat_id = ?
            ORDER BY m.date DESC
            LIMIT ?";
    let sql_without_edited = "SELECT
                m.ROWID, m.guid, m.text, m.attributedBody, m.date,
                m.date_read, m.date_delivered,
                m.is_from_me, m.is_read, m.is_delivered,
                h.id as handle_id, m.cache_has_attachments,
                m.associated_message_type, m.thread_originator_guid,
                m.service, 0 as is_edited
            FROM message m
            LEFT JOIN handle h ON m.handle_id = h.ROWID
            LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
            WHERE cmj.chat_id = ?
            ORDER BY m.date DESC
            LIMIT ?";

    let mut stmt = conn
        .prepare(sql_with_edited)
        .or_else(|_| conn.prepare(sql_without_edited))
        .map_err(|e| Error::from_reason(format!("SQL error: {e}")))?;

    let rows = stmt
        .query_map(params![chat_rowid, limit as i64], |row| {
            Ok(RawMessageRow {
                rowid: row.get(0)?,
                guid: row.get(1)?,
                text: row.get(2)?,
                attributed_body: row.get(3)?,
                date: row.get(4)?,
                date_read: row.get::<_, i64>(5).unwrap_or(0),
                date_delivered: row.get::<_, i64>(6).unwrap_or(0),
                is_from_me: row.get(7)?,
                is_read: row.get::<_, i32>(8).unwrap_or(0),
                is_delivered: row.get::<_, i32>(9).unwrap_or(0),
                handle_id: row.get(10)?,
                cache_has_attachments: row.get(11)?,
                associated_message_type: row.get::<_, i32>(12).unwrap_or(0),
                thread_originator_guid: row.get(13)?,
                service: row.get(14)?,
                is_edited: row.get::<_, i32>(15).unwrap_or(0),
            })
        })
        .map_err(|e| Error::from_reason(format!("Query error: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

fn is_group_identifier(id: &str) -> bool {
    id.starts_with("chat") || id.contains(';')
}

fn is_group_guid(guid: &str) -> bool {
    guid.contains(";+;")
}

fn is_placeholder_text(text: &str) -> bool {
    text == "\u{FFFC}" || text.trim().is_empty()
}
