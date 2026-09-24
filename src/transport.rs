//! Every public widget endpoint, and nothing else.

use std::time::Duration;

use reqwest::Method;
use serde::de::DeserializeOwned;
use serde_json::{json, Map, Value};

use crate::error::HelpwingError;
use crate::models::{ApiConversation, ApiUpdates, Identity, WidgetConfig};

/// `VISITOR_TOKEN_HEADER` on the server.
const VISITOR_HEADER: &str = "X-Helpwing-Visitor";
const TIMEOUT: Duration = Duration::from_secs(30);

pub struct StartPayload<'a> {
    pub body_text: &'a str,
    pub identity: Option<&'a Identity>,
    pub email: &'a str,
    pub locale: &'a str,
    pub timezone: &'a str,
}

pub struct Transport {
    base: String,
    http: reqwest::Client,
}

impl Transport {
    pub fn new(api_url: &str, project_key: &str) -> Self {
        let root = api_url.trim_end_matches('/');
        let http = reqwest::Client::builder()
            .timeout(TIMEOUT)
            .user_agent(concat!("helpwing-tauri/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_default();
        Self { base: format!("{root}/widget/{}", encode_segment(project_key)), http }
    }

    pub async fn config(&self) -> Result<WidgetConfig, HelpwingError> {
        self.request(Method::GET, "/config/", None, None, &[]).await
    }

    /// Opens a conversation. No idempotency key exists for this, so it is never retried automatically.
    pub async fn start(&self, payload: StartPayload<'_>) -> Result<ApiConversation, HelpwingError> {
        let mut body = Map::new();
        body.insert("body_text".into(), json!(payload.body_text));
        if let Some(identity) = payload.identity {
            body.insert("identity".into(), serde_json::to_value(identity).unwrap_or(Value::Null));
        }
        for (key, value) in [("email", payload.email), ("locale", payload.locale), ("timezone", payload.timezone)] {
            if !value.is_empty() {
                body.insert(key.into(), json!(value));
            }
        }
        self.request(Method::POST, "/conversations/", None, Some(Value::Object(body)), &[]).await
    }

    pub async fn conversation(&self, ticket_id: &str, token: &str) -> Result<ApiConversation, HelpwingError> {
        let path = format!("/conversations/{}/", encode_segment(ticket_id));
        self.request(Method::GET, &path, Some(token), None, &[]).await
    }

    /// Idempotent by `client_message_id`: a retry stores nothing twice.
    pub async fn send(
        &self,
        ticket_id: &str,
        token: &str,
        body_text: &str,
        client_message_id: &str,
    ) -> Result<ApiConversation, HelpwingError> {
        let path = format!("/conversations/{}/messages/", encode_segment(ticket_id));
        let body = json!({ "body_text": body_text, "client_message_id": client_message_id });
        self.request(Method::POST, &path, Some(token), Some(body), &[]).await
    }

    pub async fn identify(&self, ticket_id: &str, token: &str, identity: &Identity) -> Result<Value, HelpwingError> {
        let path = format!("/conversations/{}/identify/", encode_segment(ticket_id));
        let body = serde_json::to_value(identity).unwrap_or(Value::Null);
        self.request(Method::POST, &path, Some(token), Some(body), &[]).await
    }

    /// `present` tells the server the visitor is reading, so a reply is not also emailed.
    pub async fn updates(
        &self,
        ticket_id: &str,
        token: &str,
        since: &str,
        present: bool,
    ) -> Result<ApiUpdates, HelpwingError> {
        let path = format!("/conversations/{}/updates/", encode_segment(ticket_id));
        let mut query = vec![("since", since)];
        if present {
            query.push(("present", "1"));
        }
        self.request(Method::GET, &path, Some(token), None, &query).await
    }

    async fn request<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        token: Option<&str>,
        body: Option<Value>,
        query: &[(&str, &str)],
    ) -> Result<T, HelpwingError> {
        let mut request = self.http.request(method, format!("{}{}", self.base, path));
        if !query.is_empty() {
            request = request.query(query);
        }
        if let Some(token) = token {
            request = request.header(VISITOR_HEADER, token);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }

        let response = request.send().await.map_err(|e| HelpwingError::network(e.to_string()))?;
        let status = response.status().as_u16();
        let bytes = response.bytes().await.map_err(|e| HelpwingError::network(e.to_string()))?;
        let data: Value = if status == 204 || bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap_or(Value::Null)
        };

        if !(200..300).contains(&status) {
            let message = message_in(&data).unwrap_or_else(|| format!("HTTP {status}"));
            return Err(HelpwingError::http(message, status));
        }
        serde_json::from_value(data).map_err(|e| HelpwingError::http(format!("Unexpected response: {e}"), status))
    }
}

/// The API's error envelope, `{ "error": { "message": ... } }`.
fn message_in(data: &Value) -> Option<String> {
    let message = data.get("error")?.get("message")?.as_str()?;
    (!message.is_empty()).then(|| message.to_string())
}

/// Percent-encodes one path segment, as `encodeURIComponent` does.
fn encode_segment(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_widget_base_from_the_api_url() {
        let transport = Transport::new("https://api.helpwing.app///", "pk_live_1");
        assert_eq!(transport.base, "https://api.helpwing.app/widget/pk_live_1");
    }

    #[test]
    fn encodes_path_segments() {
        assert_eq!(encode_segment("pk live/1"), "pk%20live%2F1");
        assert_eq!(encode_segment("ключ"), "%D0%BA%D0%BB%D1%8E%D1%87");
    }

    #[test]
    fn reads_the_error_envelope() {
        assert_eq!(message_in(&json!({"error": {"message": "Nope"}})), Some("Nope".into()));
        assert_eq!(message_in(&json!({"error": {"message": ""}})), None);
        assert_eq!(message_in(&json!({"detail": "x"})), None);
        assert_eq!(message_in(&Value::Null), None);
    }
}
