use serde::{ser::Serializer, Serialize};

/// A request that failed. `status` is 0 when no answer arrived at all.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct HelpwingError {
    pub status: u16,
    pub message: String,
}

impl HelpwingError {
    pub const NETWORK: u16 = 0;

    pub fn network(message: impl Into<String>) -> Self {
        Self { status: Self::NETWORK, message: message.into() }
    }

    pub fn http(message: impl Into<String>, status: u16) -> Self {
        Self { status, message: message.into() }
    }

    pub fn is_network(&self) -> bool {
        self.status == Self::NETWORK
    }

    /// The visitor token names nothing any more, so the stored conversation is gone.
    pub fn is_gone(&self) -> bool {
        self.status == 404
    }
}

/// What a command can return to the webview.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Message(String),
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
