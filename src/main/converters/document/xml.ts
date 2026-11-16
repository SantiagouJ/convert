/**
 * Minimal, dependency-free XML reader for office formats (ODT, PPTX, EPUB
 * packages). It keeps qualified names as written (`text:p`) and ignores
 * comments, processing instructions and doctypes. Not validating.
 */

export interface XmlElement {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
}

export type XmlNode = XmlElement | string

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

const ATTR = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g

export function parseXml(source: string): XmlElement {
  const root: XmlElement = { name: '#root', attrs: {}, children: [] }
  const stack: XmlElement[] = [root]
  let i = 0
  while (i < source.length) {
    const lt = source.indexOf('<', i)
    const textEnd = lt === -1 ? source.length : lt
    if (textEnd > i) {
      const text = source.slice(i, textEnd)
      if (text) stack[stack.length - 1].children.push(decodeEntities(text))
    }
    if (lt === -1) break
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt)
      i = end === -1 ? source.length : end + 3
    } else if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt)
      stack[stack.length - 1].children.push(source.slice(lt + 9, end === -1 ? source.length : end))
      i = end === -1 ? source.length : end + 3
    } else if (source[lt + 1] === '?' || source[lt + 1] === '!') {
      const end = source.indexOf('>', lt)
      i = end === -1 ? source.length : end + 1
    } else if (source[lt + 1] === '/') {
      const end = source.indexOf('>', lt)
      const name = source.slice(lt + 2, end).trim()
      // Pop to the matching element; tolerate stray closing tags.
      const at = stack.map((el) => el.name).lastIndexOf(name)
      if (at > 0) stack.length = at
      i = end === -1 ? source.length : end + 1
    } else {
      const end = findTagEnd(source, lt)
      const raw = source.slice(lt + 1, end)
      const selfClosing = raw.endsWith('/')
      const body = selfClosing ? raw.slice(0, -1) : raw
      const nameMatch = /^[^\s/>]+/.exec(body)
      const element: XmlElement = { name: nameMatch ? nameMatch[0] : '', attrs: {}, children: [] }
      for (const m of body.slice(element.name.length).matchAll(ATTR)) {
        element.attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '')
      }
      stack[stack.length - 1].children.push(element)
      if (!selfClosing) stack.push(element)
      i = end + 1
    }
  }
  return root
}

function findTagEnd(source: string, from: number): number {
  let quote = ''
  for (let i = from + 1; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '>') return i
  }
  return source.length
}

/** Local name without namespace prefix. */
export function localName(name: string): string {
  const colon = name.indexOf(':')
  return colon === -1 ? name : name.slice(colon + 1)
}

export function elements(node: XmlElement): XmlElement[] {
  return node.children.filter((child): child is XmlElement => typeof child !== 'string')
}

/** Depth-first search for every element whose local name matches. */
export function findAll(node: XmlElement, local: string): XmlElement[] {
  const found: XmlElement[] = []
  const walk = (el: XmlElement) => {
    for (const child of elements(el)) {
      if (localName(child.name) === local) found.push(child)
      walk(child)
    }
  }
  walk(node)
  return found
}

export function find(node: XmlElement, local: string): XmlElement | undefined {
  return findAll(node, local)[0]
}

export function textOf(node: XmlNode): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('')
}

/** Attribute by local name, ignoring its prefix. */
export function attr(node: XmlElement, local: string): string | undefined {
  for (const [key, value] of Object.entries(node.attrs)) {
    if (localName(key) === local) return value
  }
  return undefined
}
