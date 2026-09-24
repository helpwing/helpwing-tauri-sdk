use std::sync::Arc;

use tauri::{command, State};

use crate::client::Chat;
use crate::error::{Error, Result};
use crate::models::{ChatState, Identity};

#[command]
pub(crate) async fn start(chat: State<'_, Arc<Chat>>, locale: Option<String>, timezone: Option<String>) -> Result<()> {
    chat.set_locale(locale, timezone);
    chat.start().await;
    Ok(())
}

#[command]
pub(crate) fn state(chat: State<'_, Arc<Chat>>) -> ChatState {
    chat.state()
}

#[command]
pub(crate) async fn send(chat: State<'_, Arc<Chat>>, text: String, email: Option<String>) -> Result<()> {
    chat.send(&text, email).await;
    Ok(())
}

#[command]
pub(crate) async fn retry(chat: State<'_, Arc<Chat>>, client_message_id: String) -> Result<()> {
    chat.retry(&client_message_id).await;
    Ok(())
}

#[command]
pub(crate) async fn identify(chat: State<'_, Arc<Chat>>, identity: Option<Identity>) -> Result<()> {
    chat.identify(identity).await;
    Ok(())
}

#[command]
pub(crate) fn set_present(chat: State<'_, Arc<Chat>>, present: bool) {
    chat.set_present(present);
}

#[command]
pub(crate) fn set_active(chat: State<'_, Arc<Chat>>, active: bool) {
    chat.set_active(active);
}

#[command]
pub(crate) fn mark_read(chat: State<'_, Arc<Chat>>) {
    chat.mark_read();
}

#[command]
pub(crate) async fn refresh(chat: State<'_, Arc<Chat>>) -> Result<()> {
    chat.refresh().await;
    Ok(())
}

#[command]
pub(crate) fn reset(chat: State<'_, Arc<Chat>>) {
    chat.reset();
}

/// Opens a link from an agent's reply in the system browser. Only http(s), mailto and tel.
#[command]
pub(crate) fn open_link(url: String) -> Result<()> {
    if !is_safe_link(&url) {
        return Err(Error::Message("Only http, https, mailto and tel links can be opened.".into()));
    }
    open_external(&url)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn open_external(url: &str) -> Result<()> {
    open::that_detached(url).map_err(Error::from)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn open_external(_url: &str) -> Result<()> {
    Err(Error::Message("Opening links is not supported here; pass a link opener to the JS client.".into()))
}

fn is_safe_link(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    let schemed = ["http://", "https://", "mailto:", "tel:"].iter().any(|scheme| lower.starts_with(scheme));
    schemed && !url.trim().is_empty() && !url.trim().chars().any(char::is_whitespace)
}

#[cfg(test)]
mod tests {
    use super::is_safe_link;

    #[test]
    fn only_the_schemes_a_reply_may_point_at() {
        assert!(is_safe_link("https://helpwing.app/docs"));
        assert!(is_safe_link("mailto:support@helpwing.app"));
        assert!(is_safe_link("tel:+100"));
        assert!(!is_safe_link("javascript:alert(1)"));
        assert!(!is_safe_link("file:///etc/passwd"));
        assert!(!is_safe_link("https://a b"));
    }
}
