//! Shared types that map to the TypeScript interfaces in src/types.ts.
//! These are exposed to JS via napi-rs auto-generated TypeScript definitions.

use napi_derive::napi;

/// Mirrors the TypeScript `Conversation` interface.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NativeConversation {
    pub chat_id: String,
    pub chat_identifier: String,
    pub display_name: Option<String>,
    pub raw_identifier: String,
    pub participants: Vec<String>,
    pub last_message_date: Option<f64>, // JS timestamp (ms since epoch)
    pub last_message_snippet: Option<String>,
    pub unread_count: u32,
    pub thread_slug: String,
    pub is_group_chat: bool,
    pub service_type: String, // "iMessage" or "SMS"
}

/// Mirrors the TypeScript `Message` interface.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NativeMessage {
    pub id: i64,
    pub guid: String,
    pub text: Option<String>,
    pub handle: String,
    pub display_name: Option<String>,
    pub is_from_me: bool,
    pub date: f64, // JS timestamp (ms since epoch)
    pub date_read: Option<f64>,
    pub date_delivered: Option<f64>,
    pub is_read: bool,
    pub is_delivered: bool,
    pub chat_id: String,
    pub service: String, // "iMessage" or "SMS"

    // Reaction info
    pub is_reaction: bool,
    pub is_reply: bool,
    pub reply_to_text: Option<String>,
    pub reply_to_guid: Option<String>,

    // Reactions on this message
    pub reactions: Option<Vec<NativeReaction>>,

    // Rich content
    pub rich_content_type: Option<String>,
    pub rich_content_summary: Option<String>,

    // Edit/retract
    pub is_edited: bool,
    pub is_retracted: bool,

    // Attachments
    pub has_attachments: bool,
    pub attachments: Option<Vec<NativeAttachment>>,
}

/// Mirrors the TypeScript `Reaction` interface.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NativeReaction {
    pub reaction_type: String, // "love", "like", etc.
    pub emoji: Option<String>,
    pub from_handle: String,
    pub is_removal: bool,
    pub target_message_guid: String,
    pub target_message_part: i32,
}

/// Mirrors the TypeScript `Attachment` interface.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NativeAttachment {
    pub filename: String,
    pub mime_type: Option<String>,
    pub transfer_name: Option<String>,
    pub total_bytes: f64,
}
