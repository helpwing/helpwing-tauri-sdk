//! What survives the app closing: one JSON record per project, the same shape the RN SDK stores.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingMessage {
    pub client_message_id: String,
    pub text: String,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSession {
    /// The only credential this client has; good for one conversation.
    pub token: String,
    pub ticket_id: String,
    /// Who opened the conversation, as `identity_key()` spells it. Empty when anonymous.
    #[serde(default)]
    pub identity_key: String,
    #[serde(default)]
    pub cursor: String,
    /// The server's cursor when the visitor last read the chat; the unread badge counts after it.
    #[serde(default)]
    pub last_read_cursor: String,
    /// Sends not yet acknowledged, oldest first. Never the first message of a conversation.
    #[serde(default, deserialize_with = "valid_pending")]
    pub pending: Vec<PendingMessage>,
}

/// Drops unreadable queue entries instead of refusing the whole record.
fn valid_pending<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<PendingMessage>, D::Error> {
    let raw = Option::<Vec<Value>>::deserialize(deserializer)?.unwrap_or_default();
    Ok(raw.into_iter().filter_map(|item| serde_json::from_value(item).ok()).collect())
}

/// Where the session is kept. Failures are swallowed: the chat still works for this run.
pub trait Storage: Send + Sync {
    fn read(&self) -> Option<StoredSession>;
    fn write(&self, session: &StoredSession);
    fn clear(&self);
}

/// A JSON file per project key in the app data directory.
pub struct FileStorage {
    path: PathBuf,
}

impl FileStorage {
    pub fn new(dir: impl AsRef<Path>, project_key: &str) -> Self {
        let safe: String = project_key
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
            .collect();
        Self { path: dir.as_ref().join(format!("helpwing-{safe}.json")) }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Storage for FileStorage {
    fn read(&self) -> Option<StoredSession> {
        let raw = fs::read_to_string(&self.path).ok()?;
        serde_json::from_str(&raw).ok()
    }

    fn write(&self, session: &StoredSession) {
        let Ok(json) = serde_json::to_string(session) else { return };
        if let Some(dir) = self.path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        // Written aside and renamed, so a crash mid-write leaves the old record intact.
        let temporary = self.path.with_extension("json.tmp");
        if fs::write(&temporary, json).is_ok() {
            let _ = fs::rename(&temporary, &self.path);
        }
    }

    fn clear(&self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// Forgets everything when the process ends. For tests.
#[derive(Default)]
pub struct MemoryStorage {
    value: Mutex<Option<StoredSession>>,
}

impl Storage for MemoryStorage {
    fn read(&self) -> Option<StoredSession> {
        self.value.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn write(&self, session: &StoredSession) {
        *self.value.lock().unwrap_or_else(|e| e.into_inner()) = Some(session.clone());
    }

    fn clear(&self) {
        *self.value.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> StoredSession {
        StoredSession {
            token: "tok".into(),
            ticket_id: "t1".into(),
            identity_key: String::new(),
            cursor: "c1".into(),
            last_read_cursor: "c0".into(),
            pending: vec![PendingMessage {
                client_message_id: "0123456789abcdef".into(),
                text: "hi".into(),
                created_at: "2026-01-01T00:00:00.000Z".into(),
            }],
        }
    }

    #[test]
    fn reads_what_the_react_native_sdk_wrote() {
        let raw = r#"{"token":"tok","ticketId":"t1","cursor":"c1","lastReadCursor":"c0",
            "pending":[{"clientMessageId":"0123456789abcdef","text":"hi"},{"broken":true}]}"#;
        let parsed: StoredSession = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.identity_key, "");
        assert_eq!(parsed.pending.len(), 1);
        assert_eq!(parsed.pending[0].text, "hi");
    }

    #[test]
    fn file_storage_round_trips_and_clears() {
        let dir = std::env::temp_dir().join(format!("helpwing-test-{}", uuid::Uuid::new_v4()));
        let store = FileStorage::new(&dir, "pk_test/../x");
        assert!(store.path().file_name().unwrap().to_str().unwrap().starts_with("helpwing-pk_test"));
        assert!(store.read().is_none());
        store.write(&session());
        assert_eq!(store.read(), Some(session()));
        store.clear();
        assert!(store.read().is_none());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn unreadable_record_reads_as_nothing() {
        let dir = std::env::temp_dir().join(format!("helpwing-test-{}", uuid::Uuid::new_v4()));
        let store = FileStorage::new(&dir, "pk");
        fs::create_dir_all(&dir).unwrap();
        fs::write(store.path(), "{not json").unwrap();
        assert!(store.read().is_none());
        let _ = fs::remove_dir_all(dir);
    }
}
