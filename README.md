# Helpwing for Tauri

The [Helpwing](https://helpwing.app) support chat for Tauri 2 apps. App chat, website chat
and email tickets land in the same inbox.

Two packages, one version:

- **`tauri-plugin-helpwing`** (Rust). Owns the conversation: HTTP, the visitor token, the
  offline queue, polling.
- **`@helpwing/tauri`** (JS). Bindings to the plugin, and two custom elements,
  `<helpwing-chat>` and `<helpwing-launcher>`, that work in any frontend: React, Vue,
  Svelte, Solid or none.

Features:

- Drop-in launcher and panel, a chat element for your own screen, or a client object if
  you want to draw it yourself
- Themed from your project's accent colour, or overridden to match your design system
- Every string is a property, so it speaks whatever language your app does
- Survives a lost connection and a killed app: messages queue, persist and retry

```bash
cargo add tauri-plugin-helpwing   # in src-tauri/
npm install @helpwing/tauri
```

## Why a plugin, not a script tag

The widget API checks the `Origin` of every request against the project's allowed origins.
A Tauri webview sends `tauri://localhost` or `http://tauri.localhost`, which no project
lists. Here every request goes out from Rust, with no `Origin` header, just like a mobile
SDK's requests. You don't have to add anything to the allow list.

## Setup

Register the plugin in `src-tauri/src/lib.rs`:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_helpwing::Builder::new("https://api.helpwing.app", "pk_live_...").build())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

Allow its commands in `src-tauri/capabilities/default.json`:

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": ["core:default", "helpwing:default"]
}
```

Then put the launcher on the page:

```ts
import { defineHelpwingElements, HelpwingChat } from '@helpwing/tauri'

defineHelpwingElements()
void HelpwingChat.shared().start()
```

```html
<helpwing-launcher></helpwing-launcher>
```

The project key is public. It is the same key the website snippet carries in
`data-project`, and shipping it in an app bundle is expected.

`api_url` is the host that serves `/widget.js`, because `/widget/` is routed on that host.

`start()` loads the project's settings and any conversation already stored. It sends the
webview's `navigator.language` and time zone unless you pass `{ locale, timezone }`. The
elements call it for you if you don't. Calling it again refreshes the settings.

## Your own screen instead

The launcher is a convenience. An app with its own "Help" item in a menu puts the chat on a
page of its own:

```html
<helpwing-chat locale="fr"></helpwing-chat>
```

The element fills its container and marks the visitor as reading while it is connected.
Mount it only while it is on screen. Presence decides whether an agent's reply is also
emailed.

For a badge on your own menu item, or a UI you draw yourself, use the client:

```ts
const chat = HelpwingChat.shared()
const stop = chat.subscribe((state) => {
  badge.textContent = state.unreadCount ? String(state.unreadCount) : ''
})
```

Everything is on it: `state` (`messages`, `unreadCount`, `typing`, `offline`, `config`,
`status`, `error`), `send`, `retry`, `identify`, `refresh`, `markRead`, `reset`,
`claimPresence`. `parseMarkdown` and `renderMarkdown` are exported for a transcript of your
own.

From Rust, `app.helpwing()` (trait `HelpwingExt`) returns the same conversation. It has
the same methods, plus `state()`.

## Telling us who the visitor is

```ts
await HelpwingChat.shared().identify(
  user ? { id: user.id, email: user.email, name: user.name, userHash: user.supportHash } : null,
)
```

Call it at startup and whenever sign-in changes. It applies to a conversation that started
before anyone signed in too: the conversation moves to the customer's record.

**`userHash` is an HMAC-SHA256 of the user id, keyed with your project's identity secret,
and your server computes it.** A desktop bundle is an archive with your code in it. A
secret shipped inside it is not a secret. Fetch the hash from your own API with the rest of
the signed-in user.

With identity verification turned on in the dashboard, an unproved claim is not refused.
It just doesn't count: the visitor gets a customer record of their own, and what they
claimed is kept where an agent can see it.

On sign-out, `identify(null)` stops the *next* conversation being attributed to whoever
just left. `reset()` also forgets the conversation itself, which is what you want on a
shared machine.

When somebody else signs in straight away, you need neither. A conversation belongs to
whoever opened it: once a different person is identified, the stored conversation is
dropped and B starts their own. The server enforces the same rule and answers `409` if it
is asked to move a conversation between two identified customers.

## Text

**The chat's own chrome** ("Send", "Write a message…"). No translations ship with this
package; every string is a property:

```ts
const chat = document.querySelector('helpwing-chat')!
chat.labels = { placeholder: 'Écrivez un message…', send: 'Envoyer' }
```

or as JSON in the `labels` attribute. `DEFAULT_LABELS` is exported with the whole list.

**What the project wrote** (the header, the greeting, the offline message and the typing
text) is translated in the dashboard under **Chat widget → Appearance**. The `locale`
attribute picks which translation to show, and defaults to `navigator.language`. `ru-RU`
finds `ru`. A language the project has not translated falls back to the untranslated text,
never to a stock line of ours.

The typing text replaces `labels.typing` while an agent is typing, with `{name}` filled in
with the agent's name. A project that has not written one keeps the built-in
`labels.typing` label, so overriding it still works for projects that leave typing text blank.

## Colours

The project picks an accent in the dashboard, and everything else is worked out from it,
including whether text on top of it should be white or ink.

Light or dark comes from **Chat widget → Appearance → Colour scheme**, which ships as
`Auto` and follows the system's `prefers-color-scheme`. The `dark` attribute or property
overrules it (`dark` or `dark="false"`).

An app with a design system of its own sets only what differs:

```ts
chat.theme = { accent: '#c6ff3a', background: '#0a0a0b', surface: '#141517', fontFamily: 'Fira Sans' }
```

`fontFamily` is a CSS `font-family` value. Left out, the elements inherit the page's font.

## Delivery, polling and offline

All of this is handled for you:

- New messages are polled every 5 seconds while a chat element is connected, and every 30
  while none is, so the unread badge stays accurate. Polling stops while the window is
  hidden. Both intervals are set on the Builder (`poll_interval`,
  `background_poll_interval`; zero stops background polling).
- Sends are idempotent and retried automatically, so a request lost on a flaky connection
  does not produce a duplicate. Starting a brand new conversation is the exception: if its
  response is lost, it shows as a failed send, and retrying it is the visitor's decision.
- Unsent messages are written to `app_data_dir()/helpwing/` and go out in order on the next
  launch, even if the process was killed.
- Unread counts are computed against the server's cursor, never the local clock.

## Operating hours

The project's **Settings → Operating hours** decide whether the chat shows its greeting or
its offline message. `state.config.is_online` holds the answer, and `<helpwing-chat>` already
handles both. A project can also choose to hide the chat outside its hours. While it is
closed, `state.status` is then `unconfigured`, the same state a widget that is turned off
reports.

## Markdown

Agents reply in markdown, so a reply arrives formatted: **bold**, _italic_, `code`, links,
lists, quotes, headings, fenced code, rules and tables. There is nothing to turn on. The
parser produces plain data, and the elements build DOM nodes from it. There is no
`innerHTML` anywhere, so nothing anybody typed can become markup.

A picture pasted into an email is drawn where it was written, from the message's own
signed attachment URL. If your CSP restricts `img-src`, allow your API host. Other
attachments are listed by filename.

Links open in the system browser through the plugin, and only `http`, `https`, `mailto`
and `tel` links. To open them some other way, for example with
`@tauri-apps/plugin-opener`, pass an opener:

```ts
import { openUrl } from '@tauri-apps/plugin-opener'
HelpwingChat.shared().setLinkOpener(openUrl)
```

Tauri on iOS and Android has no default opener, so pass one there.

## What it does not do

- **Push notifications.** Nothing arrives while the app is closed. Turn on `require_email`
  on the widget settings screen, and a reply written while the visitor is away reaches them
  by email.
- **Attachments from the visitor.** The API has no endpoint for them yet.
- **One conversation on two machines.** A visitor token belongs to one installation.

## Reference

| `Builder` (Rust) | |
| --- | --- |
| `new(api_url, project_key)` | Required. |
| `poll_interval(Duration)` | While a chat is on screen. Default 5s. |
| `background_poll_interval(Duration)` | While none is. Default 30s; zero to stop. |
| `locale(..)` / `timezone(..)` | Sent when a conversation opens. The JS `start()` overrides them. |

| `<helpwing-chat>` | |
| --- | --- |
| `chat` | The client to draw. Default `HelpwingChat.shared()`. |
| `labels` / `labels="{…}"` | Override any string. |
| `theme` | Override any colour, and the font. |
| `dark` / `dark="false"` | Force the dark palette on or off. |
| `locale` | Picks the project's translated greeting. Default `navigator.language`. |
| `slot="header"` | Drawn above the transcript. |

`<helpwing-launcher>` takes the same, plus `position` (`bottom_right` / `bottom_left`;
default from the dashboard), `offset` (pixels, default 24) and `heading` (the panel's
title; default the project's title, then its name). It has `open()` and `close()` methods
and fires `helpwing-open` / `helpwing-close` events.

| Command (`plugin:helpwing\|…`) | Permission |
| --- | --- |
| `start`, `state`, `send`, `retry`, `identify`, `set_present`, `set_active`, `mark_read`, `refresh`, `reset`, `open_link` | `allow-<command>`; `helpwing:default` grants all |

The state is emitted as the `helpwing://state` event on every change.

## Links

- [Documentation](https://helpwing.app/docs/tauri)
- [Issues](https://github.com/helpwing/helpwing-tauri-sdk/issues)
- [Changelog](CHANGELOG.md)

MIT © Helpwing
