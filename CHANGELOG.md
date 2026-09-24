# Changelog

`tauri-plugin-helpwing` (crates.io) and `@helpwing/tauri` (npm) are released together under
one version. The tag is the release: `v0.1.0` publishes 0.1.0 of both.

## 0.1.0

- **Initial release.** The Helpwing support chat for Tauri 2 apps, at parity with
  `@helpwing/react-native`:
  - The conversation runs in Rust: HTTP, the visitor token and the offline queue never touch
    the webview, so the widget's allowed-origins list does not need a `tauri://` entry.
  - Polling every 5 seconds while the chat is on screen, every 30 while it is not, and none
    while the window is hidden.
  - Unsent messages persist in the app data directory and go out in order, even after the
    app was killed. Sends are idempotent; starting a conversation is never retried for you.
  - `identify()` with the same rules as the other SDKs: a different person drops the stored
    conversation, and a `409` from the server does too.
  - `<helpwing-chat>` and `<helpwing-launcher>` custom elements, themed from the project's
    accent, with every string a property. Markdown in replies is rendered with DOM APIs
    only, never `innerHTML`.
