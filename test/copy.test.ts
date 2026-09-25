import { describe, expect, it } from 'vitest'

import { Copy } from '../guest-js/copy'
import type { WidgetConfig } from '../guest-js/types'

function config(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    is_enabled: true,
    project_name: 'Acme Cloud',
    accent_color: '#2563eb',
    launcher_icon: 'chat',
    launcher_icon_url: '',
    launcher_position: 'bottom_right',
    logo_url: '',
    show_branding: true,
    greeting: 'Hi! How can we help?',
    offline_message: 'We are offline right now.',
    require_email: true,
    show_agent_availability: true,
    show_on_desktop: true,
    show_on_mobile: true,
    identity_verification_enabled: false,
    is_online: true,
    ...overrides,
  }
}

const TRANSLATED = config({
  translations: { ru: { greeting: 'Здравствуйте! Чем можем помочь?', typing_text: '{name} печатает…' } },
})

describe('Copy.forLocale', () => {
  it('returns the translation the project wrote for that language', () => {
    expect(Copy.forLocale(TRANSLATED, 'greeting', 'ru')).toBe('Здравствуйте! Чем можем помочь?')
  })

  it('matches a device tag loosely, so ru-RU finds ru', () => {
    expect(Copy.forLocale(TRANSLATED, 'greeting', 'ru-RU')).toBe('Здравствуйте! Чем можем помочь?')
  })

  it('keeps the project’s own words when that language has no translation', () => {
    // Not a stock line of ours: the project did write a greeting, and replacing something
    // they wrote with something they did not is worse than showing the wrong language.
    expect(Copy.forLocale(TRANSLATED, 'greeting', 'de')).toBe('Hi! How can we help?')
    expect(Copy.forLocale(TRANSLATED, 'offline_message', 'ru')).toBe('We are offline right now.')
  })

  it('falls back when no locale is given at all', () => {
    expect(Copy.forLocale(TRANSLATED, 'greeting')).toBe('Hi! How can we help?')
  })

  it('reads a server older than the setting as having no translations', () => {
    expect(Copy.forLocale(config(), 'greeting', 'ru')).toBe('Hi! How can we help?')
  })

  it('is empty before the config has arrived, rather than throwing', () => {
    expect(Copy.forLocale(null, 'greeting', 'ru')).toBe('')
  })

  it('resolves typing_text the same way, blank when the project wrote none', () => {
    expect(Copy.forLocale(TRANSLATED, 'typing_text', 'ru')).toBe('{name} печатает…')
    expect(Copy.forLocale(TRANSLATED, 'typing_text', 'de')).toBe('')
    expect(Copy.forLocale(config(), 'typing_text', 'ru')).toBe('')
  })
})

describe('Copy.match', () => {
  it.each([
    ['ru', ['ru', 'en'], 'ru'],
    ['ru-RU', ['ru'], 'ru'],
    ['ru_RU', ['ru'], 'ru'],
    ['RU', ['ru'], 'ru'],
    ['pt-BR', ['pt'], 'pt'],
    ['pt-BR', ['pt-br', 'pt'], 'pt-br'], // an exact tag beats its primary subtag
    ['de', ['ru', 'en'], ''],
    ['', ['ru'], ''],
    [undefined, ['ru'], ''],
  ])('%s against %s → %s', (locale, available, expected) => {
    expect(Copy.match(locale, available)).toBe(expected)
  })
})
