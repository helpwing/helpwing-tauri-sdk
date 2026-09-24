import { parseMarkdown, type Block, type Cell, type Inline } from '../markdown.js'

export interface MarkdownOptions {
  /** `content_id` → URL of the message's own attachments. Only these pictures can be drawn. */
  images?: Record<string, string>
  onLink: (href: string) => void
}

/** Markdown drawn with DOM APIs only: nothing anybody typed can become markup. */
export function renderMarkdown(source: string, options: MarkdownOptions): DocumentFragment {
  const fragment = document.createDocumentFragment()
  for (const block of parseMarkdown(source)) fragment.append(renderBlock(block, options))
  return fragment
}

function renderBlock(block: Block, options: MarkdownOptions): Node {
  switch (block.kind) {
    case 'paragraph':
      return withSpans(document.createElement('p'), block.spans, options)
    case 'heading': {
      const level = Math.min(6, Math.max(1, block.level))
      return withSpans(document.createElement(`h${level}`), block.spans, options)
    }
    case 'code': {
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      code.textContent = block.text
      if (block.language) code.dataset.language = block.language
      pre.append(code)
      return pre
    }
    case 'quote': {
      const quote = document.createElement('blockquote')
      for (const child of block.blocks) quote.append(renderBlock(child, options))
      return quote
    }
    case 'list': {
      const list = document.createElement(block.ordered ? 'ol' : 'ul')
      if (block.ordered && block.start !== 1) list.setAttribute('start', String(block.start))
      for (const item of block.items) {
        const li = document.createElement('li')
        for (const child of item) li.append(renderBlock(child, options))
        list.append(li)
      }
      return list
    }
    case 'table': {
      const wrapper = document.createElement('div')
      wrapper.className = 'table'
      const table = document.createElement('table')
      const head = document.createElement('thead')
      head.append(row(block.head, 'th', options))
      const body = document.createElement('tbody')
      for (const cells of block.rows) body.append(row(cells, 'td', options))
      table.append(head, body)
      wrapper.append(table)
      return wrapper
    }
    case 'rule':
      return document.createElement('hr')
  }
}

function row(cells: Cell[], tag: 'th' | 'td', options: MarkdownOptions): HTMLTableRowElement {
  const tr = document.createElement('tr')
  for (const cell of cells) {
    const element = withSpans(document.createElement(tag), cell.spans, options)
    element.style.textAlign = cell.align
    tr.append(element)
  }
  return tr
}

function withSpans<T extends HTMLElement>(element: T, spans: Inline[], options: MarkdownOptions): T {
  for (const span of spans) element.append(renderInline(span, options))
  return element
}

function renderInline(span: Inline, options: MarkdownOptions): Node {
  switch (span.kind) {
    case 'text':
      return document.createTextNode(span.text)
    case 'break':
      return document.createElement('br')
    case 'code': {
      const code = document.createElement('code')
      code.textContent = span.text
      return code
    }
    case 'strong':
      return withSpans(document.createElement('strong'), span.children, options)
    case 'em':
      return withSpans(document.createElement('em'), span.children, options)
    case 'strike':
      return withSpans(document.createElement('s'), span.children, options)
    case 'link': {
      // The parser only emits http(s), mailto and tel; the plugin checks again before opening.
      const link = withSpans(document.createElement('a'), span.children, options)
      link.setAttribute('href', span.href)
      link.setAttribute('rel', 'noopener noreferrer')
      link.addEventListener('click', (event) => {
        event.preventDefault()
        options.onLink(span.href)
      })
      return link
    }
    case 'image': {
      const url = options.images?.[span.cid]
      // A cid with no file behind it reads as its alt text, as a mail client shows it.
      if (!url || !/^https?:\/\//i.test(url)) return document.createTextNode(span.alt)
      const image = document.createElement('img')
      image.setAttribute('src', url)
      image.setAttribute('alt', span.alt)
      return image
    }
  }
}
