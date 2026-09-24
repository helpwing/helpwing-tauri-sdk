/** The chat's own chrome. No translations ship: pass your app's strings through `labels`. */
export interface ChatLabels {
  placeholder: string
  emailPlaceholder: string
  send: string
  sending: string
  failed: string
  retry: string
  offline: string
  online: string
  away: string
  typing: (name: string) => string
  branding: string
  loading: string
  unavailable: string
  /** The launcher button. */
  launcher: string
  close: string
}

export const DEFAULT_LABELS: ChatLabels = {
  placeholder: 'Write a message…',
  emailPlaceholder: 'Your email address',
  send: 'Send',
  sending: 'Sending…',
  failed: 'Not sent.',
  retry: 'Click to try again',
  offline: 'No connection. Your messages will be sent when it comes back.',
  online: 'We are online',
  away: 'We are away right now',
  typing: (name: string) => `${name} is typing…`,
  branding: 'Powered by Helpwing',
  loading: 'Loading…',
  unavailable: 'Support chat is not available right now.',
  launcher: 'Chat',
  close: 'Close',
}
