//! Contact resolution — reads the macOS AddressBook SQLite database
//! to resolve phone numbers and emails to display names.

use rusqlite::{Connection, OpenFlags};
use std::collections::HashMap;

pub struct ContactsDb {
    handles: HashMap<String, String>, // phone/email → display name
}

impl ContactsDb {
    /// Open the AddressBook database and build a handle→name lookup map.
    /// Returns an empty DB if the file can't be opened (graceful degradation).
    pub fn open(main_path: &str, _sources_dir: Option<&str>) -> Self {
        match Self::try_open(main_path) {
            Ok(db) => db,
            Err(_) => ContactsDb {
                handles: HashMap::new(),
            },
        }
    }

    fn try_open(path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;

        let mut handles = HashMap::new();

        // Query: join ABPerson (name) with ABMultiValue (phone/email)
        let mut stmt = conn.prepare(
            "SELECT
                COALESCE(ZABCDFIRSTNAME, '') || ' ' || COALESCE(ZABCDLASTNAME, '') as full_name,
                mv.ZVALUE as handle
            FROM ZABCDRECORD r
            JOIN ZABCDPHONENUMBER mv ON mv.ZOWNER = r.Z_PK
            WHERE mv.ZVALUE IS NOT NULL AND mv.ZVALUE != ''
            UNION ALL
            SELECT
                COALESCE(ZABCDFIRSTNAME, '') || ' ' || COALESCE(ZABCDLASTNAME, '') as full_name,
                mv.ZVALUE as handle
            FROM ZABCDRECORD r
            JOIN ZABCDEMAILADDRESS mv ON mv.ZOWNER = r.Z_PK
            WHERE mv.ZVALUE IS NOT NULL AND mv.ZVALUE != ''"
        )?;

        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
            ))
        })?;

        for row in rows.flatten() {
            let (name, handle) = row;
            let name = name.trim().to_string();
            if !name.is_empty() && name != " " {
                // Normalize phone number for lookup
                let normalized = normalize_handle(&handle);
                handles.insert(normalized, name.clone());
                handles.insert(handle, name);
            }
        }

        Ok(ContactsDb { handles })
    }

    /// Look up a display name for a handle (phone number or email).
    /// Returns None if no match found.
    pub fn lookup_handle(&self, handle: &str) -> Option<String> {
        // Try exact match first
        if let Some(name) = self.handles.get(handle) {
            return Some(name.clone());
        }
        // Try normalized
        let normalized = normalize_handle(handle);
        self.handles.get(&normalized).cloned()
    }

    /// Batch resolve multiple handles.
    pub fn resolve_batch(&self, handles: &[String]) -> HashMap<String, String> {
        let mut result = HashMap::new();
        for handle in handles {
            if let Some(name) = self.lookup_handle(handle) {
                result.insert(handle.clone(), name);
            }
        }
        result
    }
}

/// Normalize a phone handle by stripping non-digit characters.
fn normalize_handle(handle: &str) -> String {
    if handle.contains('@') {
        return handle.to_lowercase();
    }
    handle.chars().filter(|c| c.is_ascii_digit() || *c == '+').collect()
}

/// Public function exposed via N-API.
pub fn resolve_handles(
    contacts_main_path: &str,
    contacts_sources_dir: Option<&str>,
    handles: &[String],
) -> napi::Result<HashMap<String, String>> {
    let db = ContactsDb::open(contacts_main_path, contacts_sources_dir);
    Ok(db.resolve_batch(handles))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_handle_phone() {
        assert_eq!(normalize_handle("+1 555 555 0108"), "+15555550108");
        assert_eq!(normalize_handle("+1 (415) 555-1234"), "+14155551234");
    }

    #[test]
    fn test_normalize_handle_email() {
        assert_eq!(normalize_handle("USER@EXAMPLE.com"), "user@example.com");
    }

    #[test]
    fn test_open_missing_path_returns_empty() {
        // Must not panic on missing/invalid file — degrades gracefully.
        let db = ContactsDb::open("/nonexistent/path/AddressBook.abcddb", None);
        assert!(db.lookup_handle("anything").is_none());
    }

    #[test]
    fn test_resolve_batch_empty_db() {
        let db = ContactsDb::open("/nonexistent/path/AddressBook.abcddb", None);
        let handles = vec!["+1234567890".to_string(), "user@example.com".to_string()];
        let result = db.resolve_batch(&handles);
        assert!(result.is_empty());
    }
}
