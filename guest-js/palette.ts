/** The colours the chat draws with, all derived from the project's one accent. */
export interface Theme {
  accent: string
  onAccent: string
  background: string
  surface: string
  border: string
  text: string
  mutedText: string
  danger: string
  /** A CSS `font-family` value. Left out, the elements inherit the page's. */
  fontFamily?: string
}

export class Palette {
  static readonly DEFAULT_ACCENT = '#2563eb'

  static forAccent(accent: string | undefined, dark = false): Theme {
    const chosen = Palette.isColor(accent) ? (accent as string) : Palette.DEFAULT_ACCENT
    return dark
      ? {
          accent: chosen,
          onAccent: Palette.readableOn(chosen),
          background: '#0b0f19',
          surface: '#1a2032',
          border: '#2a3346',
          text: '#f4f6fb',
          mutedText: '#98a2b3',
          danger: '#f97066',
        }
      : {
          accent: chosen,
          onAccent: Palette.readableOn(chosen),
          background: '#ffffff',
          surface: '#f2f4f7',
          border: '#e4e7ec',
          text: '#101828',
          mutedText: '#667085',
          danger: '#d92d20',
        }
  }

  /** White or ink, whichever stays readable on `color` (by relative luminance, as `widget.js` does). */
  static readableOn(color: string): string {
    const hex = Palette.expand(color)
    if (!hex) return '#ffffff'
    const channels = [0, 2, 4].map((index) => {
      const value = parseInt(hex.substr(index, 2), 16) / 255
      return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
    })
    const luminance =
      0.2126 * (channels[0] as number) + 0.7152 * (channels[1] as number) + 0.0722 * (channels[2] as number)
    return luminance > 0.55 ? '#101828' : '#ffffff'
  }

  private static isColor(value: string | undefined): boolean {
    return Boolean(value && Palette.expand(value))
  }

  private static expand(color: string): string | null {
    let hex = String(color || '').replace('#', '')
    if (hex.length === 3) {
      hex = `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
    }
    return /^[0-9a-f]{6}$/i.test(hex) ? hex : null
  }
}
