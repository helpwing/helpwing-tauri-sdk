//! The conversation state machine. A port of `react-native-sdk/src/core/client.ts`.
//!
//! Lock rule: `inner` is a std mutex and is only ever taken inside `with`/`patch`, never across an await.

use std::collections::HashSet;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, Weak};
use std::time::Duration;

use chrono::{SecondsFormat, Utc};
use regex::Regex;

use crate::error::HelpwingError;
use crate::models::{
    ApiConversation, ApiMessage, ChatMessage, ChatState, ConversationSummary, Delivery, Identity, Status, Typing,
};
use crate::store::{PendingMessage, Storage, StoredSession};
use crate::transport::{StartPayload, Transport};

pub const DEFAULT_POLL: Duration = Duration::from_secs(5);
pub const DEFAULT_BACKGROUND_POLL: Duration = Duration::from_secs(30);

/// Called with the new state after every change.
pub type Emit = Arc<dyn Fn(&ChatState) + Send + Sync>;

#[derive(Debug, Clone)]
pub struct ChatOptions {
    pub api_url: String,
    pub project_key: String,
    /// While the visitor is reading. Default 5s.
    pub poll_interval: Duration,
    /// While the chat is closed but the app is open. Default 30s; zero stops it.
    pub background_poll_interval: Duration,
    pub locale: String,
    pub timezone: String,
}

impl ChatOptions {
    pub fn new(api_url: impl Into<String>, project_key: impl Into<String>) -> Self {
        Self {
            api_url: api_url.into(),
            project_key: project_key.into(),
            poll_interval: DEFAULT_POLL,
            background_poll_interval: DEFAULT_BACKGROUND_POLL,
            locale: String::new(),
            timezone: String::new(),
        }
    }
}

struct Inner {
    state: ChatState,
    session: Option<StoredSession>,
    identity: Option<Identity>,
    present: bool,
    active: bool,
    flushing: bool,
    destroyed: bool,
    /// Bumped to cancel the armed timer; a timer only fires if its generation is current.
    timer_generation: u64,
    locale: String,
    timezone: String,
}

pub struct Chat {
    me: Weak<Chat>,
    transport: Transport,
    store: Box<dyn Storage>,
    poll: Duration,
    background_poll: Duration,
    emit: Emit,
    inner: Mutex<Inner>,
    /// Held for one poll round, so two never overlap and `refresh` can wait for the one in flight.
    round: tokio::sync::Mutex<()>,
}

/// Clears `flushing` however `flush` ends, including a dropped future.
struct FlushGuard<'a>(&'a Chat);

impl Drop for FlushGuard<'_> {
    fn drop(&mut self) {
        self.0.with(|inner| inner.flushing = false);
    }
}

impl Chat {
    pub fn new(options: ChatOptions, store: Box<dyn Storage>, emit: Emit) -> Arc<Self> {
        Arc::new_cyclic(|me| Chat {
            me: me.clone(),
            transport: Transport::new(&options.api_url, &options.project_key),
            store,
            poll: options.poll_interval,
            background_poll: options.background_poll_interval,
            emit,
            inner: Mutex::new(Inner {
                state: ChatState::default(),
                session: None,
                identity: None,
                present: false,
                active: true,
                flushing: false,
                destroyed: false,
                timer_generation: 0,
                locale: options.locale,
                timezone: options.timezone,
            }),
            round: tokio::sync::Mutex::new(()),
        })
    }

    // -- public API ------------------------------------------------------------------

    pub fn state(&self) -> ChatState {
        self.with(|inner| inner.state.clone())
    }

    /// Overrides the locale and timezone sent when a conversation opens. Empty values are ignored.
    pub fn set_locale(&self, locale: Option<String>, timezone: Option<String>) {
        self.with(|inner| {
            if let Some(locale) = locale.filter(|value| !value.is_empty()) {
                inner.locale = locale;
            }
            if let Some(timezone) = timezone.filter(|value| !value.is_empty()) {
                inner.timezone = timezone;
            }
        });
    }

    /// Loads the config and any stored conversation. Safe to call again; never fails.
    pub async fn start(&self) {
        self.patch(|state| {
            if state.config.is_none() {
                state.status = Status::Loading;
            }
            state.error = None;
        });
        match self.transport.config().await {
            Ok(config) => {
                let hidden = !config.is_enabled || (!config.is_online && config.hide_when_closed);
                self.patch(|state| {
                    state.config = Some(config);
                    state.offline = false;
                    if hidden {
                        state.status = Status::Unconfigured;
                    }
                });
                if hidden {
                    return;
                }
            }
            Err(error) => {
                self.fail(&error, false);
                return;
            }
        }

        let stored = self.store.read();
        let has_session = stored.is_some();
        self.with(|inner| inner.session = stored);
        if has_session {
            self.restore().await;
        }
        self.patch(|state| state.status = Status::Ready);
        self.schedule();
    }

    /// Says who the visitor is. A different person than the conversation's owner drops it; 409 does too.
    pub async fn identify(&self, identity: Option<Identity>) {
        let key = identity_key(identity.as_ref());
        let owner = self.with(|inner| inner.session.as_ref().map(|s| s.identity_key.clone()).unwrap_or_default());
        if !key.is_empty() && !owner.is_empty() && key != owner {
            self.drop_conversation();
        }
        let target = self.with(|inner| {
            inner.identity = identity.clone();
            inner.session.as_ref().map(|s| (s.ticket_id.clone(), s.token.clone()))
        });
        let (Some(identity), Some((ticket_id, token))) = (identity, target) else { return };

        match self.transport.identify(&ticket_id, &token, &identity).await {
            Ok(_) => {
                self.with(|inner| {
                    if let Some(session) = inner.session.as_mut().filter(|s| s.ticket_id == ticket_id) {
                        session.identity_key = key;
                    }
                });
                self.persist();
            }
            Err(error) if error.status == 409 => self.drop_conversation(),
            // Never surfaced: this runs on every launch and sign-in, and quietly retries next time.
            Err(error) => self.note(&error),
        }
    }

    /// Sends a message, drawing it before it has gone anywhere. `email` is only read when opening.
    pub async fn send(&self, text: &str, email: Option<String>) {
        let body = text.trim();
        if body.is_empty() {
            return;
        }
        let pending = PendingMessage {
            client_message_id: uuid::Uuid::new_v4().to_string(),
            text: body.to_string(),
            created_at: now(),
        };
        self.patch(|state| {
            state.messages.push(draw(&pending));
            state.error = None;
        });

        let queued = self.with(|inner| match inner.session.as_mut() {
            Some(session) => {
                session.pending.push(pending.clone());
                true
            }
            None => false,
        });
        if !queued {
            self.open(pending, email.unwrap_or_default()).await;
            return;
        }
        self.persist();
        self.flush().await;
    }

    /// Tries a failed message again. On a new conversation this is the visitor's call, never ours.
    pub async fn retry(&self, client_message_id: &str) {
        let failed = self.with(|inner| {
            inner
                .state
                .messages
                .iter()
                .find(|m| m.client_message_id.as_deref() == Some(client_message_id) && m.delivery == Delivery::Failed)
                .cloned()
        });
        let Some(failed) = failed else { return };

        let pending = PendingMessage {
            client_message_id: client_message_id.to_string(),
            text: failed.text.clone(),
            created_at: failed.created_at.clone(),
        };
        self.replace(client_message_id, ChatMessage { delivery: Delivery::Pending, ..failed });

        let queued = self.with(|inner| {
            inner.session.as_mut().map(|session| {
                let missing = !session.pending.iter().any(|p| p.client_message_id == client_message_id);
                if missing {
                    session.pending.push(pending.clone());
                }
                missing
            })
        });
        match queued {
            None => {
                self.open(pending, String::new()).await;
                return;
            }
            Some(true) => self.persist(),
            Some(false) => {}
        }
        self.flush().await;
    }

    /// Whether the conversation is on screen: sets the poll rate and the `present` claim.
    pub fn set_present(&self, present: bool) {
        let changed = self.with(|inner| std::mem::replace(&mut inner.present, present) != present);
        if !changed {
            return;
        }
        if present {
            self.mark_read();
            self.spawn_tick();
        } else {
            self.schedule();
        }
    }

    /// Whether the app is in the foreground. Polling stops entirely when it is not.
    pub fn set_active(&self, active: bool) {
        let changed = self.with(|inner| std::mem::replace(&mut inner.active, active) != active);
        if !changed {
            return;
        }
        if active {
            self.spawn_tick();
        } else {
            self.clear_timer();
        }
    }

    /// Marks everything as seen, clearing the unread badge.
    pub fn mark_read(&self) {
        let touched = self.with(|inner| match inner.session.as_mut() {
            Some(session) => {
                session.last_read_cursor = session.cursor.clone();
                true
            }
            None => false,
        });
        if touched {
            self.persist();
        }
        if self.with(|inner| inner.state.unread_count != 0) {
            self.patch(|state| state.unread_count = 0);
        }
    }

    /// Asks now; resolves after a round that started no earlier than this call.
    pub async fn refresh(&self) {
        let _round = self.round.lock().await;
        self.run_round().await;
    }

    /// Forgets the visitor and the conversation on this device. For sign-out.
    pub fn reset(&self) {
        self.with(|inner| inner.identity = None);
        self.drop_conversation();
    }

    /// Stops polling and emitting. The chat is unusable afterwards.
    pub fn destroy(&self) {
        self.with(|inner| {
            inner.destroyed = true;
            inner.timer_generation += 1;
        });
    }

    // -- the conversation ------------------------------------------------------------

    async fn restore(&self) {
        let Some((ticket_id, token)) = self.with(|inner| inner.session.as_ref().map(|s| (s.ticket_id.clone(), s.token.clone())))
        else {
            return;
        };
        match self.transport.conversation(&ticket_id, &token).await {
            Ok(conversation) => {
                let cursor = conversation.cursor.clone();
                self.with(|inner| {
                    if let Some(session) = inner.session.as_mut().filter(|s| s.ticket_id == ticket_id) {
                        session.cursor = cursor;
                    }
                });
                self.persist();
                self.adopt(conversation, true);
                self.flush().await;
            }
            Err(error) => self.handle(&error),
        }
    }

    async fn open(&self, pending: PendingMessage, email: String) {
        let (identity, locale, timezone) =
            self.with(|inner| (inner.identity.clone(), inner.locale.clone(), inner.timezone.clone()));
        let result = self
            .transport
            .start(StartPayload {
                body_text: &pending.text,
                identity: identity.as_ref(),
                email: &email,
                locale: &locale,
                timezone: &timezone,
            })
            .await;

        match result {
            Ok(conversation) => {
                let session = StoredSession {
                    token: conversation.visitor_token.clone(),
                    ticket_id: conversation.ticket_id.clone(),
                    identity_key: identity_key(identity.as_ref()),
                    cursor: conversation.cursor.clone(),
                    // Read up to here by definition: the only message is the one just written.
                    last_read_cursor: conversation.cursor.clone(),
                    pending: Vec::new(),
                };
                self.with(|inner| inner.session = Some(session));
                self.persist();
                // The start endpoint takes no client id, so the early copy is dropped by hand.
                self.forget(&pending.client_message_id);
                self.adopt(conversation, true);
                self.patch(|state| state.offline = false);
                self.schedule();
            }
            Err(error) => {
                self.replace(&pending.client_message_id, ChatMessage { delivery: Delivery::Failed, ..draw(&pending) });
                self.fail(&error, true);
            }
        }
    }

    /// Sends the queue oldest first, stopping at the first one that cannot go, so order holds.
    async fn flush(&self) {
        let claimed = self.with(|inner| {
            if inner.session.is_none() || inner.flushing {
                false
            } else {
                inner.flushing = true;
                true
            }
        });
        if !claimed {
            return;
        }
        let _guard = FlushGuard(self);

        loop {
            let next = self.with(|inner| {
                inner.session.as_ref().and_then(|session| {
                    session.pending.first().map(|p| (session.ticket_id.clone(), session.token.clone(), p.clone()))
                })
            });
            let Some((ticket_id, token, message)) = next else { break };

            match self.transport.send(&ticket_id, &token, &message.text, &message.client_message_id).await {
                Ok(conversation) => {
                    self.unqueue(&message.client_message_id);
                    self.forget(&message.client_message_id);
                    self.adopt(conversation, false);
                    self.patch(|state| state.offline = false);
                }
                Err(error) => {
                    if self.handle_send_failure(&error, &message) {
                        break;
                    }
                }
            }
        }
    }

    /// Network errors keep the message queued; a server refusal marks it failed. Returns whether to stop.
    fn handle_send_failure(&self, error: &HelpwingError, message: &PendingMessage) -> bool {
        if error.is_gone() {
            self.handle(error);
            return true;
        }
        if error.is_network() {
            self.patch(|state| state.offline = true);
            return true;
        }
        self.unqueue(&message.client_message_id);
        self.replace(&message.client_message_id, ChatMessage { delivery: Delivery::Failed, ..draw(message) });
        self.fail(error, true);
        false
    }

    fn unqueue(&self, client_message_id: &str) {
        self.with(|inner| {
            if let Some(session) = inner.session.as_mut() {
                session.pending.retain(|p| p.client_message_id != client_message_id);
            }
        });
        self.persist();
    }

    fn drop_conversation(&self) {
        self.clear_timer();
        self.with(|inner| inner.session = None);
        self.store.clear();
        self.patch(|state| {
            state.conversation = None;
            state.messages.clear();
            state.typing = None;
            state.unread_count = 0;
            state.error = None;
        });
        self.schedule();
    }

    // -- polling ---------------------------------------------------------------------

    fn schedule(&self) {
        let (generation, interval) = self.with(|inner| {
            inner.timer_generation += 1;
            let interval = if inner.present { self.poll } else { self.background_poll };
            let armed = !inner.destroyed && inner.session.is_some() && inner.active && !interval.is_zero();
            (inner.timer_generation, armed.then_some(interval))
        });
        let Some(interval) = interval else { return };
        let me = self.me.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(interval).await;
            let Some(chat) = me.upgrade() else { return };
            if chat.with(|inner| inner.timer_generation == generation) {
                chat.tick().await;
            }
        });
    }

    fn clear_timer(&self) {
        self.with(|inner| inner.timer_generation += 1);
    }

    fn spawn_tick(&self) {
        let Some(chat) = self.me.upgrade() else { return };
        tauri::async_runtime::spawn(async move { chat.tick().await });
    }

    /// One round unless one is already in flight.
    async fn tick(&self) {
        let Ok(_round) = self.round.try_lock() else { return };
        self.run_round().await;
    }

    async fn run_round(&self) {
        let runnable = self.with(|inner| !inner.destroyed && inner.session.is_some() && inner.active);
        if !runnable {
            return;
        }
        self.flush().await;
        self.poll().await;
        self.schedule();
    }

    async fn poll(&self) {
        let target = self.with(|inner| {
            inner
                .session
                .as_ref()
                .map(|s| (s.ticket_id.clone(), s.token.clone(), s.cursor.clone(), inner.present))
        });
        let Some((ticket_id, token, cursor, present)) = target else { return };

        match self.transport.updates(&ticket_id, &token, &cursor, present).await {
            Ok(updates) => {
                let cursor = updates.cursor.clone();
                self.with(|inner| {
                    if let Some(session) = inner.session.as_mut().filter(|s| s.ticket_id == ticket_id) {
                        session.cursor = cursor;
                    }
                });
                self.persist();
                self.merge(&updates.messages, updates.typing, &updates.status);
                if self.with(|inner| inner.state.offline) {
                    self.patch(|state| state.offline = false);
                }
            }
            Err(error) => self.handle(&error),
        }
    }

    // -- state -----------------------------------------------------------------------

    fn adopt(&self, conversation: ApiConversation, replace_transcript: bool) {
        let summary = ConversationSummary {
            ticket_id: conversation.ticket_id.clone(),
            ticket_reference: conversation.ticket_reference.clone(),
            status: conversation.status.clone(),
            subject: conversation.subject.clone(),
        };
        self.patch(|state| {
            state.conversation = Some(summary);
            // Unsent messages survive a whole-transcript load: the server has never seen them.
            if replace_transcript {
                state.messages.retain(|m| m.delivery != Delivery::Sent);
            }
        });
        self.merge(&conversation.messages, conversation.typing, &conversation.status);
    }

    fn merge(&self, incoming: &[ApiMessage], typing: Option<Typing>, status: &str) {
        self.patch(|state| {
            state.messages = merge_messages(&state.messages, incoming);
            state.typing = typing;
            if let Some(conversation) = state.conversation.as_mut().filter(|_| !status.is_empty()) {
                conversation.status = status.to_string();
            }
        });
        self.recount();
    }

    /// Unread agent messages since the visitor last looked; always zero while they are looking.
    fn recount(&self) {
        let (present, since) = self.with(|inner| {
            (inner.present, inner.session.as_ref().map(|s| s.last_read_cursor.clone()).unwrap_or_default())
        });
        if present {
            self.mark_read();
            return;
        }
        let unread = self.with(|inner| unread_count(&inner.state.messages, &since));
        if self.with(|inner| inner.state.unread_count != unread) {
            self.patch(|state| state.unread_count = unread);
        }
    }

    fn forget(&self, client_message_id: &str) {
        self.patch(|state| {
            state
                .messages
                .retain(|m| m.client_message_id.as_deref() != Some(client_message_id) || m.delivery == Delivery::Sent)
        });
    }

    fn replace(&self, client_message_id: &str, message: ChatMessage) {
        self.patch(|state| {
            for existing in state.messages.iter_mut() {
                if existing.client_message_id.as_deref() == Some(client_message_id) && existing.delivery != Delivery::Sent {
                    *existing = message.clone();
                }
            }
        });
    }

    fn persist(&self) {
        if let Some(session) = self.with(|inner| inner.session.clone()) {
            self.store.write(&session);
        }
    }

    // -- failure ---------------------------------------------------------------------

    /// A conversation the server no longer knows is dropped; anything else is noted.
    fn handle(&self, error: &HelpwingError) {
        if error.is_gone() {
            self.with(|inner| inner.session = None);
            self.store.clear();
            self.clear_timer();
            self.patch(|state| {
                state.conversation = None;
                state.messages.clear();
                state.typing = None;
                state.unread_count = 0;
            });
            return;
        }
        self.note(error);
    }

    fn note(&self, error: &HelpwingError) {
        if error.is_network() {
            if !self.with(|inner| inner.state.offline) {
                self.patch(|state| state.offline = true);
            }
            return;
        }
        let message = error.message.clone();
        self.patch(|state| state.error = Some(message));
    }

    fn fail(&self, error: &HelpwingError, keep_status: bool) {
        self.note(error);
        if !keep_status && self.with(|inner| inner.state.status != Status::Ready) {
            self.patch(|state| state.status = Status::Error);
        }
    }

    // -- plumbing --------------------------------------------------------------------

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn with<T>(&self, f: impl FnOnce(&mut Inner) -> T) -> T {
        let mut inner = self.lock();
        f(&mut inner)
    }

    /// Mutates the state and emits the result, outside the lock.
    fn patch(&self, f: impl FnOnce(&mut ChatState)) {
        let snapshot = {
            let mut inner = self.lock();
            f(&mut inner.state);
            (!inner.destroyed).then(|| inner.state.clone())
        };
        if let Some(snapshot) = snapshot {
            (self.emit)(&snapshot);
        }
    }
}

/// Who an identity names, as one comparable string: the id, else the lowercased email.
pub fn identity_key(identity: Option<&Identity>) -> String {
    let Some(identity) = identity else { return String::new() };
    let id = identity.id.as_deref().unwrap_or("").trim();
    if !id.is_empty() {
        return format!("id:{id}");
    }
    let email = identity.email.as_deref().unwrap_or("").trim().to_lowercase();
    if email.is_empty() {
        String::new()
    } else {
        format!("email:{email}")
    }
}

/// Agent messages the server delivered after `since`, compared on the server's own clock.
pub fn unread_count(messages: &[ChatMessage], since: &str) -> usize {
    messages
        .iter()
        .filter(|m| m.author == "agent" && m.delivery == Delivery::Sent && m.created_at.as_str() > since)
        .count()
}

/// Folds server messages into the transcript, replacing any copy drawn before it was sent.
pub fn merge_messages(current: &[ChatMessage], incoming: &[ApiMessage]) -> Vec<ChatMessage> {
    let mut out: Vec<ChatMessage> = current.to_vec();
    let mut drawn_early = HashSet::new();
    for message in incoming {
        if !message.client_message_id.is_empty() {
            drawn_early.insert(message.client_message_id.clone());
        }
        let received = received(message);
        match out.iter().position(|existing| existing.id == received.id) {
            Some(index) => out[index] = received,
            None => out.push(received),
        }
    }
    out.retain(|m| {
        let early = m.client_message_id.as_ref().is_some_and(|id| drawn_early.contains(id));
        !(early && m.delivery != Delivery::Sent)
    });
    out.sort_by(|left, right| left.created_at.cmp(&right.created_at));
    out
}

fn draw(pending: &PendingMessage) -> ChatMessage {
    ChatMessage {
        id: pending.client_message_id.clone(),
        author: "customer".into(),
        author_name: String::new(),
        author_avatar_url: String::new(),
        text: pending.text.clone(),
        markdown: true,
        attachments: Vec::new(),
        created_at: pending.created_at.clone(),
        delivery: Delivery::Pending,
        client_message_id: Some(pending.client_message_id.clone()),
    }
}

fn received(message: &ApiMessage) -> ChatMessage {
    let markdown = !message.body_text.is_empty();
    ChatMessage {
        id: message.id.clone(),
        author: message.author.clone(),
        author_name: message.author_name.clone(),
        author_avatar_url: message.author_avatar_url.clone(),
        text: if markdown { message.body_text.clone() } else { html_to_text(&message.body_html) },
        markdown,
        attachments: message.attachments.clone(),
        created_at: message.created_at.clone(),
        delivery: Delivery::Sent,
        client_message_id: (!message.client_message_id.is_empty()).then(|| message.client_message_id.clone()),
    }
}

/// Deliberately crude HTML flattening for messages stored before bodies became markdown.
pub fn html_to_text(html: &str) -> String {
    static RULES: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    if html.is_empty() {
        return String::new();
    }
    let rules = RULES.get_or_init(|| {
        [
            (r"(?i)<\s*br\s*/?\s*>", "\n"),
            (r"(?i)<\s*/\s*(p|div|li|tr|h[1-6])\s*>", "\n"),
            (r"<[^>]*>", ""),
            (r"(?i)&nbsp;", " "),
            (r"(?i)&lt;", "<"),
            (r"(?i)&gt;", ">"),
            (r"(?i)&quot;", "\""),
            (r"(?i)&#39;", "'"),
            (r"(?i)&amp;", "&"),
            (r"\n{3,}", "\n\n"),
        ]
        .into_iter()
        .map(|(pattern, replacement)| (Regex::new(pattern).expect("valid pattern"), replacement))
        .collect()
    });
    let mut text = html.to_string();
    for (pattern, replacement) in rules {
        text = pattern.replace_all(&text, *replacement).into_owned();
    }
    text.trim().to_string()
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn api(id: &str, author: &str, created_at: &str, client_message_id: &str) -> ApiMessage {
        ApiMessage {
            id: id.into(),
            author: author.into(),
            body_text: format!("body {id}"),
            created_at: created_at.into(),
            client_message_id: client_message_id.into(),
            ..ApiMessage::default()
        }
    }

    fn pending(client_message_id: &str, created_at: &str) -> ChatMessage {
        draw(&PendingMessage {
            client_message_id: client_message_id.into(),
            text: "hi".into(),
            created_at: created_at.into(),
        })
    }

    #[test]
    fn identity_key_prefers_the_id_then_the_email() {
        assert_eq!(identity_key(None), "");
        assert_eq!(identity_key(Some(&Identity::default())), "");
        let by_id = Identity { id: Some(" 42 ".into()), email: Some("a@b.c".into()), ..Identity::default() };
        assert_eq!(identity_key(Some(&by_id)), "id:42");
        let by_email = Identity { email: Some(" Ann@Example.COM ".into()), ..Identity::default() };
        assert_eq!(identity_key(Some(&by_email)), "email:ann@example.com");
    }

    #[test]
    fn unread_counts_only_delivered_agent_messages_after_the_cursor() {
        let messages = merge_messages(
            &[pending("local-0000000000001", "2026-01-01T00:00:09Z")],
            &[
                api("a1", "agent", "2026-01-01T00:00:01Z", ""),
                api("a2", "agent", "2026-01-01T00:00:05Z", ""),
                api("c1", "customer", "2026-01-01T00:00:06Z", ""),
                api("s1", "system", "2026-01-01T00:00:07Z", ""),
            ],
        );
        assert_eq!(unread_count(&messages, ""), 2);
        assert_eq!(unread_count(&messages, "2026-01-01T00:00:02Z"), 1);
        assert_eq!(unread_count(&messages, "2026-01-01T00:00:05Z"), 0);
    }

    #[test]
    fn merge_replaces_the_early_copy_with_the_server_one() {
        let current = vec![pending("client-000000000001", "2026-01-01T00:00:02Z")];
        let merged = merge_messages(&current, &[api("m1", "customer", "2026-01-01T00:00:02Z", "client-000000000001")]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].id, "m1");
        assert_eq!(merged[0].delivery, Delivery::Sent);
        assert_eq!(merged[0].client_message_id.as_deref(), Some("client-000000000001"));
    }

    #[test]
    fn merge_updates_by_id_and_orders_by_time() {
        let first = merge_messages(&[], &[api("b", "agent", "2026-01-01T00:00:02Z", "")]);
        let mut edited = api("b", "agent", "2026-01-01T00:00:02Z", "");
        edited.body_text = "edited".into();
        let merged = merge_messages(&first, &[api("a", "agent", "2026-01-01T00:00:01Z", ""), edited]);
        assert_eq!(merged.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(merged[1].text, "edited");
    }

    #[test]
    fn merge_keeps_unsent_messages_the_server_has_not_seen() {
        let current = vec![pending("client-000000000002", "2026-01-01T00:00:09Z")];
        let merged = merge_messages(&current, &[api("m1", "agent", "2026-01-01T00:00:01Z", "")]);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[1].delivery, Delivery::Pending);
    }

    #[test]
    fn html_is_flattened_to_readable_text() {
        let html = "<p>Hi &amp; welcome</p><p>Line<br/>two &lt;ok&gt;</p><div></div><div></div><div></div>";
        assert_eq!(html_to_text(html), "Hi & welcome\nLine\ntwo <ok>");
        assert_eq!(html_to_text(""), "");
        assert_eq!(html_to_text("&AMP;lt;"), "&lt;");
    }

    #[test]
    fn a_message_without_markdown_falls_back_to_its_html() {
        let message = ApiMessage { id: "m".into(), body_html: "<b>old</b>".into(), ..ApiMessage::default() };
        let drawn = received(&message);
        assert!(!drawn.markdown);
        assert_eq!(drawn.text, "old");
        assert_eq!(drawn.client_message_id, None);
    }
}
