/** Shapes the plugin emits. `WidgetConfig` and `ApiAttachment` are the server's, untouched. */

/** `GET /widget/{public_key}/config/`. Optional fields are absent on older servers. */
export interface WidgetConfig {
  is_enabled: boolean
  project_name: string
  accent_color: string
  /** Resolved against the webview's `prefers-color-scheme` when `system`. */
  color_scheme?: 'system' | 'light' | 'dark'
  launcher_icon: string
  launcher_icon_url: string
  launcher_position: string
  logo_url: string
  show_branding: boolean
  /** Blank when the project wrote no heading of its own. */
  title?: string
  greeting: string
  offline_message: string
  /** Shown while an agent is typing. May contain `{name}`. Blank when the project wrote none. */
  typing_text?: string
  /** Per-language title, greeting, offline message and typing text, keyed by language code. */
  translations?: Record<string, Record<string, string>>
  default_locale?: string
  require_email: boolean
  show_agent_availability: boolean
  show_on_desktop: boolean
  show_on_mobile: boolean
  identity_verification_enabled: boolean
  is_online: boolean
  /** Reported as `unconfigured` while closed. */
  hide_when_closed?: boolean
}

export interface ApiAttachment {
  id: string
  filename: string
  content_type: string
  size_bytes: number
  url: string
  /** Drawn in the body where it was written, not in the file list. */
  is_inline: boolean
  /** What the body points at with `![name](cid:...)`. */
  content_id: string
}

export interface Identity {
  /** Your own user id. At most 120 characters. */
  id?: string
  email?: string
  /** At most 150 characters. */
  name?: string
  metadata?: Record<string, string | number | boolean>
  /** Hex HMAC-SHA256 of `id` keyed with the identity secret. Computed on your server, never in the app. */
  userHash?: string
}

export interface ChatMessage {
  /** The server's id once there is one, the client id until then. */
  id: string
  author: 'agent' | 'customer' | 'system'
  authorName: string
  authorAvatarUrl: string
  text: string
  /** Whether `text` is markdown. */
  markdown: boolean
  attachments: ApiAttachment[]
  createdAt: string
  delivery: 'pending' | 'sent' | 'failed'
  /** The id this client made up, kept so a retry is recognised as the same message. */
  clientMessageId?: string
}

export interface ChatState {
  /** `unconfigured`: no support surface right now (widget off, or hidden outside hours). */
  status: 'idle' | 'loading' | 'ready' | 'unconfigured' | 'error'
  config: WidgetConfig | null
  conversation: { ticketId: string; ticketReference: string; status: string; subject: string } | null
  messages: ChatMessage[]
  typing: { name: string } | null
  /** Agent messages since the visitor last had the chat open. */
  unreadCount: number
  /** True between a failed request and the next one that works. */
  offline: boolean
  /** The last thing that went wrong, in words a person could be shown. */
  error: string | null
}
