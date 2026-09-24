import { HelpwingChat, type SupportClient } from '../client.js'
import { Copy } from '../copy.js'
import { DEFAULT_LABELS, type ChatLabels } from '../labels.js'
import type { Theme } from '../palette.js'
import type { ChatState } from '../types.js'
import { CHAT_TAG, type HelpwingChatElement } from './chat.js'
import { LAUNCHER_CSS } from './styles.js'
import { applyTheme, booleanAttribute, ElementBase, resolveTheme } from './theme.js'

export const LAUNCHER_TAG = 'helpwing-launcher'

/** A button in the corner and the panel it opens, like the website widget. */
export class HelpwingLauncherElement extends ElementBase {
  static get observedAttributes(): string[] {
    return ['position', 'offset', 'locale', 'dark', 'labels', 'heading']
  }

  private client: SupportClient | null = null
  private labelOverrides: Partial<ChatLabels> = {}
  private themeOverride: Partial<Theme> | undefined
  private darkOverride: boolean | undefined
  private localeValue: string | undefined
  private headingValue: string | undefined
  private unsubscribe: (() => void) | null = null
  private dom: {
    frame: HTMLDivElement
    anchor: HTMLDivElement
    button: HTMLButtonElement
    badge: HTMLSpanElement
    panel: HTMLDivElement
    title: HTMLSpanElement
    close: HTMLButtonElement
    body: HTMLDivElement
  } | null = null
  private chatElement: HelpwingChatElement | null = null

  get chat(): SupportClient {
    return this.client ?? HelpwingChat.shared()
  }

  set chat(value: SupportClient | null) {
    const connected = this.unsubscribe !== null
    this.unsubscribe?.()
    this.unsubscribe = null
    this.client = value
    if (this.chatElement) this.chatElement.chat = value
    if (connected) this.subscribe()
  }

  get labels(): Partial<ChatLabels> {
    return this.labelOverrides
  }

  set labels(value: Partial<ChatLabels> | null) {
    this.labelOverrides = value ?? {}
    if (this.chatElement) this.chatElement.labels = this.labelOverrides
    this.redraw()
  }

  get theme(): Partial<Theme> | undefined {
    return this.themeOverride
  }

  set theme(value: Partial<Theme> | undefined) {
    this.themeOverride = value ?? undefined
    if (this.chatElement) this.chatElement.theme = this.themeOverride
    this.redraw()
  }

  get dark(): boolean | undefined {
    return this.darkOverride
  }

  set dark(value: boolean | undefined) {
    this.darkOverride = value
    if (this.chatElement) this.chatElement.dark = value
    this.redraw()
  }

  get locale(): string | undefined {
    return this.localeValue
  }

  set locale(value: string | undefined) {
    this.localeValue = value || undefined
    if (this.chatElement) this.chatElement.locale = this.localeValue
    this.redraw()
  }

  /** The panel's heading. Defaults to the project's title, then its name. */
  get heading(): string | undefined {
    return this.headingValue
  }

  set heading(value: string | undefined) {
    this.headingValue = value || undefined
    this.redraw()
  }

  get isOpen(): boolean {
    return this.chatElement !== null
  }

  attributeChangedCallback(name: string, _previous: string | null, value: string | null): void {
    if (name === 'locale') this.locale = value ?? undefined
    else if (name === 'dark') this.dark = booleanAttribute(value)
    else if (name === 'heading') this.heading = value ?? undefined
    else if (name === 'labels') {
      try {
        this.labels = value ? (JSON.parse(value) as Partial<ChatLabels>) : {}
      } catch {
        this.labels = {}
      }
    } else this.redraw()
  }

  connectedCallback(): void {
    this.build()
    this.subscribe()
    void this.chat.ensureStarted().catch(() => undefined)
  }

  disconnectedCallback(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.close()
  }

  open(): void {
    const dom = this.dom
    if (!dom || this.chatElement) return
    const chat = document.createElement(CHAT_TAG) as HelpwingChatElement
    if (this.client) chat.chat = this.client
    chat.labels = this.labelOverrides
    chat.theme = this.themeOverride
    chat.dark = this.darkOverride
    chat.locale = this.localeValue
    this.chatElement = chat
    dom.body.replaceChildren(chat)
    this.redraw()
    this.dispatchEvent(new CustomEvent('helpwing-open'))
  }

  close(): void {
    if (!this.chatElement) return
    this.chatElement.remove()
    this.chatElement = null
    this.redraw()
    this.dispatchEvent(new CustomEvent('helpwing-close'))
  }

  private subscribe(): void {
    this.unsubscribe = this.chat.subscribe((state) => this.render(state))
  }

  private redraw(): void {
    if (this.dom && this.unsubscribe) this.render(this.chat.state)
  }

  private build(): void {
    if (this.dom) return
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = LAUNCHER_CSS

    const frame = document.createElement('div')
    frame.className = 'frame'
    const anchor = document.createElement('div')
    anchor.className = 'anchor'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'button'
    const label = document.createElement('span')
    label.className = 'label'
    const badge = document.createElement('span')
    badge.className = 'badge'
    button.append(label, badge)
    anchor.append(button)

    const panel = document.createElement('div')
    panel.className = 'panel'
    panel.setAttribute('role', 'dialog')
    const header = document.createElement('div')
    header.className = 'header'
    const title = document.createElement('span')
    title.className = 'title'
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'close'
    header.append(title, close)
    const body = document.createElement('div')
    body.className = 'body'
    panel.append(header, body)

    frame.append(anchor, panel)
    shadow.replaceChildren(style, frame)

    button.addEventListener('click', () => this.open())
    close.addEventListener('click', () => this.close())
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close()
    })

    this.dom = { frame, anchor, button, badge, panel, title, close, body }
  }

  private render(state: ChatState): void {
    const dom = this.dom
    if (!dom) return
    const text = { ...DEFAULT_LABELS, ...this.labelOverrides }
    const config = state.config
    applyTheme(dom.frame, resolveTheme(config, this.darkOverride, this.themeOverride))

    const offset = Number.parseInt(this.getAttribute('offset') ?? '', 10)
    const inset = `${Number.isFinite(offset) ? offset : 24}px`
    const position = this.getAttribute('position') ?? config?.launcher_position
    const left = position === 'bottom_left'
    for (const element of [dom.anchor, dom.panel]) {
      element.style.bottom = inset
      element.style.left = left ? inset : ''
      element.style.right = left ? '' : inset
    }

    // Nothing to launch: no widget, turned off, or turned off for desktop — which a desktop app honours.
    const launchable = state.status === 'ready' && config?.show_on_desktop !== false
    dom.anchor.hidden = !launchable || this.isOpen
    dom.panel.hidden = !this.isOpen

    const labelNode = dom.button.querySelector('.label') as HTMLSpanElement
    labelNode.textContent = text.launcher
    dom.button.setAttribute('aria-label', text.launcher)
    dom.badge.hidden = state.unreadCount <= 0
    dom.badge.textContent = state.unreadCount > 9 ? '9+' : String(state.unreadCount)

    const locale = this.localeValue ?? (typeof navigator !== 'undefined' ? navigator.language : undefined)
    dom.title.textContent = this.headingValue || Copy.forLocale(config, 'title', locale) || config?.project_name || ''
    dom.close.textContent = text.close
  }
}
