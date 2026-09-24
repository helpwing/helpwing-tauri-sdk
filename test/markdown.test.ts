// The same cases the RN SDK and the dashboard run, so the renderers stay in step.

import { describe, expect, it } from 'vitest'
import type { Block, Inline } from '../guest-js/markdown'
import { parseMarkdown, safeHref } from '../guest-js/markdown'

/** The rendered text of a tree, so a test can assert on words rather than on shape. */
function text(nodes: (Block | Inline)[]): string {
  return nodes
    .map(node => {
      if ('spans' in node) return text(node.spans)
      if ('blocks' in node) return text(node.blocks)
      if ('children' in node) return text(node.children)
      if (node.kind === 'list') return node.items.map(item => text(item)).join(' ')
      if (node.kind === 'break') return '\n'
      return 'text' in node ? node.text : ''
    })
    .join('')
}

describe('parseMarkdown', () => {
  it('renders nothing for an empty draft', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('   \n\n ')).toEqual([])
    expect(parseMarkdown(null)).toEqual([])
  })

  it('keeps a single newline as the break the agent typed', () => {
    const [paragraph] = parseMarkdown('Hi Rajiv,\nThanks for writing in.')
    expect(paragraph).toMatchObject({ kind: 'paragraph' })
    expect(paragraph && 'spans' in paragraph && paragraph.spans.map(span => span.kind)).toEqual([
      'text',
      'break',
      'text',
    ])
  })

  it('marks emphasis without eating the words around it', () => {
    const [paragraph] = parseMarkdown('**no mail is being held.** What we *can* do is enable a domain.')
    const spans = paragraph && 'spans' in paragraph ? paragraph.spans : []
    expect(spans[0]).toMatchObject({ kind: 'strong' })
    expect(text(spans)).toBe('no mail is being held. What we can do is enable a domain.')
    expect(spans.filter(span => span.kind === 'em')).toHaveLength(1)
  })

  it('leaves an underscore inside a word alone', () => {
    const [paragraph] = parseMarkdown('the field is body_text_html here')
    const spans = paragraph && 'spans' in paragraph ? paragraph.spans : []
    expect(spans.every(span => span.kind === 'text')).toBe(true)
  })

  it('reads both list markers, and the number a list starts at', () => {
    const bullets = parseMarkdown('- the From name is wrong\n- the footer is wrong')
    expect(bullets[0]).toMatchObject({ kind: 'list', ordered: false })
    expect(text(bullets)).toBe('the From name is wrong the footer is wrong')

    const [numbered] = parseMarkdown('2. The agreement\n3. Written confirmation')
    expect(numbered).toMatchObject({ kind: 'list', ordered: true, start: 2 })
  })

  it('nests a list under the item it was indented into', () => {
    const [list] = parseMarkdown('- outer\n  - inner\n- second')
    expect(list).toMatchObject({ kind: 'list' })
    if (!list || list.kind !== 'list') throw new Error('expected a list')
    expect(list.items).toHaveLength(2)
    expect(list.items[0]!.map(block => block.kind)).toEqual(['paragraph', 'list'])
  })

  it('reads headings, quotes, rules and fenced code', () => {
    const blocks = parseMarkdown('## On the review\n\n> quoted line\n\n---\n\n```json\n{"a": 1}\n```')
    expect(blocks.map(block => block.kind)).toEqual(['heading', 'quote', 'rule', 'code'])
    expect(blocks[0]).toMatchObject({ level: 2 })
    expect(blocks[3]).toMatchObject({ language: 'json', text: '{"a": 1}' })
  })

  it('does not read markers inside code as markers', () => {
    const [paragraph] = parseMarkdown('the domain is `quickbooks-enterprises.com` **and** it is blocked')
    const spans = paragraph && 'spans' in paragraph ? paragraph.spans : []
    expect(spans[1]).toEqual({ kind: 'code', text: 'quickbooks-enterprises.com' })
    expect(spans.some(span => span.kind === 'strong')).toBe(true)
  })

  it('links the brand use guide, and the bare address beside it', () => {
    const [paragraph] = parseMarkdown("I'd point you to the [brand use guide](https://quickbooks.intuit.com/help) instead.")
    const spans = paragraph && 'spans' in paragraph ? paragraph.spans : []
    expect(spans[1]).toMatchObject({ kind: 'link', href: 'https://quickbooks.intuit.com/help' })
    expect(text(spans)).toBe("I'd point you to the brand use guide instead.")

    const [bare] = parseMarkdown('One went to batkinson@occaps.com, a third party.')
    const bareSpans = bare && 'spans' in bare ? bare.spans : []
    expect(bareSpans.find(span => span.kind === 'link')).toBeUndefined() // Not a URL start.
  })

  it('autolinks a pasted URL and stops before the sentence does', () => {
    const [paragraph] = parseMarkdown('See https://helpwing.app/docs (the setup page).')
    const link = (paragraph && 'spans' in paragraph ? paragraph.spans : []).find(span => span.kind === 'link')
    expect(link).toMatchObject({ kind: 'link', href: 'https://helpwing.app/docs' })
  })

  it('reads a pipe table with its alignments', () => {
    const [table] = parseMarkdown('| Entity | Domain |\n| --- | ---: |\n| QB Enterprise | .com |')
    expect(table).toMatchObject({ kind: 'table' })
    if (!table || table.kind !== 'table') throw new Error('expected a table')
    expect(table.head.map(cell => text(cell.spans))).toEqual(['Entity', 'Domain'])
    expect(table.head[1]!.align).toBe('right')
    expect(table.rows).toHaveLength(1)
  })

  it('reads a picture pasted into an email as the file it arrived with', () => {
    const [paragraph] = parseMarkdown('![the zone file](cid:shot-1@northwind)')
    const spans = paragraph && 'spans' in paragraph ? paragraph.spans : []

    // A `cid:` names an attachment on this very message, never an address to fetch — the
    // renderer resolves it against what the API sent alongside. See `MessageBubble`.
    expect(spans[0]).toMatchObject({ kind: 'image', cid: 'shot-1@northwind', alt: 'the zone file' })
  })

  it('leaves a remote image as a link to it, because that is what a tracking pixel is', () => {
    const [paragraph] = parseMarkdown('![](https://tracker.example/open.gif)')
    const spans = paragraph && 'spans' in paragraph ? paragraph.spans : []

    expect(spans[0]).toMatchObject({ kind: 'link', href: 'https://tracker.example/open.gif' })
  })

  it('keeps an escaped marker as the character it is', () => {
    const [paragraph] = parseMarkdown('a literal \\*asterisk\\* stays')
    const spans = paragraph && 'spans' in paragraph ? paragraph.spans : []
    expect(text(spans)).toBe('a literal *asterisk* stays')
    expect(spans.some(span => span.kind === 'em')).toBe(false)
  })
})

describe('safeHref', () => {
  it('takes the schemes a support reply can legitimately point at', () => {
    expect(safeHref('https://helpwing.app')).toBe('https://helpwing.app')
    expect(safeHref('mailto:support@helpwing.app')).toBe('mailto:support@helpwing.app')
    expect(safeHref('support@helpwing.app')).toBe('mailto:support@helpwing.app')
    expect(safeHref('www.helpwing.app')).toBe('https://www.helpwing.app')
  })

  it('refuses anything a browser would run instead of visit', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('JavaScript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html;base64,PHNjcmlwdD4=')).toBeNull()
    expect(safeHref('')).toBeNull()
  })

  it('prints an unsafe link as the words it was made of', () => {
    const [paragraph] = parseMarkdown('[click me](javascript:alert(1))')
    const spans = paragraph && 'spans' in paragraph ? paragraph.spans : []
    expect(spans.some(span => span.kind === 'link')).toBe(false)
    expect(text(spans)).toContain('click me')
  })
})
