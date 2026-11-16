import { strFromU8, unzipSync } from 'fflate'
import { dataUri, escapeHtml, mimeForPath } from './html'
import { attr, elements, findAll, localName, parseXml, type XmlElement, type XmlNode } from './xml'

/**
 * ODT -> HTML: headings, paragraphs, bold / italic / underline / strike
 * (from automatic styles), nested lists, tables, links and embedded images.
 * Page layout, fonts and colours are not carried over.
 */

interface TextStyle {
  b?: boolean
  i?: boolean
  u?: boolean
  s?: boolean
  parent?: string
  /** Paragraph style that is a heading level (from `Heading_20_N`). */
  heading?: number
}

export function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes)
  } catch {
    throw new Error('The file is damaged or is not a valid document')
  }
}

function collectStyles(root: XmlElement, into: Map<string, TextStyle>, lists: Map<string, boolean>): void {
  for (const style of findAll(root, 'style')) {
    const name = attr(style, 'name')
    if (!name || localName(style.name) !== 'style') continue
    const props = elements(style).find((el) => localName(el.name) === 'text-properties')
    const info: TextStyle = { parent: attr(style, 'parent-style-name') }
    if (props) {
      if (attr(props, 'font-weight') === 'bold') info.b = true
      if (attr(props, 'font-style') === 'italic') info.i = true
      const underline = attr(props, 'text-underline-style')
      if (underline && underline !== 'none') info.u = true
      const strike = attr(props, 'text-line-through-style')
      if (strike && strike !== 'none') info.s = true
    }
    const heading = /^Heading_20_(\d)$/.exec(name) ?? /^Heading_20_(\d)$/.exec(info.parent ?? '')
    if (heading) info.heading = Number(heading[1])
    into.set(name, info)
  }
  for (const listStyle of findAll(root, 'list-style')) {
    const name = attr(listStyle, 'name')
    const first = elements(listStyle)[0]
    if (name && first) lists.set(name, localName(first.name) === 'list-level-style-number')
  }
}

export function odtToHtml(bytes: Uint8Array): string {
  const files = unzip(bytes)
  const content = files['content.xml']
  if (!content) throw new Error('This is not a valid ODT document')
  const doc = parseXml(strFromU8(content))
  const styles = new Map<string, TextStyle>()
  const lists = new Map<string, boolean>()
  if (files['styles.xml']) collectStyles(parseXml(strFromU8(files['styles.xml'])), styles, lists)
  collectStyles(doc, styles, lists)

  const resolveStyle = (name: string | undefined): TextStyle => {
    const out: TextStyle = {}
    const seen = new Set<string>()
    while (name && !seen.has(name)) {
      seen.add(name)
      const s = styles.get(name)
      if (!s) break
      out.b ??= s.b
      out.i ??= s.i
      out.u ??= s.u
      out.s ??= s.s
      out.heading ??= s.heading
      name = s.parent
    }
    return out
  }

  const inline = (nodes: XmlNode[]): string =>
    nodes
      .map((node) => {
        if (typeof node === 'string') return escapeHtml(node)
        switch (localName(node.name)) {
          case 's':
            return ' '.repeat(Number(attr(node, 'c') ?? 1))
          case 'tab':
            return '\t'
          case 'line-break':
            return '<br>'
          case 'span': {
            const s = resolveStyle(attr(node, 'style-name'))
            return wrap(inline(node.children), s)
          }
          case 'a':
            return `<a href="${escapeHtml(attr(node, 'href') ?? '')}">${inline(node.children)}</a>`
          case 'frame':
            return image(node)
          case 'note':
          case 'bookmark':
          case 'bookmark-start':
          case 'bookmark-end':
          case 'soft-page-break':
            return ''
          default:
            return inline(node.children)
        }
      })
      .join('')

  const image = (frame: XmlElement): string => {
    const img = findAll(frame, 'image')[0]
    const href = img ? attr(img, 'href') : undefined
    const data = href ? files[href] : undefined
    const mime = href ? mimeForPath(href) : undefined
    if (!data || !mime) return ''
    return `<img src="${dataUri(data, mime)}" alt="">`
  }

  const block = (el: XmlElement): string => {
    switch (localName(el.name)) {
      case 'h': {
        const level = Math.min(6, Math.max(1, Number(attr(el, 'outline-level') ?? 1)))
        return `<h${level}>${inline(el.children)}</h${level}>`
      }
      case 'p': {
        const s = resolveStyle(attr(el, 'style-name'))
        const html = inline(el.children)
        if (s.heading) return `<h${s.heading}>${html}</h${s.heading}>`
        // Paragraph-level bold/italic applies to the whole paragraph.
        return html.trim() ? `<p>${wrap(html, s)}</p>` : ''
      }
      case 'list': {
        const ordered = lists.get(attr(el, 'style-name') ?? '') ?? false
        const tag = ordered ? 'ol' : 'ul'
        const items = elements(el)
          .filter((item) => localName(item.name) === 'list-item' || localName(item.name) === 'list-header')
          .map((item) => `<li>${blocks(item).replace(/^<p>([\s\S]*?)<\/p>/, '$1')}</li>`)
        return `<${tag}>${items.join('')}</${tag}>`
      }
      case 'table': {
        const rows = findAll(el, 'table-row').map(
          (row) =>
            `<tr>${elements(row)
              .filter((cell) => localName(cell.name) === 'table-cell')
              .map((cell) => `<td>${blocks(cell)}</td>`)
              .join('')}</tr>`
        )
        return `<table><tbody>${rows.join('')}</tbody></table>`
      }
      case 'section':
      case 'index-body':
      case 'table-of-content':
        return blocks(el)
      default:
        return ''
    }
  }

  const blocks = (parent: XmlElement): string => elements(parent).map(block).filter(Boolean).join('\n')

  const text = findAll(doc, 'text').find((el) => el.name === 'office:text')
  if (!text) throw new Error('This ODT document has no text body')
  return blocks(text)
}

function wrap(html: string, s: TextStyle): string {
  if (!html) return html
  let out = html
  if (s.s) out = `<s>${out}</s>`
  if (s.u) out = `<u>${out}</u>`
  if (s.i) out = `<em>${out}</em>`
  if (s.b) out = `<strong>${out}</strong>`
  return out
}
