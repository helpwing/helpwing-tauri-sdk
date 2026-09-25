//! Wire shapes of the public widget API, and the state handed to the webview.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

/// A string field the server may send as `null` or leave out.
fn lenient<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

/// `GET /widget/{key}/config/`. Only what Rust decides on is typed; the rest passes through.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WidgetConfig {
    #[serde(default)]
    pub is_enabled: bool,
    #[serde(default)]
    pub is_online: bool,
    /// Absent on servers older than the setting, which reads as "keep showing the chat".
    #[serde(default)]
    pub hide_when_closed: bool,
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ApiAttachment {
    #[serde(default, deserialize_with = "lenient")]
    pub id: String,
    #[serde(default, deserialize_with = "lenient")]
    pub filename: String,
    #[serde(default, deserialize_with = "lenient")]
    pub content_type: String,
    #[serde(default)]
    pub size_bytes: u64,
    #[serde(default, deserialize_with = "lenient")]
    pub url: String,
    #[serde(default)]
    pub is_inline: bool,
    #[serde(default, deserialize_with = "lenient")]
    pub content_id: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ApiMessage {
    pub id: String,
    /// `agent`, `customer` or `system`.
    #[serde(default, deserialize_with = "lenient")]
    pub author: String,
    #[serde(default, deserialize_with = "lenient")]
    pub author_name: String,
    #[serde(default, deserialize_with = "lenient")]
    pub author_avatar_url: String,
    #[serde(default, deserialize_with = "lenient")]
    pub body_text: String,
    #[serde(default, deserialize_with = "lenient")]
    pub body_html: String,
    #[serde(default)]
    pub attachments: Vec<ApiAttachment>,
    #[serde(default, deserialize_with = "lenient")]
    pub created_at: String,
    #[serde(default, deserialize_with = "lenient")]
    pub client_message_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Typing {
    #[serde(default, deserialize_with = "lenient")]
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ApiConversation {
    pub ticket_id: String,
    #[serde(default, deserialize_with = "lenient")]
    pub ticket_reference: String,
    #[serde(default, deserialize_with = "lenient")]
    pub status: String,
    #[serde(default, deserialize_with = "lenient")]
    pub subject: String,
    #[serde(default, deserialize_with = "lenient")]
    pub visitor_token: String,
    #[serde(default)]
    pub messages: Vec<ApiMessage>,
    #[serde(default)]
    pub typing: Option<Typing>,
    #[serde(default, deserialize_with = "lenient")]
    pub cursor: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ApiUpdates {
    #[serde(default, deserialize_with = "lenient")]
    pub cursor: String,
    #[serde(default)]
    pub has_changes: bool,
    #[serde(default, deserialize_with = "lenient")]
    pub status: String,
    #[serde(default)]
    pub messages: Vec<ApiMessage>,
    #[serde(default)]
    pub typing: Option<Typing>,
}

/// Who the visitor is, spelled as the API spells it (`userHash` included).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Identity {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Map<String, Value>>,
    /// Hex HMAC-SHA256 of `id` keyed with the identity secret, computed on your server.
    #[serde(default, rename = "userHash", skip_serializing_if = "Option::is_none")]
    pub user_hash: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Delivery {
    Pending,
    Sent,
    Failed,
}

/// A message as the app shows it, including ones not yet acknowledged by the server.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    /// The server's id once there is one, the client id until then.
    pub id: String,
    pub author: String,
    pub author_name: String,
    pub author_avatar_url: String,
    pub text: String,
    /// Whether `text` is markdown.
    pub markdown: bool,
    pub attachments: Vec<ApiAttachment>,
    pub created_at: String,
    pub delivery: Delivery,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_message_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Idle,
    Loading,
    Ready,
    /// No support surface right now: the widget is off, or hidden outside operating hours.
    Unconfigured,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub ticket_id: String,
    pub ticket_reference: String,
    pub status: String,
    pub subject: String,
}

/// Everything true about the chat, emitted as `helpwing://state` on every change.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatState {
    pub status: Status,
    pub config: Option<WidgetConfig>,
    pub conversation: Option<ConversationSummary>,
    pub messages: Vec<ChatMessage>,
    pub typing: Option<Typing>,
    pub unread_count: usize,
    pub offline: bool,
    pub error: Option<String>,
}

impl Default for ChatState {
    fn default() -> Self {
        Self {
            status: Status::Idle,
            config: None,
            conversation: None,
            messages: Vec::new(),
            typing: None,
            unread_count: 0,
            offline: false,
            error: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_keeps_fields_it_does_not_type() {
        let config: WidgetConfig = serde_json::from_value(serde_json::json!({
            "is_enabled": true,
            "is_online": false,
            "accent_color": "#2563eb",
            "typing_text": "{name} is writing…",
            "translations": {"ru": {"greeting": "Привет", "typing_text": "{name} печатает…"}}
        }))
        .unwrap();
        assert!(!config.hide_when_closed);
        let back = serde_json::to_value(&config).unwrap();
        assert_eq!(back["accent_color"], "#2563eb");
        assert_eq!(back["typing_text"], "{name} is writing…");
        assert_eq!(back["translations"]["ru"]["greeting"], "Привет");
        assert_eq!(back["translations"]["ru"]["typing_text"], "{name} печатает…");
        assert_eq!(back["is_enabled"], true);
    }

    #[test]
    fn state_serializes_in_camel_case() {
        let state = ChatState { unread_count: 2, ..ChatState::default() };
        let value = serde_json::to_value(&state).unwrap();
        assert_eq!(value["status"], "idle");
        assert_eq!(value["unreadCount"], 2);
        assert!(value["typing"].is_null());
    }

    #[test]
    fn identity_spells_user_hash_the_way_the_api_does() {
        let identity = Identity { id: Some("42".into()), user_hash: Some("ab".into()), ..Identity::default() };
        let value = serde_json::to_value(&identity).unwrap();
        assert_eq!(value, serde_json::json!({"id": "42", "userHash": "ab"}));
    }

    #[test]
    fn message_tolerates_nulls() {
        let message: ApiMessage = serde_json::from_value(serde_json::json!({
            "id": "m1", "author": "agent", "body_text": null, "client_message_id": null
        }))
        .unwrap();
        assert_eq!(message.body_text, "");
        assert_eq!(message.client_message_id, "");
    }
}
