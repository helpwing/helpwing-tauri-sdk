//! Helpwing support chat for Tauri. The conversation runs here, in Rust; the webview draws it.
//!
//! HTTP happens outside the webview, so the widget's allowed-origins check never sees `tauri://`.

use std::sync::Arc;
use std::time::Duration;

use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::{Emitter, Manager, Runtime};

mod client;
mod commands;
mod error;
mod models;
mod store;
mod transport;

pub use client::{Chat, ChatOptions, Emit, DEFAULT_BACKGROUND_POLL, DEFAULT_POLL};
pub use error::{Error, HelpwingError, Result};
pub use models::{
    ApiAttachment, ChatMessage, ChatState, ConversationSummary, Delivery, Identity, Status, Typing, WidgetConfig,
};
pub use store::{FileStorage, MemoryStorage, PendingMessage, Storage, StoredSession};

/// The event every state change is emitted as.
pub const STATE_EVENT: &str = "helpwing://state";

/// Configures the plugin: `tauri_plugin_helpwing::Builder::new(api_url, project_key).build()`.
pub struct Builder {
    options: ChatOptions,
}

impl Builder {
    /// `api_url` is the host serving `/widget.js`; `project_key` is the public `pk_…` key.
    pub fn new(api_url: impl Into<String>, project_key: impl Into<String>) -> Self {
        Self { options: ChatOptions::new(api_url, project_key) }
    }

    pub fn poll_interval(mut self, interval: Duration) -> Self {
        self.options.poll_interval = interval;
        self
    }

    /// Zero stops polling while the chat is closed.
    pub fn background_poll_interval(mut self, interval: Duration) -> Self {
        self.options.background_poll_interval = interval;
        self
    }

    /// Sent when a conversation opens. The JS client sends the webview's own when left out.
    pub fn locale(mut self, locale: impl Into<String>) -> Self {
        self.options.locale = locale.into();
        self
    }

    pub fn timezone(mut self, timezone: impl Into<String>) -> Self {
        self.options.timezone = timezone.into();
        self
    }

    pub fn build<R: Runtime>(self) -> TauriPlugin<R> {
        let options = self.options;
        PluginBuilder::new("helpwing")
            .invoke_handler(tauri::generate_handler![
                commands::start,
                commands::state,
                commands::send,
                commands::retry,
                commands::identify,
                commands::set_present,
                commands::set_active,
                commands::mark_read,
                commands::refresh,
                commands::reset,
                commands::open_link,
            ])
            .setup(move |app, _api| {
                let dir = app.path().app_data_dir()?.join("helpwing");
                let storage = FileStorage::new(dir, &options.project_key);
                let handle = app.clone();
                let emit: Emit = Arc::new(move |state: &ChatState| {
                    let _ = handle.emit(STATE_EVENT, state);
                });
                app.manage(Chat::new(options, Box::new(storage), emit));
                Ok(())
            })
            .build()
    }
}

/// `app.helpwing()` from Rust, for apps that drive the chat from the backend too.
pub trait HelpwingExt<R: Runtime> {
    fn helpwing(&self) -> Arc<Chat>;
}

impl<R: Runtime, T: Manager<R>> HelpwingExt<R> for T {
    fn helpwing(&self) -> Arc<Chat> {
        self.state::<Arc<Chat>>().inner().clone()
    }
}
