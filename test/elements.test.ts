import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }))

import { INITIAL_STATE, type SupportClient } from '../guest-js/client'
import { defineHelpwingElements } from '../guest-js/elements/define'
import type { HelpwingChatElement } from '../guest-js/elements/chat'
import type { HelpwingLauncherElement } from '../guest-js/elements/launcher'
import type { ChatMessage, ChatState, WidgetConfig } from '../guest-js/types'

const CONFIG: WidgetConfig = {
  is_enabled: true,
  project_name: 'Acme Cloud',
  accent_color: '#2563eb',
  color_scheme: 'light',
  launcher_icon: 'chat',
  launcher_icon_url: '',
  launcher_position: 'bottom_right',
  logo_url: '',
  show_branding: true,
  title: '',
  greeting: 'Hi! How can we help?',
  offline_message: 'We are offline right now.',
  translations: { ru: { greeting: 'Здравствуйте!' } },
  require_email: false,
  show_agent_availability: true,
  show_on_desktop: true,
  show_on_mobile: true,
  identity_verification_enabled: false,
  is_online: true,
}

/** A client with no plugin behind it: state is pushed by the test. */
class FakeChat implements SupportClient {
  state: ChatState = INITIAL_STATE
  presence = 0
  listeners = new Set<(state: ChatState) => void>()
  send = vi.fn(async (_text: string, _options?: { email?: string }) => undefined)
  retry = vi.fn(async (_id: string) => undefined)
  openLink = vi.fn((_href: string) => undefined)
  ensureStarted = vi.fn(async () => undefined)

  subscribe(listener: (state: ChatState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  claimPresence(): () => void {
    this.presence++
    return () => {
      this.presence--
    }
  }

  push(overrides: Partial<ChatState>): void {
    this.state = { ...this.state, ...overrides }
    for (const listener of this.listeners) listener(this.state)
  }
}

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    author: 'agent',
    authorName: 'Dana',
    authorAvatarUrl: '',
    text: 'Hello',
    markdown: true,
    attachments: [],
    createdAt: '2026-01-01T00:00:00Z',
    delivery: 'sent',
    ...overrides,
  }
}

function mountChat(chat: FakeChat): HelpwingChatElement {
  const element = document.createElement('helpwing-chat')
  element.chat = chat
  document.body.append(element)
  return element
}

const shadow = (element: Element) => element.shadowRoot as ShadowRoot

beforeAll(() => defineHelpwingElements())
beforeEach(() => {
  document.body.replaceChildren()
})

describe('<helpwing-chat>', () => {
  it('shows loading, then the greeting, and claims presence while connected', () => {
    const chat = new FakeChat()
    const element = mountChat(chat)
    expect(shadow(element).querySelector('.centre')?.textContent).toBe('Loading…')
    expect(chat.presence).toBe(1)
    expect(chat.ensureStarted).toHaveBeenCalled()

    chat.push({ status: 'ready', config: CONFIG })
    expect(shadow(element).querySelector('.greeting')?.textContent).toBe('Hi! How can we help?')
    expect(shadow(element).querySelector('.availability')?.textContent).toBe('We are online')

    element.remove()
    expect(chat.presence).toBe(0)
    expect(chat.listeners.size).toBe(0)
  })

  it('greets in the locale it is given, and shows the offline message when closed', () => {
    const chat = new FakeChat()
    const element = mountChat(chat)
    element.setAttribute('locale', 'ru-RU')
    chat.push({ status: 'ready', config: CONFIG })
    expect(shadow(element).querySelector('.greeting')?.textContent).toBe('Здравствуйте!')

    chat.push({ config: { ...CONFIG, is_online: false } })
    expect(shadow(element).querySelector('.greeting')?.textContent).toBe('We are offline right now.')
  })

  it('says the chat is unavailable when the project has none right now', () => {
    const chat = new FakeChat()
    const element = mountChat(chat)
    chat.push({ status: 'unconfigured', config: CONFIG })
    expect(shadow(element).querySelector('.centre')?.textContent).toBe('Support chat is not available right now.')
    expect((shadow(element).querySelector('.root') as HTMLElement).hidden).toBe(true)
  })

  it('renders markdown as elements and never as markup', () => {
    const chat = new FakeChat()
    const element = mountChat(chat)
    chat.push({
      status: 'ready',
      config: CONFIG,
      messages: [message({ text: '**Bold** <img src=x onerror=alert(1)> [bad](javascript:alert(1)) [ok](https://helpwing.app)' })],
    })
    const bubble = shadow(element).querySelector('.bubble') as HTMLElement
    expect(bubble.querySelector('strong')?.textContent).toBe('Bold')
    expect(bubble.querySelector('img')).toBeNull()
    expect(bubble.textContent).toContain('<img src=x onerror=alert(1)>')
    const links = [...bubble.querySelectorAll('a')]
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['https://helpwing.app'])

    links[0]!.click()
    expect(chat.openLink).toHaveBeenCalledWith('https://helpwing.app')
  })

  it('draws a picture written into the body and leaves it out of the file list', () => {
    const chat = new FakeChat()
    const element = mountChat(chat)
    chat.push({
      status: 'ready',
      config: CONFIG,
      messages: [
        message({
          text: '![zone](cid:shot-1) and ![gone](cid:missing)',
          attachments: [
            { id: 'a1', filename: 'shot.png', content_type: 'image/png', size_bytes: 1, url: 'https://files.example/shot.png', is_inline: true, content_id: 'shot-1' },
            { id: 'a2', filename: 'invoice.pdf', content_type: 'application/pdf', size_bytes: 1, url: 'https://files.example/invoice.pdf', is_inline: false, content_id: '' },
          ],
        }),
      ],
    })
    const bubble = shadow(element).querySelector('.bubble') as HTMLElement
    expect(bubble.querySelector('img')?.getAttribute('src')).toBe('https://files.example/shot.png')
    expect(bubble.textContent).toContain('gone')
    expect([...bubble.querySelectorAll('.file')].map((file) => file.textContent)).toEqual(['invoice.pdf'])
  })

  it('offers a retry on a failed message and marks a pending one', () => {
    const chat = new FakeChat()
    const element = mountChat(chat)
    chat.push({
      status: 'ready',
      config: CONFIG,
      messages: [
        message({ id: 'c1', author: 'customer', delivery: 'failed', clientMessageId: 'client-1' }),
        message({ id: 'c2', author: 'customer', delivery: 'pending', clientMessageId: 'client-2', createdAt: '2026-01-01T00:00:01Z' }),
      ],
    })
    const statuses = [...shadow(element).querySelectorAll('.status')].map((status) => status.textContent)
    expect(statuses).toEqual(['Not sent. Click to try again', 'Sending…'])
    ;(shadow(element).querySelector('.status.failed') as HTMLButtonElement).click()
    expect(chat.retry).toHaveBeenCalledWith('client-1')
  })

  it('sends from the composer, asking for an email only before a conversation exists', () => {
    const chat = new FakeChat()
    const element = mountChat(chat)
    chat.push({ status: 'ready', config: { ...CONFIG, require_email: true } })
    const root = shadow(element)
    const input = root.querySelector('textarea') as HTMLTextAreaElement
    const email = root.querySelector('input[type=email]') as HTMLInputElement
    const send = root.querySelector('.composer button') as HTMLButtonElement

    expect(email.hidden).toBe(false)
    input.value = 'Help please'
    input.dispatchEvent(new Event('input'))
    expect(send.disabled).toBe(true)

    email.value = 'ann@example.com'
    email.dispatchEvent(new Event('input'))
    expect(send.disabled).toBe(false)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(chat.send).toHaveBeenCalledWith('Help please', { email: 'ann@example.com' })
    expect(input.value).toBe('')

    chat.push({ conversation: { ticketId: 't', ticketReference: 'T-1', status: 'open', subject: '' } })
    expect(email.hidden).toBe(true)
  })

  it('uses the labels it is given', () => {
    const chat = new FakeChat()
    const element = mountChat(chat)
    element.labels = { send: 'Envoyer', placeholder: 'Écrivez…' }
    chat.push({ status: 'ready', config: CONFIG, offline: true })
    expect(shadow(element).querySelector('.composer button')?.textContent).toBe('Envoyer')
    expect((shadow(element).querySelector('textarea') as HTMLTextAreaElement).placeholder).toBe('Écrivez…')
    expect((shadow(element).querySelector('.banner') as HTMLElement).hidden).toBe(false)
  })

  it('themes itself from the project accent, with overrides on top', () => {
    const chat = new FakeChat()
    const element = mountChat(chat)
    element.theme = { background: '#0a0a0b' }
    chat.push({ status: 'ready', config: { ...CONFIG, accent_color: '#c6ff3a' } })
    const frame = shadow(element).querySelector('.frame') as HTMLElement
    expect(frame.style.getPropertyValue('--hw-accent')).toBe('#c6ff3a')
    expect(frame.style.getPropertyValue('--hw-on-accent')).toBe('#101828')
    expect(frame.style.getPropertyValue('--hw-background')).toBe('#0a0a0b')
  })
})

describe('<helpwing-launcher>', () => {
  function mountLauncher(chat: FakeChat): HelpwingLauncherElement {
    const element = document.createElement('helpwing-launcher')
    element.chat = chat
    document.body.append(element)
    return element
  }

  it('stays hidden until the chat is ready, then shows the unread badge', () => {
    const chat = new FakeChat()
    const launcher = mountLauncher(chat)
    const anchor = shadow(launcher).querySelector('.anchor') as HTMLElement
    expect(anchor.hidden).toBe(true)

    chat.push({ status: 'ready', config: CONFIG, unreadCount: 12 })
    expect(anchor.hidden).toBe(false)
    expect(shadow(launcher).querySelector('.badge')?.textContent).toBe('9+')

    chat.push({ config: { ...CONFIG, show_on_desktop: false } })
    expect(anchor.hidden).toBe(true)
  })

  it('opens a panel with the chat in it, and closing it releases presence', () => {
    const chat = new FakeChat()
    const launcher = mountLauncher(chat)
    chat.push({ status: 'ready', config: { ...CONFIG, launcher_position: 'bottom_left' } })
    ;(shadow(launcher).querySelector('.button') as HTMLButtonElement).click()

    expect(launcher.isOpen).toBe(true)
    expect(chat.presence).toBe(1)
    expect(shadow(launcher).querySelector('helpwing-chat')).not.toBeNull()
    expect(shadow(launcher).querySelector('.title')?.textContent).toBe('Acme Cloud')
    expect((shadow(launcher).querySelector('.panel') as HTMLElement).style.left).toBe('24px')

    ;(shadow(launcher).querySelector('.close') as HTMLButtonElement).click()
    expect(launcher.isOpen).toBe(false)
    expect(chat.presence).toBe(0)
  })
})
