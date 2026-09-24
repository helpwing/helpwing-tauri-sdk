/** Markdown parsed into plain data; `elements/markdown.ts` draws it with DOM APIs. Kept in step with the RN SDK. */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'break' }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'strike'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] }
  /** A picture that came with the message, named by its attachment's `content_id`, never a URL. */
  | { kind: 'image'; cid: string; alt: string }

export type Align = 'left' | 'center' | 'right'

export interface Cell {
  spans: Inline[]
  align: Align
}

export type Block =
  | { kind: 'paragraph'; spans: Inline[] }
  | { kind: 'heading'; level: number; spans: Inline[] }
  | { kind: 'code'; language: string; text: string }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { kind: 'table'; head: Cell[]; rows: Cell[][] }
  | { kind: 'rule' }

const FENCE = /^ {0,3}(```|~~~)[ \t]*([^\s`]*)/
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/
const RULE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/
const QUOTE = /^ {0,3}>[ \t]?/
const ITEM = /^( *)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/
const DIVIDER = /^ {0,3}\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/

/** Schemes a link may carry. Anything else — `javascript:` above all — is not a link. */
const SAFE_HREF = /^(?:https?:\/\/|mailto:|tel:)[^\s]+$/i
const BARE_URL = /^(?:https?:\/\/|www\.)[^\s<>[\]()]*[^\s<>[\]().,;:!?'"]/i
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~>]/

const RUNS: { pattern: RegExp; kind: 'strong' | 'em' | 'strike'; wordish: boolean }[] = [
  { pattern: /^\*\*(\S|\S[\s\S]*?\S)\*\*/, kind: 'strong', wordish: false },
  { pattern: /^__(\S|\S[\s\S]*?\S)__/, kind: 'strong', wordish: true },
  { pattern: /^~~(\S|\S[\s\S]*?\S)~~/, kind: 'strike', wordish: false },
  { pattern: /^\*(\S|\S[\s\S]*?\S)\*/, kind: 'em', wordish: false },
  { pattern: /^_(\S|\S[\s\S]*?\S)_/, kind: 'em', wordish: true },
]

/** `![alt](src)` and `[label](href "title")` in one shape — see `image` below. */
const LINK = /^(!?)\[([^\][]*)\]\([ \t]*<?([^\s)]*)>?(?:[ \t]+"[^"]*")?[ \t]*\)/

/** The source of an image that came with the message. See the `image` span. */
const CID = /^cid:(\S+)$/i

/** A destination worth linking, or `null`. Bare hosts and addresses are promoted; code-like schemes are refused. */
export function safeHref(raw: string): string | null {
  const url = raw.trim()
  if (!url) return null
  if (SAFE_HREF.test(url)) return url
  if (EMAIL.test(url)) return `mailto:${url}`
  if (/^www\.[^\s]+$/i.test(url)) return `https://${url}`
  return null
}

/** A bare URL keeps its trailing bracket only when the text opened one. */
function trimUrl(url: string): string {
  let end = url.length
  while (end > 0 && url[end - 1] === ')') {
    const slice = url.slice(0, end)
    const opens = (slice.match(/\(/g) ?? []).length
    const closes = (slice.match(/\)/g) ?? []).length
    if (opens >= closes) break
    end--
  }
  return url.slice(0, end)
}

/** The spans of one paragraph, heading or cell. `linkable` is false inside a link's own label. */
function inline(source: string, linkable = true): Inline[] {
  const spans: Inline[] = []
  let plain = ''
  let index = 0

  const flush = () => {
    if (plain) spans.push({ kind: 'text', text: plain })
    plain = ''
  }

  while (index < source.length) {
    const char = source[index]!
    const rest = source.slice(index)
    const before = index > 0 ? source[index - 1]! : ''

    if (char === '\\' && ESCAPABLE.test(source[index + 1] ?? '')) {
      plain += source[index + 1]
      index += 2
      continue
    }

    if (char === '\n') {
      flush()
      spans.push({ kind: 'break' })
      index++
      continue
    }

    // Code first, and by longest run of backticks: everything inside it is literal,
    // which is the whole point of writing it.
    if (char === '`') {
      const code = /^(`+)([^`][\s\S]*?)\1(?!`)/.exec(rest)
      if (code) {
        flush()
        spans.push({ kind: 'code', text: code[2]!.replace(/\n/g, ' ').trim() })
        index += code[0].length
        continue
      }
    }

    if (char === '[' || char === '!') {
      const link = LINK.exec(rest)
      if (link && (char === '[' || link[1] === '!')) {
        const label = link[2] ?? ''
        const source = link[3] ?? ''
        const cid = link[1] === '!' ? CID.exec(source) : null
        const href = safeHref(source)
        flush()
        // A picture that came with the message is shown; a remote one becomes a link (tracking pixels).
        if (cid) spans.push({ kind: 'image', cid: cid[1]!, alt: label })
        else if (!href) spans.push(...inline(label, linkable))
        else if (link[1] === '!') spans.push({ kind: 'link', href, children: [{ kind: 'text', text: label || href }] })
        else spans.push({ kind: 'link', href, children: inline(label, false) })
        index += link[0].length
        continue
      }
    }

    if (char === '<') {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s>]+)>/i.exec(rest)
      if (auto) {
        const href = safeHref(auto[1]!)
        flush()
        if (href) spans.push({ kind: 'link', href, children: [{ kind: 'text', text: auto[1]! }] })
        else plain += auto[0]
        index += auto[0].length
        continue
      }
    }

    if (char === '*' || char === '_' || char === '~') {
      const run = RUNS.find(candidate => {
        if (!candidate.pattern.test(rest)) return false
        // `snake_case_name` is one word, not an emphasis: the underscore forms only
        // stand where a word boundary does. The asterisk forms have no such rule.
        if (!candidate.wordish) return true
        const match = candidate.pattern.exec(rest)!
        return !/\w/.test(before) && !/\w/.test(rest.slice(match[0].length, match[0].length + 1))
      })
      if (run) {
        const match = run.pattern.exec(rest)!
        flush()
        spans.push({ kind: run.kind, children: inline(match[1]!, linkable) })
        index += match[0].length
        continue
      }
    }

    if (linkable && (char === 'h' || char === 'w' || char === 'H' || char === 'W') && !/[\w@/.]/.test(before)) {
      const bare = BARE_URL.exec(rest)
      if (bare) {
        const text = trimUrl(bare[0])
        const href = safeHref(text)
        if (href) {
          flush()
          spans.push({ kind: 'link', href, children: [{ kind: 'text', text }] })
          index += text.length
          continue
        }
      }
    }

    plain += char
    index++
  }

  flush()
  return spans
}

const indentOf = (line: string) => line.length - line.trimStart().length

/** Whether a line starts something of its own, and so cannot continue a paragraph. */
function opensBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line)
}

function cells(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '')
  const out: string[] = []
  let current = ''
  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index]!
    if (char === '\\' && trimmed[index + 1] === '|') {
      current += '|'
      index++
      continue
    }
    if (char === '|') {
      out.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  out.push(current.trim())
  return out
}

function alignments(divider: string): Align[] {
  return cells(divider).map(cell => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return 'left'
  })
}

/** One list, from its first marker to the first line that is no longer part of it. */
function list(lines: string[], from: number): { block: Block; next: number } {
  const first = ITEM.exec(lines[from]!)!
  const ordered = /\d/.test(first[2]!)
  const indent = first[1]!.length
  const items: Block[][] = []
  let index = from

  while (index < lines.length) {
    const marker = ITEM.exec(lines[index]!)
    // A deeper marker belongs to the item above and is parsed with it; a shallower one,
    // or a switch between bullets and numbers, is a different list.
    if (!marker || marker[1]!.length !== indent || ordered !== /\d/.test(marker[2]!)) break

    const content = marker[1]!.length + marker[2]!.length + 1
    const item = [marker[3]!]
    index++

    while (index < lines.length) {
      const line = lines[index]!
      if (!line.trim()) {
        const after = lines[index + 1]
        if (!after?.trim() || (indentOf(after) < content && !ITEM.test(after))) break
        item.push('')
        index++
        continue
      }
      if (indentOf(line) >= content) {
        item.push(line.slice(content))
        index++
        continue
      }
      if (opensBlock(line)) break
      item.push(line.trim()) // A wrapped line still belongs to the item's paragraph.
      index++
    }

    items.push(parseBlocks(item))
  }

  const start = ordered ? Number.parseInt(first[2]!, 10) : 1
  return { block: { kind: 'list', ordered, start: Number.isFinite(start) ? start : 1, items }, next: index }
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]!

    if (!line.trim()) {
      index++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const closes = new RegExp(`^ {0,3}${fence[1]}[ \t]*$`)
      const body: string[] = []
      index++
      while (index < lines.length && !closes.test(lines[index]!)) body.push(lines[index++]!)
      index++ // The closing fence, or the end of the source when it was never written.
      blocks.push({ kind: 'code', language: fence[2] ?? '', text: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, spans: inline(heading[2]!) })
      index++
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      index++
      continue
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = []
      while (index < lines.length) {
        const next = lines[index]!
        if (QUOTE.test(next)) quoted.push(next.replace(QUOTE, ''))
        else if (next.trim() && !opensBlock(next)) quoted.push(next) // Wrapped, still quoted.
        else break
        index++
      }
      blocks.push({ kind: 'quote', blocks: parseBlocks(quoted) })
      continue
    }

    if (ITEM.test(line)) {
      const parsed = list(lines, index)
      blocks.push(parsed.block)
      index = parsed.next
      continue
    }

    const divider = lines[index + 1]
    if (line.includes('|') && divider && DIVIDER.test(divider) && divider.includes('-')) {
      const align = alignments(divider)
      const head = cells(line).map((cell, column) => ({ spans: inline(cell), align: align[column] ?? 'left' }))
      const rows: Cell[][] = []
      index += 2
      while (index < lines.length && lines[index]!.trim() && lines[index]!.includes('|')) {
        rows.push(cells(lines[index]!).map((cell, column) => ({ spans: inline(cell), align: align[column] ?? 'left' })))
        index++
      }
      blocks.push({ kind: 'table', head, rows })
      continue
    }

    const paragraph: string[] = [line]
    index++
    while (index < lines.length && lines[index]!.trim() && !opensBlock(lines[index]!)) paragraph.push(lines[index++]!)
    blocks.push({ kind: 'paragraph', spans: inline(paragraph.join('\n').trim()) })
  }

  return blocks
}

/** Markdown source as blocks. Empty source is no blocks, not an empty paragraph. */
export function parseMarkdown(source: string | null | undefined): Block[] {
  if (!source?.trim()) return []
  return parseBlocks(source.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'))
}
