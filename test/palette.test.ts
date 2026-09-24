import { describe, expect, it } from 'vitest'

import { resolveDark, resolveTheme } from '../guest-js/elements/theme'
import { Palette } from '../guest-js/palette'
import type { WidgetConfig } from '../guest-js/types'

describe('Palette', () => {
  it('puts ink on a light accent and white on a dark one', () => {
    expect(Palette.readableOn('#c6ff3a')).toBe('#101828')
    expect(Palette.readableOn('#2563eb')).toBe('#ffffff')
    expect(Palette.readableOn('#fff')).toBe('#101828')
  })

  it('falls back to the default accent for anything that is not a colour', () => {
    expect(Palette.forAccent('not-a-colour').accent).toBe(Palette.DEFAULT_ACCENT)
    expect(Palette.forAccent(undefined).accent).toBe(Palette.DEFAULT_ACCENT)
  })

  it('has a dark palette', () => {
    expect(Palette.forAccent('#2563eb', true).background).toBe('#0b0f19')
    expect(Palette.forAccent('#2563eb', false).background).toBe('#ffffff')
  })
})

describe('resolveDark', () => {
  const config = (color_scheme?: WidgetConfig['color_scheme']) => ({ color_scheme }) as WidgetConfig

  it('lets the app overrule the project', () => {
    expect(resolveDark(config('light'), true)).toBe(true)
    expect(resolveDark(config('dark'), false)).toBe(false)
  })

  it('follows the project when the app says nothing', () => {
    expect(resolveDark(config('dark'), undefined)).toBe(true)
    expect(resolveDark(config('light'), undefined)).toBe(false)
  })

  it('applies theme overrides on top of the derived palette', () => {
    const theme = resolveTheme({ accent_color: '#c6ff3a' } as WidgetConfig, true, { background: '#000000', fontFamily: 'Fira Sans' })
    expect(theme.accent).toBe('#c6ff3a')
    expect(theme.background).toBe('#000000')
    expect(theme.surface).toBe('#1a2032')
    expect(theme.fontFamily).toBe('Fira Sans')
  })
})
