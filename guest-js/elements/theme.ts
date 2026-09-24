import { Palette, type Theme } from '../palette.js'
import type { WidgetConfig } from '../types.js'

/** `dark` overrules the project, whose `system` (the default) follows the webview. */
export function resolveDark(config: WidgetConfig | null, dark: boolean | undefined): boolean {
  if (dark !== undefined) return dark
  if (config?.color_scheme === 'dark') return true
  if (config?.color_scheme === 'light') return false
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(config: WidgetConfig | null, dark: boolean | undefined, override?: Partial<Theme>): Theme {
  return { ...Palette.forAccent(config?.accent_color, resolveDark(config, dark)), ...(override ?? {}) }
}

/** Publishes the theme as the `--hw-*` custom properties the stylesheets read. */
export function applyTheme(target: HTMLElement, theme: Theme): void {
  const vars: Record<string, string> = {
    '--hw-accent': theme.accent,
    '--hw-on-accent': theme.onAccent,
    '--hw-background': theme.background,
    '--hw-surface': theme.surface,
    '--hw-border': theme.border,
    '--hw-text': theme.text,
    '--hw-muted': theme.mutedText,
    '--hw-danger': theme.danger,
    '--hw-font': theme.fontFamily ?? 'inherit',
  }
  for (const [name, value] of Object.entries(vars)) target.style.setProperty(name, value)
}

/** `dark` attribute: absent → undefined, `"false"` → false, anything else → true. */
export function booleanAttribute(value: string | null): boolean | undefined {
  if (value === null) return undefined
  return value !== 'false'
}

/** `HTMLElement`, or a stand-in where there is no DOM, so importing never throws. */
export const ElementBase: typeof HTMLElement =
  typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as unknown as typeof HTMLElement)
