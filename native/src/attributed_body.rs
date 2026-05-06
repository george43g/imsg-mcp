//! Attributed body text extraction from Apple typedstream blobs.
//!
//! This is a simplified initial implementation that extracts readable text
//! from attributedBody BLOBs using heuristic string extraction.
//! A full typedstream binary parser will be added in a later phase.

use std::str;

/// Metadata patterns to filter out (compiled regex would be faster but
/// these are simple enough for string matching).
const METADATA_PREFIXES: &[&str] = &[
    "streamtyped",
    "NS",
    "__kIM",
    "MessagePartAttributeName",
    "DataDetectedAttributeName",
    "CalendarEventAttributeName",
    "X$version",
    "bplist",
    "$class",
    "RMSV$class",
    "NSData",
    "NSDictionary",
    "NSNumber",
    "NSValue",
    "FileTransferGUIDAttributeName",
    "BaseWritingDirectionAttributeName",
];

fn is_metadata(text: &str) -> bool {
    for prefix in METADATA_PREFIXES {
        if text.starts_with(prefix) {
            return true;
        }
    }
    // Pattern: at_N_UUID
    if text.starts_with("at_") && text.len() > 5 {
        return true;
    }
    false
}

fn is_control_char(c: char) -> bool {
    c.is_control() || c == '\x7f'
}

/// Score a candidate text string — higher = more likely to be the actual message.
fn score_candidate(text: &str) -> i32 {
    let mut score: i32 = 0;
    if text.chars().any(|c| c.is_alphabetic()) {
        score += 50;
    }
    if text.chars().any(|c| c.is_numeric()) {
        score += 10;
    }
    if text.contains(' ') {
        score += 30;
    }
    if text.contains('.') || text.contains('!') || text.contains('?') {
        score += 15;
    }
    // Emoji range (rough)
    if text.chars().any(|c| ('\u{1F300}'..='\u{1FAFF}').contains(&c)) {
        score += 100;
    }
    // Short alphanumeric-only strings are likely metadata
    if text.len() <= 3 && text.chars().all(|c| c.is_alphanumeric()) {
        score -= 100;
    }
    score += std::cmp::min(text.len() as i32, 200);
    score
}

/// Normalize a candidate string: strip leading punctuation, control chars, etc.
fn normalize_candidate(text: &str) -> Option<String> {
    let trimmed = text
        .trim_start_matches(|c: char| c == '+' || c == ';' || c == ':' || c == '"' || c == '\'' || c == '(' || c == ')' || c == '&' || c.is_whitespace());

    let cleaned: String = trimmed
        .chars()
        .map(|c| if is_control_char(c) { ' ' } else { c })
        .collect::<String>()
        .replace('\u{FFFD}', "")
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ");

    if cleaned.is_empty() || cleaned == "�" || cleaned == "￼" {
        return None;
    }
    if cleaned.len() < 2 {
        // Allow single emoji
        if !cleaned.chars().any(|c| ('\u{1F300}'..='\u{1FAFF}').contains(&c)) {
            return None;
        }
    }
    if is_metadata(&cleaned) {
        return None;
    }
    Some(cleaned)
}

/// Extract readable text from an attributedBody BLOB.
/// Uses a heuristic approach: split the blob on control characters,
/// filter out metadata strings, and return the best candidate.
pub fn extract_text(blob: &[u8]) -> Option<String> {
    // Try to interpret as UTF-8 and extract readable segments
    let text = String::from_utf8_lossy(blob);

    let mut candidates: Vec<(String, i32)> = Vec::new();

    // Split on control characters and null bytes
    for segment in text.split(|c: char| is_control_char(c) || c == '\0') {
        let segment = segment.trim();
        if segment.is_empty() {
            continue;
        }
        if let Some(normalized) = normalize_candidate(segment) {
            let score = score_candidate(&normalized);
            candidates.push((normalized, score));
        }
    }

    // Return the highest-scoring candidate
    candidates.sort_by(|a, b| b.1.cmp(&a.1));
    candidates.into_iter().next().map(|(text, _)| text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_score_candidate() {
        assert!(score_candidate("Hello world!") > score_candidate("NS"));
        assert!(score_candidate("Hey what's up?") > score_candidate("streamtyped"));
    }

    #[test]
    fn test_normalize_filters_metadata() {
        assert!(normalize_candidate("streamtyped").is_none());
        assert!(normalize_candidate("NSMutableString").is_none());
        assert!(normalize_candidate("Hello world").is_some());
    }
}
