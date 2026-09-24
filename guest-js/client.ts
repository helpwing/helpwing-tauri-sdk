import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type { ChatState, Identity } from './types.js'

/** The event the plugin emits on every change. */
export const STATE_EVENT = 'helpwing://state'

export interface StartOptions {
  /** Picks the project's translated copy and is sent when a conversation opens. Default: `navigator.language`. */
  locale?: string
  /** Sent when a conversation opens. Default: the webview's IANA zone. */
  timezone?: string
}

export type LinkOpener = (href: string) => void | Promise<void>

export const INITIAL_STATE: ChatState = {
  status: 'idle',
  config: null,
  conversation: null,
  messages: [],
  typing: null,
  unreadCount: 0,
  offline: false,
  error: null,
}

let shared: HelpwingChat | null = null

/** The conversation held by the Rust plugin, mirrored into the webview. */
export class HelpwingChat {
  private current: ChatState = INITIAL_STATE
  private readonly listeners = new Set<(state: ChatState) => void>()
  private unlisten: Promise<UnlistenFn> | null = null
  private eventsSeen = 0
  private started: Promise<void> | null = null
  private presence = 0
  private linkOpener: LinkOpener | null = null
  private readonly onVisibility = (): void => {
    void this.setActive(document.visibilityState !== 'hidden')
  }

  /** One per webview; every element uses it unless handed another. */
  static shared(): HelpwingChat {
    shared ??= new HelpwingChat()
    return shared
  }

  get state(): ChatState {
    return this.current
  }

  /** Called immediately, then on every change. Returns the unsubscribe. */
  subscribe(listener: (state: ChatState) => void): () => void {
    this.listeners.add(listener)
    this.attach()
    listener(this.current)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Loads the config and any stored conversation. Safe to call again; a second call refreshes. */
  start(options: StartOptions = {}): Promise<void> {
    this.attach()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility)
      document.addEventListener('visibilitychange', this.onVisibility)
    }
    this.started = invoke<void>('plugin:helpwing|start', {
      locale: options.locale ?? HelpwingChat.defaultLocale(),
      timezone: options.timezone ?? HelpwingChat.defaultTimezone(),
    })
    return this.started
  }

  /** `start()` once, for callers that only need it to have happened. */
  ensureStarted(): Promise<void> {
    return this.started ?? this.start()
  }

  /** Sends a message. `email` is only read when the conversation is being opened. */
  send(text: string, options: { email?: string } = {}): Promise<void> {
    return invoke('plugin:helpwing|send', { text, email: options.email || null })
  }

  retry(clientMessageId: string): Promise<void> {
    return invoke('plugin:helpwing|retry', { clientMessageId })
  }

  /** Who the visitor is, or `null` on sign-out. `reset()` also forgets the conversation. */
  identify(identity: Identity | null): Promise<void> {
    return invoke('plugin:helpwing|identify', { identity })
  }

  /** Whether the conversation is on screen. The chat element sets this for you. */
  setPresent(present: boolean): Promise<void> {
    return invoke('plugin:helpwing|set_present', { present })
  }

  /** Whether the app is in the foreground. Tracked from `visibilitychange` once started. */
  setActive(active: boolean): Promise<void> {
    return invoke('plugin:helpwing|set_active', { active })
  }

  markRead(): Promise<void> {
    return invoke('plugin:helpwing|mark_read')
  }

  /** Asks now; resolves once a round that started after this call is done. */
  refresh(): Promise<void> {
    return invoke('plugin:helpwing|refresh')
  }

  /** Forgets the visitor and the conversation on this device. For sign-out. */
  reset(): Promise<void> {
    return invoke('plugin:helpwing|reset')
  }

  /** Marks the visitor as reading until the returned release is called. Counted, so nesting is fine. */
  claimPresence(): () => void {
    this.presence++
    if (this.presence === 1) void this.setPresent(true)
    let released = false
    return () => {
      if (released) return
      released = true
      this.presence--
      if (this.presence === 0) void this.setPresent(false)
    }
  }

  /** Replaces how links in replies are opened, e.g. with `openUrl` from `@tauri-apps/plugin-opener`. */
  setLinkOpener(opener: LinkOpener | null): void {
    this.linkOpener = opener
  }

  openLink(href: string): void {
    const opened = this.linkOpener
      ? this.linkOpener(href)
      : invoke('plugin:helpwing|open_link', { url: href })
    void Promise.resolve(opened).catch(() => undefined)
  }

  /** Stops listening. The Rust side keeps the conversation. */
  destroy(): void {
    this.listeners.clear()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility)
    void this.unlisten?.then((stop) => stop())
    this.unlisten = null
    if (shared === this) shared = null
  }

  private attach(): void {
    if (this.unlisten) return
    this.unlisten = listen<ChatState>(STATE_EVENT, (event) => {
      this.eventsSeen++
      this.receive(event.payload)
    })
    const seenBefore = this.eventsSeen
    void this.unlisten
      .then(() => invoke<ChatState>('plugin:helpwing|state'))
      .then((state) => {
        // An event that arrived meanwhile is newer than this snapshot.
        if (this.eventsSeen === seenBefore && state) this.receive(state)
      })
      .catch(() => undefined)
  }

  private receive(state: ChatState): void {
    this.current = state
    for (const listener of this.listeners) listener(state)
  }

  private static defaultLocale(): string {
    return typeof navigator !== 'undefined' ? navigator.language ?? '' : ''
  }

  private static defaultTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
    } catch {
      return ''
    }
  }
}

/** What the elements need from a chat; `HelpwingChat` is one, a test double is another. */
export type SupportClient = Pick<
  HelpwingChat,
  'state' | 'subscribe' | 'ensureStarted' | 'send' | 'retry' | 'claimPresence' | 'openLink'
>
