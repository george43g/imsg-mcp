//! imsg-native: Rust acceleration layer for imsg-mcp
//!
//! Exposes async N-API functions that run SQLite queries and binary blob parsing
//! off the Node.js main thread using rayon for parallelism.

mod attributed_body;
mod contacts;
mod db;
mod types;

use napi::bindgen_prelude::*;
use napi_derive::napi;

/// List conversations with metadata, sorted by last message date.
/// Runs entirely on a background thread — returns a JS Promise.
#[napi]
pub async fn list_conversations(
    db_path: String,
    contacts_main_path: String,
    contacts_sources_dir: Option<String>,
    slugs_db_path: String,
    limit: Option<u32>,
) -> Result<Vec<types::NativeConversation>> {
    let limit = limit.unwrap_or(200) as usize;
    tokio::task::spawn_blocking(move || {
        db::list_conversations_sync(&db_path, &contacts_main_path, contacts_sources_dir.as_deref(), &slugs_db_path, limit)
    })
    .await
    .map_err(|e| Error::from_reason(format!("Task join error: {e}")))?
}

/// Get messages for a specific chat, sorted chronologically (oldest first).
/// Returns the last `limit` messages.
#[napi]
pub async fn get_messages(
    db_path: String,
    chat_identifier: String,
    limit: Option<u32>,
    include_reaction_details: Option<bool>,
) -> Result<Vec<types::NativeMessage>> {
    let limit = limit.unwrap_or(50) as usize;
    let include_reactions = include_reaction_details.unwrap_or(false);
    tokio::task::spawn_blocking(move || {
        db::get_messages_sync(&db_path, &chat_identifier, limit, include_reactions)
    })
    .await
    .map_err(|e| Error::from_reason(format!("Task join error: {e}")))?
}

/// Parse an attributedBody blob to extract readable text.
/// Useful for messages where the `text` column is NULL.
#[napi]
pub fn parse_attributed_body(blob: Buffer) -> Option<String> {
    attributed_body::extract_text(&blob)
}

/// Resolve contact names for a list of handles (phone numbers / emails).
/// Returns a map of handle → display name.
#[napi]
pub async fn resolve_contacts(
    contacts_main_path: String,
    contacts_sources_dir: Option<String>,
    handles: Vec<String>,
) -> Result<std::collections::HashMap<String, String>> {
    tokio::task::spawn_blocking(move || {
        contacts::resolve_handles(&contacts_main_path, contacts_sources_dir.as_deref(), &handles)
    })
    .await
    .map_err(|e| Error::from_reason(format!("Task join error: {e}")))?
}
