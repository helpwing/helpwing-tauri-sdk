import type { WidgetConfig } from './types.js'

/** The project's own words (title, greeting, offline message) in the reader's language. */
export class Copy {
  /** The translation for `locale`, else what the project wrote without one. Never a stock line. */
  static forLocale(
    config: WidgetConfig | null,
    field: 'title' | 'greeting' | 'offline_message',
    locale?: string,
  ): string {
    if (!config) return ''
    const translations = config.translations ?? {}
    const matched = Copy.match(locale, Object.keys(translations))
    return (matched ? translations[matched]?.[field] : '') || config[field] || ''
  }

  /** The available tag `locale` asks for, falling back from `pt-BR` to `pt`. */
  static match(locale: string | undefined, available: string[]): string {
    const tag = String(locale ?? '')
      .trim()
      .replace(/_/g, '-')
      .toLowerCase()
    if (!tag) return ''
    if (available.includes(tag)) return tag
    const primary = tag.split('-')[0] as string
    return available.includes(primary) ? primary : ''
  }
}
