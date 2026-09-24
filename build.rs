// Every command the webview may invoke; each gets an `allow-<command>` permission.
const COMMANDS: &[&str] = &[
    "start",
    "state",
    "send",
    "retry",
    "identify",
    "set_present",
    "set_active",
    "mark_read",
    "refresh",
    "reset",
    "open_link",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
