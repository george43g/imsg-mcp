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

    // Strip doubled-uppercase-letter prefix: "HHeres" -> "Heres".
    // This pattern is almost always a typedstream length-byte leak — Apple
    // stores the length byte as a single ASCII char immediately before the
    // content, and when the length-byte char happens to match the content's
    // first letter (e.g. message of length 72 = 'H', starting with "Heres"),
    // our heuristic byte-scan picks them up as one continuous run.
    let stripped = strip_doubled_letter_prefix(&cleaned);
    Some(stripped)
}

/// If `text` starts with `[A-Z]\1[a-z]`, drop the first char.
/// Example: "HHeres the question" -> "Heres the question".
fn strip_doubled_letter_prefix(text: &str) -> String {
    let bytes = text.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_uppercase()
        && bytes[0] == bytes[1]
        && bytes[2].is_ascii_lowercase()
    {
        return text[1..].to_string();
    }
    text.to_string()
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
    use std::time::Instant;

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

    /// Hang resistance: extract_text must complete on adversarial inputs.
    /// Mirrors the TS regression — the Rust path is structurally simpler
    /// (no byte-by-byte reader) so it cannot hit the same infinite loop,
    /// but we still pin the contract here.
    #[test]
    fn test_extract_text_does_not_hang_on_zeros() {
        let zeros = vec![0u8; 8192];
        let start = Instant::now();
        let _ = extract_text(&zeros);
        assert!(start.elapsed().as_millis() < 500, "must complete fast on all-zero input");
    }

    #[test]
    fn test_extract_text_does_not_hang_on_high_bits() {
        let mut blob = vec![0u8; 8192];
        for (i, b) in blob.iter_mut().enumerate() {
            *b = if i % 2 == 0 { 0xc0 } else { 0x00 };
        }
        let start = Instant::now();
        let _ = extract_text(&blob);
        assert!(start.elapsed().as_millis() < 500);
    }

    /// Real attributedBody header should yield the embedded ASCII text.
    #[test]
    fn test_extract_text_finds_message_in_synthetic_blob() {
        // Synthetic structure: typedstream header bytes, then NSString class
        // refs, then the actual message text surrounded by control bytes.
        let mut blob: Vec<u8> = b"\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@".to_vec();
        blob.extend_from_slice(b"NSString\x01\x94\x84\x01+");
        blob.push(28); // length byte
        blob.extend_from_slice(b"Hello world from typedstream");
        blob.extend_from_slice(b"\x00\x00\x86\x84\x02iI"); // some trailing structure
        let result = extract_text(&blob);
        assert!(result.is_some(), "should find a candidate");
        let text = result.unwrap();
        assert!(
            text.contains("Hello world from typedstream"),
            "expected message text, got: {text:?}"
        );
        assert!(!text.contains("$class"), "no class metadata leak");
        assert!(!text.contains("NSString"), "no NSString class leak");
    }

    /// Empty input should return None gracefully, not panic.
    #[test]
    fn test_extract_text_empty_input() {
        assert!(extract_text(&[]).is_none());
    }

    /// Doubled-letter prefix from typedstream length-byte must be stripped.
    /// "HHeres the question..." was a real bug from a 72-char msg starting with H.
    #[test]
    fn test_strip_doubled_letter_prefix() {
        assert_eq!(strip_doubled_letter_prefix("HHeres the question"), "Heres the question");
        assert_eq!(strip_doubled_letter_prefix("WWhat happened"), "What happened");
        assert_eq!(strip_doubled_letter_prefix("OOkay"), "Okay");
        // Should NOT strip when not a doubled-uppercase-then-lowercase pattern
        assert_eq!(strip_doubled_letter_prefix("Hello"), "Hello");
        assert_eq!(strip_doubled_letter_prefix("HH"), "HH"); // too short, no lowercase after
        assert_eq!(strip_doubled_letter_prefix("HHH"), "HHH"); // third is uppercase
        assert_eq!(strip_doubled_letter_prefix("hi"), "hi");
        assert_eq!(strip_doubled_letter_prefix(""), "");
    }

    /// Synthetic blob with embedded "HHeres" pattern should produce the
    /// de-doubled "Heres" via normalize_candidate's prefix strip.
    #[test]
    fn test_extract_text_strips_doubled_letter_prefix() {
        // Build a blob whose embedded printable run looks like a length-byte
        // leak: control byte + "HHeres the question tho" (the doubled H simulates
        // length byte 0x48 followed by "Heres...").
        let mut blob = b"\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@".to_vec();
        blob.extend_from_slice(b"\x00HHeres the question tho if i go thrre\x00");
        let result = extract_text(&blob);
        assert!(result.is_some());
        let text = result.unwrap();
        assert!(
            text.starts_with("Heres"),
            "expected 'Heres...', got: {text:?}"
        );
        assert!(!text.starts_with("HHeres"));
    }
}
