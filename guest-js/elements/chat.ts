import { HelpwingChat, type SupportClient } from '../client.js'
import { Copy } from '../copy.js'
import { DEFAULT_LABELS, type ChatLabels } from '../labels.js'
import type { Theme } from '../palette.js'
import type { ChatMessage, ChatState, WidgetConfig } from '../types.js'
import { renderMarkdown } from './markdown.js'
import { CHAT_CSS } from './styles.js'
import { applyTheme, booleanAttribute, ElementBase, resolveTheme } from './theme.js'

export const CHAT_TAG = 'helpwing-chat'
const BRAND_URL = 'https://helpwing.app'

interface ChatDom {
  frame: HTMLDivElement
  centre: HTMLDivElement
  root: HTMLDivElement
  availability: HTMLDivElement
  banner: HTMLDivElement
  transcript: HTMLDivElement
  typing: HTMLDivElement
  email: HTMLInputElement
  input: HTMLTextAreaElement
  send: HTMLButtonElement
  branding: HTMLButtonElement
}

/** The conversation as a screen. Being connected is what marks the visitor as reading. */
export class HelpwingChatElement extends ElementBase {
  static get observedAttributes(): string[] {
    return ['locale', 'dark', 'labels']
  }

  private client: SupportClient | null = null
  private labelOverrides: Partial<ChatLabels> = {}
  private themeOverride: Partial<Theme> | undefined
  private darkOverride: boolean | undefined
  private localeValue: string | undefined
  private dom: ChatDom | null = null
  private unsubscribe: (() => void) | null = null
  private releasePresence: (() => void) | null = null
  private media: MediaQueryList | null = null
  private drawnMessages: ChatMessage[] | null = null
  private drawnConfig: WidgetConfig | null = null
  private readonly onScheme = (): void => this.redraw()

  /** The client to draw. Defaults to `HelpwingChat.shared()`. */
  get chat(): SupportClient {
    return this.client ?? HelpwingChat.shared()
  }

  set chat(value: SupportClient | null) {
    const connected = this.unsubscribe !== null
    if (connected) this.detach()
    this.client = value
    if (connected) this.attach()
  }

  get labels(): Partial<ChatLabels> {
    return this.labelOverrides
  }

  set labels(value: Partial<ChatLabels> | null) {
    this.labelOverrides = value ?? {}
    this.redraw()
  }

  get theme(): Partial<Theme> | undefined {
    return this.themeOverride
  }

  set theme(value: Partial<Theme> | undefined) {
    this.themeOverride = value ?? undefined
    this.redraw()
  }

  /** Forces the dark palette on or off; `undefined` lets the project and the system decide. */
  get dark(): boolean | undefined {
    return this.darkOverride
  }

  set dark(value: boolean | undefined) {
    this.darkOverride = value
    this.redraw()
  }

  get locale(): string | undefined {
    return this.localeValue
  }

  set locale(value: string | undefined) {
    this.localeValue = value || undefined
    this.redraw()
  }

  attributeChangedCallback(name: string, _previous: string | null, value: string | null): void {
    if (name === 'locale') this.localeValue = value || undefined
    if (name === 'dark') this.darkOverride = booleanAttribute(value)
    if (name === 'labels') {
      try {
        this.labelOverrides = value ? (JSON.parse(value) as Partial<ChatLabels>) : {}
      } catch {
        this.labelOverrides = {}
      }
    }
    this.redraw()
  }

  connectedCallback(): void {
    this.build()
    this.attach()
    if (typeof matchMedia === 'function') {
      this.media = matchMedia('(prefers-color-scheme: dark)')
      this.media.addEventListener?.('change', this.onScheme)
    }
  }

  disconnectedCallback(): void {
    this.detach()
    this.media?.removeEventListener?.('change', this.onScheme)
    this.media = null
  }

  private attach(): void {
    const chat = this.chat
    this.drawnMessages = null
    this.unsubscribe = chat.subscribe((state) => this.render(state))
    this.releasePresence = chat.claimPresence()
    void chat.ensureStarted().catch(() => undefined)
  }

  private detach(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.releasePresence?.()
    this.releasePresence = null
  }

  private text(): ChatLabels {
    return { ...DEFAULT_LABELS, ...this.labelOverrides }
  }

  private redraw(): void {
    if (!this.dom || !this.unsubscribe) return
    this.drawnMessages = null
    this.render(this.chat.state)
  }

  private build(): void {
    if (this.dom) return
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = CHAT_CSS

    const frame = div('frame')
    const centre = div('centre')
    const root = div('root')
    const availability = div('availability')
    const banner = div('banner')
    const transcript = div('transcript')
    transcript.setAttribute('role', 'log')
    transcript.setAttribute('aria-live', 'polite')
    const typing = div('typing')

    const composer = document.createElement('form')
    composer.className = 'composer'
    const email = document.createElement('input')
    email.type = 'email'
    email.autocomplete = 'email'
    const line = div('line')
    const input = document.createElement('textarea')
    input.rows = 1
    const send = document.createElement('button')
    send.type = 'submit'
    line.append(input, send)
    composer.append(email, line)

    const branding = document.createElement('button')
    branding.type = 'button'
    branding.className = 'branding'
    branding.addEventListener('click', () => this.chat.openLink(BRAND_URL))

    const header = document.createElement('slot')
    header.name = 'header'
    root.append(header, availability, banner, transcript, typing, composer, branding)
    frame.append(centre, root)
    shadow.replaceChildren(style, frame)

    composer.addEventListener('submit', (event) => {
      event.preventDefault()
      this.submit()
    })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault()
        this.submit()
      }
    })
    input.addEventListener('input', () => this.updateSend())
    email.addEventListener('input', () => this.updateSend())

    this.dom = { frame, centre, root, availability, banner, transcript, typing, email, input, send, branding }
  }

  private askForEmail(state: ChatState): boolean {
    // Only until there is a conversation to reply to, as the web widget does.
    return Boolean(state.config?.require_email) && !state.conversation
  }

  private ready(): boolean {
    const dom = this.dom
    if (!dom) return false
    const needsEmail = !dom.email.hidden
    return dom.input.value.trim().length > 0 && (!needsEmail || dom.email.value.trim().length > 0)
  }

  private updateSend(): void {
    if (this.dom) this.dom.send.disabled = !this.ready()
  }

  private submit(): void {
    const dom = this.dom
    if (!dom || !this.ready()) return
    const email = dom.email.hidden ? '' : dom.email.value.trim()
    void this.chat.send(dom.input.value, email ? { email } : {}).catch(() => undefined)
    dom.input.value = ''
    this.updateSend()
  }

  private render(state: ChatState): void {
    const dom = this.dom
    if (!dom) return
    const text = this.text()
    applyTheme(dom.frame, resolveTheme(state.config, this.darkOverride, this.themeOverride))

    const loading = state.status === 'idle' || state.status === 'loading'
    const unavailable = state.status === 'unconfigured'
    dom.centre.hidden = !(loading || unavailable)
    dom.centre.textContent = loading ? text.loading : text.unavailable
    dom.root.hidden = loading || unavailable
    if (dom.root.hidden) return

    const config = state.config
    dom.availability.hidden = !config?.show_agent_availability
    dom.availability.textContent = config?.is_online ? text.online : text.away
    dom.banner.hidden = !state.offline
    dom.banner.textContent = text.offline

    if (state.messages !== this.drawnMessages || config !== this.drawnConfig) this.drawTranscript(state, text)

    dom.typing.hidden = !state.typing
    dom.typing.textContent = state.typing ? text.typing(state.typing.name) : ''

    dom.email.hidden = !this.askForEmail(state)
    dom.email.placeholder = text.emailPlaceholder
    dom.input.placeholder = text.placeholder
    dom.send.textContent = text.send
    dom.send.setAttribute('aria-label', text.send)
    this.updateSend()

    dom.branding.hidden = !config?.show_branding
    dom.branding.textContent = text.branding
  }

  private drawTranscript(state: ChatState, text: ChatLabels): void {
    const transcript = (this.dom as ChatDom).transcript
    const previous = this.drawnMessages?.length ?? 0
    const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 48
    this.drawnMessages = state.messages
    this.drawnConfig = state.config

    if (!state.messages.length) {
      const locale = this.localeValue ?? (typeof navigator !== 'undefined' ? navigator.language : undefined)
      const offline = Copy.forLocale(state.config, 'offline_message', locale)
      const greeting = div('greeting')
      greeting.textContent =
        state.config?.is_online === false && offline ? offline : Copy.forLocale(state.config, 'greeting', locale)
      transcript.replaceChildren(greeting)
      return
    }

    transcript.replaceChildren(...state.messages.map((message) => this.drawMessage(message, text)))
    // Only downwards, and only when something arrived or the reader was already at the bottom.
    if (state.messages.length > previous || nearBottom) transcript.scrollTop = transcript.scrollHeight
  }

  private drawMessage(message: ChatMessage, text: ChatLabels): HTMLElement {
    if (message.author === 'system') {
      const row = div('row system')
      row.textContent = message.text
      return row
    }

    const mine = message.author === 'customer'
    const row = div(`row ${mine ? 'mine' : 'theirs'}`)
    const bubble = div(message.delivery === 'pending' ? 'bubble pending' : 'bubble')

    if (!mine && message.authorName) {
      const author = div('author')
      author.textContent = message.authorName
      bubble.append(author)
    }

    if (message.markdown) {
      const images: Record<string, string> = {}
      for (const attachment of message.attachments) {
        if (attachment.content_id && attachment.url) images[attachment.content_id] = attachment.url
      }
      const body = div('markdown')
      body.append(renderMarkdown(message.text, { images, onLink: (href) => this.chat.openLink(href) }))
      bubble.append(body)
    } else {
      const body = div('plain')
      body.textContent = message.text
      bubble.append(body)
    }

    // An inline picture is already drawn in the body; listing it again reads as two files.
    const files = message.attachments.filter((attachment) => !attachment.is_inline)
    if (files.length) {
      const list = div('files')
      for (const attachment of files) {
        const file = document.createElement('button')
        file.type = 'button'
        file.className = 'file'
        file.textContent = attachment.filename
        file.addEventListener('click', () => {
          if (/^https?:\/\//i.test(attachment.url)) this.chat.openLink(attachment.url)
        })
        list.append(file)
      }
      bubble.append(list)
    }
    row.append(bubble)

    if (message.delivery === 'pending') {
      const status = div('status')
      status.textContent = text.sending
      row.append(status)
    }
    if (message.delivery === 'failed') {
      const retry = document.createElement('button')
      retry.type = 'button'
      retry.className = 'status failed'
      retry.textContent = `${text.failed} ${text.retry}`
      retry.addEventListener('click', () => {
        if (message.clientMessageId) void this.chat.retry(message.clientMessageId).catch(() => undefined)
      })
      row.append(retry)
    }
    return row
  }
}

function div(className: string): HTMLDivElement {
  const element = document.createElement('div')
  element.className = className
  return element
}
