export const CHAT_CSS = `
:host { display: block; height: 100%; }
[hidden] { display: none !important; }
.frame { display: flex; flex-direction: column; height: 100%; font-family: var(--hw-font); color: var(--hw-text); background: var(--hw-background); }
.root { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.centre { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; color: var(--hw-muted); font-size: 14px; text-align: center; }
.availability { font-size: 12px; padding: 8px 16px; color: var(--hw-muted); border-bottom: 1px solid var(--hw-border); }
.banner { font-size: 12px; padding: 8px 16px; background: var(--hw-surface); color: var(--hw-muted); }
.transcript { flex: 1; overflow-y: auto; padding: 12px 0; display: flex; flex-direction: column; }
.greeting { flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px; color: var(--hw-muted); font-size: 15px; line-height: 22px; text-align: center; white-space: pre-wrap; }
.row { display: flex; flex-direction: column; margin: 4px 0; padding: 0 16px; }
.row.mine { align-items: flex-end; }
.row.theirs { align-items: flex-start; }
.row.system { align-items: center; padding: 8px 24px; font-size: 12px; color: var(--hw-muted); text-align: center; }
.bubble { max-width: 85%; border-radius: 16px; padding: 10px 14px; font-size: 15px; line-height: 21px; overflow-wrap: anywhere; }
.mine .bubble { background: var(--hw-accent); color: var(--hw-on-accent); border-bottom-right-radius: 4px; }
.theirs .bubble { background: var(--hw-surface); color: var(--hw-text); border-bottom-left-radius: 4px; }
.bubble.pending { opacity: 0.6; }
.plain { white-space: pre-wrap; }
.author { font-size: 12px; font-weight: 600; margin-bottom: 2px; color: var(--hw-muted); }
.files { margin-top: 6px; display: flex; flex-direction: column; gap: 2px; }
.file { font-size: 13px; color: inherit; text-decoration: underline; cursor: pointer; background: none; border: 0; padding: 0; text-align: left; font: inherit; }
.status { font-size: 11px; margin: 3px 4px 0; color: var(--hw-muted); }
.status.failed { color: var(--hw-danger); background: none; border: 0; padding: 0; cursor: pointer; font: inherit; font-size: 11px; }
.typing { font-size: 12px; padding: 0 20px 6px; color: var(--hw-muted); }
.composer { border-top: 1px solid var(--hw-border); padding: 8px 12px 12px; display: flex; flex-direction: column; gap: 8px; }
.composer .line { display: flex; align-items: flex-end; gap: 8px; }
.composer input, .composer textarea { font: inherit; font-size: 15px; color: var(--hw-text); background: var(--hw-surface); border: 0; border-radius: 20px; padding: 10px 16px; outline: none; }
.composer textarea { flex: 1; min-height: 20px; max-height: 120px; resize: none; }
.composer button { font: inherit; font-size: 15px; font-weight: 600; height: 40px; padding: 0 18px; border: 0; border-radius: 20px; background: var(--hw-accent); color: var(--hw-on-accent); cursor: pointer; }
.composer button:disabled { opacity: 0.4; cursor: default; }
.branding { font-size: 11px; text-align: center; padding: 0 0 10px; color: var(--hw-muted); background: none; border: 0; cursor: pointer; font-family: inherit; }
.bubble p { margin: 0 0 6px; }
.bubble p:last-child, .bubble li > p { margin: 0; }
.bubble h1, .bubble h2, .bubble h3, .bubble h4, .bubble h5, .bubble h6 { font-size: 1em; margin: 0 0 6px; }
.bubble ul, .bubble ol { margin: 0 0 6px; padding-left: 20px; }
.bubble blockquote { margin: 0 0 6px; padding-left: 10px; border-left: 3px solid currentColor; opacity: 0.8; }
.bubble pre { margin: 0 0 6px; padding: 8px; border-radius: 8px; background: rgba(127, 127, 127, 0.15); overflow-x: auto; }
.bubble code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
.bubble a { color: inherit; text-decoration: underline; }
.bubble img { max-width: 100%; border-radius: 8px; display: block; margin: 4px 0; }
.bubble hr { border: 0; border-top: 1px solid currentColor; opacity: 0.3; }
.bubble .table { overflow-x: auto; }
.bubble table { border-collapse: collapse; font-size: 0.9em; }
.bubble th, .bubble td { border: 1px solid rgba(127, 127, 127, 0.35); padding: 4px 8px; }
`

export const LAUNCHER_CSS = `
:host { display: contents; }
[hidden] { display: none !important; }
.frame { font-family: var(--hw-font); }
.anchor { position: fixed; z-index: 2147483000; }
.button { position: relative; font: inherit; font-size: 15px; font-weight: 600; height: 48px; padding: 0 20px; border: 0; border-radius: 24px; background: var(--hw-accent); color: var(--hw-on-accent); cursor: pointer; box-shadow: 0 4px 16px rgba(16, 24, 40, 0.2); }
.badge { position: absolute; top: -6px; right: -6px; min-width: 20px; height: 20px; padding: 0 5px; box-sizing: border-box; border-radius: 10px; border: 2px solid var(--hw-background); background: var(--hw-danger); color: #fff; font-size: 11px; line-height: 16px; text-align: center; }
.panel { position: fixed; z-index: 2147483001; width: min(380px, calc(100vw - 32px)); height: min(600px, calc(100vh - 32px)); display: flex; flex-direction: column; border-radius: 16px; overflow: hidden; background: var(--hw-background); color: var(--hw-text); border: 1px solid var(--hw-border); box-shadow: 0 12px 40px rgba(16, 24, 40, 0.25); }
.header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--hw-border); }
.title { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.close { font: inherit; font-size: 14px; background: none; border: 0; color: var(--hw-accent); cursor: pointer; }
.panel > .body { flex: 1; min-height: 0; }
`
