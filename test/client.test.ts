import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatState } from '../guest-js/types'

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  handlers: [] as ((event: { payload: unknown }) => void)[],
  unlisten: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: ipc.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_event: string, handler: (event: { payload: unknown }) => void) => {
    ipc.handlers.push(handler)
    return ipc.unlisten
  }),
}))

import { HelpwingChat, INITIAL_STATE, STATE_EVENT } from '../guest-js/client'
import { listen } from '@tauri-apps/api/event'

function state(overrides: Partial<ChatState> = {}): ChatState {
  return { ...INITIAL_STATE, ...overrides }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function emit(payload: ChatState): void {
  for (const handler of ipc.handlers) handler({ payload })
}

beforeEach(() => {
  ipc.invoke.mockReset()
  ipc.invoke.mockImplementation(async (command: string) =>
    command === 'plugin:helpwing|state' ? state({ status: 'ready' }) : undefined,
  )
  ipc.handlers.length = 0
  ipc.unlisten.mockReset()
})

afterEach(() => {
  HelpwingChat.shared().destroy()
})

describe('HelpwingChat', () => {
  it('listens for the plugin event and syncs the current state once', async () => {
    const chat = new HelpwingChat()
    const seen: string[] = []
    chat.subscribe((next) => seen.push(next.status))
    await flush()

    expect(listen).toHaveBeenCalledWith(STATE_EVENT, expect.any(Function))
    expect(ipc.invoke).toHaveBeenCalledWith('plugin:helpwing|state')
    expect(seen).toEqual(['idle', 'ready'])

    emit(state({ status: 'ready', unreadCount: 3 }))
    expect(chat.state.unreadCount).toBe(3)
    chat.destroy()
  })

  it('does not let a stale snapshot overwrite an event that arrived first', async () => {
    let answer: (value: ChatState) => void = () => undefined
    ipc.invoke.mockImplementation((command: string) =>
      command === 'plugin:helpwing|state' ? new Promise((resolve) => (answer = resolve)) : Promise.resolve(),
    )
    const chat = new HelpwingChat()
    chat.subscribe(() => undefined)
    await flush()

    emit(state({ status: 'ready', unreadCount: 2 }))
    answer(state({ status: 'loading' }))
    await flush()

    expect(chat.state.status).toBe('ready')
    expect(chat.state.unreadCount).toBe(2)
    chat.destroy()
  })

  it('starts with the webview locale and timezone unless given others', async () => {
    const chat = new HelpwingChat()
    await chat.start()
    expect(ipc.invoke).toHaveBeenCalledWith('plugin:helpwing|start', {
      locale: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })

    await chat.start({ locale: 'ru-RU', timezone: 'Europe/Moscow' })
    expect(ipc.invoke).toHaveBeenLastCalledWith('plugin:helpwing|start', { locale: 'ru-RU', timezone: 'Europe/Moscow' })

    ipc.invoke.mockClear()
    await chat.ensureStarted()
    expect(ipc.invoke).not.toHaveBeenCalledWith('plugin:helpwing|start', expect.anything())
    chat.destroy()
  })

  it('names each command and its arguments the way the plugin reads them', async () => {
    const chat = new HelpwingChat()
    await chat.send('Hello', { email: 'ann@example.com' })
    await chat.send('Again')
    await chat.retry('client-id-0000000001')
    await chat.identify({ id: '42', userHash: 'abc' })
    await chat.identify(null)
    await chat.refresh()
    await chat.markRead()
    await chat.reset()

    expect(ipc.invoke.mock.calls).toEqual([
      ['plugin:helpwing|send', { text: 'Hello', email: 'ann@example.com' }],
      ['plugin:helpwing|send', { text: 'Again', email: null }],
      ['plugin:helpwing|retry', { clientMessageId: 'client-id-0000000001' }],
      ['plugin:helpwing|identify', { identity: { id: '42', userHash: 'abc' } }],
      ['plugin:helpwing|identify', { identity: null }],
      ['plugin:helpwing|refresh'],
      ['plugin:helpwing|mark_read'],
      ['plugin:helpwing|reset'],
    ])
    chat.destroy()
  })

  it('counts presence claims, so two open chats stay present until both close', () => {
    const chat = new HelpwingChat()
    const first = chat.claimPresence()
    const second = chat.claimPresence()
    first()
    first()
    expect(ipc.invoke.mock.calls.filter(([command]) => command === 'plugin:helpwing|set_present')).toEqual([
      ['plugin:helpwing|set_present', { present: true }],
    ])
    second()
    expect(ipc.invoke).toHaveBeenLastCalledWith('plugin:helpwing|set_present', { present: false })
    chat.destroy()
  })

  it('follows the page visibility once started', async () => {
    const chat = new HelpwingChat()
    await chat.start()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(ipc.invoke).toHaveBeenLastCalledWith('plugin:helpwing|set_active', { active: false })

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(ipc.invoke).toHaveBeenLastCalledWith('plugin:helpwing|set_active', { active: true })

    chat.destroy()
    ipc.invoke.mockClear()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(ipc.invoke).not.toHaveBeenCalled()
  })

  it('opens links through the plugin, or through an opener the app provides', () => {
    const chat = new HelpwingChat()
    chat.openLink('https://helpwing.app')
    expect(ipc.invoke).toHaveBeenLastCalledWith('plugin:helpwing|open_link', { url: 'https://helpwing.app' })

    const opener = vi.fn()
    chat.setLinkOpener(opener)
    chat.openLink('mailto:support@helpwing.app')
    expect(opener).toHaveBeenCalledWith('mailto:support@helpwing.app')
    chat.destroy()
  })

  it('stops listening when destroyed', async () => {
    const chat = new HelpwingChat()
    chat.subscribe(() => undefined)
    await flush()
    chat.destroy()
    await flush()
    expect(ipc.unlisten).toHaveBeenCalled()
  })

  it('shares one client per webview', () => {
    expect(HelpwingChat.shared()).toBe(HelpwingChat.shared())
  })
})
