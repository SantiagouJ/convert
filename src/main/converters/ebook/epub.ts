import { randomUUID } from 'node:crypto'
import { strFromU8, strToU8, zipSync, type Zippable } from 'fflate'
import { parse, NodeType, type HTMLElement, type Node } from 'node-html-parser'
import { dataUri, escapeHtml, mimeForPath, sanitize } from '../document/html'
import { unzip } from '../document/odt'
import { attr, decodeEntities, find, findAll, parseXml, textOf } from '../document/xml'
import type { HtmlDoc } from '../document/pipeline'

/** Resolves `href` relative to the directory of `base` inside a zip. */
function resolveZipPath(base: string, href: string): string {
  const parts = base.split('/').slice(0, -1)
  for (const segment of decodeURIComponent(href.split('#')[0]).split('/')) {
    if (segment === '..') parts.pop()
    else if (segment && segment !== '.') parts.push(segment)
  }
  return parts.join('/')
}

/** EPUB 2 / 3 -> HTML: the spine's chapters in reading order, images inlined. */
export function epubToHtml(bytes: Uint8Array): HtmlDoc {
  const files = unzip(bytes)
  const container = files['META-INF/container.xml']
  if (!container) throw new Error('This is not a valid EPUB book')
  const rootfile = find(parseXml(strFromU8(container)), 'rootfile')
  const opfPath = rootfile ? attr(rootfile, 'full-path') : undefined
  if (!opfPath || !files[opfPath]) throw new Error('This EPUB book is missing its package file')

  const opf = parseXml(strFromU8(files[opfPath]))
  const title = textOf(find(opf, 'title') ?? { name: '', attrs: {}, children: [] }).trim()
  const manifest = new Map<string, string>()
  for (const item of findAll(opf, 'item')) {
    const id = attr(item, 'id')
    const href = attr(item, 'href')
    if (id && href) manifest.set(id, resolveZipPath(opfPath, href))
  }

  const chapters: string[] = []
  for (const ref of findAll(opf, 'itemref')) {
    if (attr(ref, 'linear') === 'no') continue
    const path = manifest.get(attr(ref, 'idref') ?? '')
    const data = path ? files[path] : undefined
    if (!path || !data) continue
    const root = parse(strFromU8(data), { comment: false })
    const body = root.querySelector('body') ?? root
    sanitize(body)
    for (const img of body.querySelectorAll('img, image')) {
      const src = img.getAttribute('src') ?? img.getAttribute('xlink:href') ?? img.getAttribute('href') ?? ''
      const target = resolveZipPath(path, src)
      const mime = mimeForPath(target)
      if (files[target] && mime) {
        img.replaceWith(`<img src="${dataUri(files[target], mime)}" alt="${escapeHtml(img.getAttribute('alt') ?? '')}">`)
      } else img.remove()
    }
    // Links between chapters cannot survive the merge; keep their text.
    for (const a of body.querySelectorAll('a')) {
      const href = a.getAttribute('href') ?? ''
      if (!/^(https?:|mailto:)/i.test(href)) a.replaceWith(a.innerHTML)
    }
    // SVG wrappers around cover images collapse to their <img>.
    for (const svg of body.querySelectorAll('svg')) {
      const img = svg.querySelector('img')
      if (img) svg.replaceWith(img.toString())
      else svg.remove()
    }
    const html = body.innerHTML.trim()
    if (html) chapters.push(html)
  }
  if (chapters.length === 0) throw new Error('This EPUB book has no readable chapters')
  return { body: chapters.join('\n<hr>\n'), title: title || 'Book' }
}

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'area', 'base', 'wbr', 'source'])

/** Serializes an HTML tree as well-formed XHTML, moving data-URI images into `images`. */
function toXhtml(nodes: Node[], images: Map<string, { name: string; bytes: Uint8Array; mime: string }>): string {
  return nodes
    .map((node) => {
      if (node.nodeType === NodeType.TEXT_NODE) {
        // Re-escape: node-html-parser keeps raw entities, and XHTML only knows the XML five.
        return escapeHtml(decodeEntities(node.rawText))
      }
      if (node.nodeType !== NodeType.ELEMENT_NODE) return ''
      const el = node as HTMLElement
      const tag = (el.rawTagName ?? '').toLowerCase()
      if (!/^[a-z][a-z0-9]*$/.test(tag)) return toXhtml(el.childNodes, images)
      const attrs: string[] = []
      for (const [name, value] of Object.entries(el.attributes)) {
        if (!/^[a-z_:][a-z0-9_:.-]*$/i.test(name) || name.includes(':')) continue
        let v = value
        if (tag === 'img' && name === 'src') {
          const m = /^data:([^;,]+);base64,(.*)$/s.exec(value)
          if (!m) continue
          const key = m[2].slice(0, 64) + m[2].length
          let entry = images.get(key)
          if (!entry) {
            const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp' }[m[1]] ?? 'bin'
            entry = { name: `images/img${images.size + 1}.${ext}`, bytes: Buffer.from(m[2], 'base64'), mime: m[1] }
            images.set(key, entry)
          }
          v = entry.name
        }
        attrs.push(` ${name.toLowerCase()}="${escapeHtml(v)}"`)
      }
      if (tag === 'img' && !('alt' in el.attributes)) attrs.push(' alt=""')
      if (tag === 'img' && !attrs.some((a) => a.startsWith(' src='))) return ''
      if (VOID.has(tag)) return `<${tag}${attrs.join('')}/>`
      return `<${tag}${attrs.join('')}>${toXhtml(el.childNodes, images)}</${tag}>`
    })
    .join('')
}

function chapterXhtml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escapeHtml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>
`
}

const CSS = `body { font-family: serif; line-height: 1.5; }
h1, h2, h3 { font-family: sans-serif; line-height: 1.2; }
img { max-width: 100%; }
table { border-collapse: collapse; }
th, td { border: 1px solid #999; padding: 0.2em 0.5em; }
pre { white-space: pre-wrap; }
`

/** Splits the body into chapters at its top-level headings (h1, else h2). */
function splitChapters(body: string, fallbackTitle: string): { title: string; nodes: Node[] }[] {
  const root = parse(body, { comment: false, blockTextElements: { pre: true } })
  const top = root.childNodes
  const level = top.some((n) => (n as HTMLElement).rawTagName?.toLowerCase() === 'h1')
    ? 'h1'
    : top.some((n) => (n as HTMLElement).rawTagName?.toLowerCase() === 'h2')
      ? 'h2'
      : ''
  const chapters: { title: string; nodes: Node[] }[] = []
  for (const node of top) {
    const tag = (node as HTMLElement).rawTagName?.toLowerCase()
    if (level && tag === level) {
      chapters.push({ title: node.text.trim() || fallbackTitle, nodes: [node] })
    } else {
      if (chapters.length === 0) chapters.push({ title: fallbackTitle, nodes: [] })
      chapters[chapters.length - 1].nodes.push(node)
    }
  }
  // Drop a leading chapter that holds only whitespace.
  return chapters.filter((c) => c.nodes.some((n) => n.text.trim() || (n as HTMLElement).querySelector?.('img')))
}

/** HTML -> EPUB 3 (with an EPUB 2 NCX for older readers). */
export function htmlToEpub(doc: HtmlDoc): Uint8Array {
  const images = new Map<string, { name: string; bytes: Uint8Array; mime: string }>()
  const chapters = splitChapters(doc.body, doc.title).map((chapter, i) => ({
    title: chapter.title,
    file: `chapter${String(i + 1).padStart(3, '0')}.xhtml`,
    xhtml: chapterXhtml(chapter.title, toXhtml(chapter.nodes, images))
  }))
  if (chapters.length === 0) throw new Error('The document is empty')

  const id = `urn:uuid:${randomUUID()}`
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const title = escapeHtml(doc.title)
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${id}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
${chapters.map((c, i) => `    <item id="c${i + 1}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('\n')}
${[...images.values()].map((img, i) => `    <item id="i${i + 1}" href="${img.name}" media-type="${img.mime}"/>`).join('\n')}
  </manifest>
  <spine toc="ncx">
${chapters.map((_, i) => `    <itemref idref="c${i + 1}"/>`).join('\n')}
  </spine>
</package>
`
  const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${title}</title></head>
<body>
<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${chapters.map((c) => `<li><a href="${c.file}">${escapeHtml(c.title)}</a></li>`).join('\n')}
</ol></nav>
</body>
</html>
`
  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${id}"/></head>
<docTitle><text>${title}</text></docTitle>
<navMap>
${chapters.map((c, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${escapeHtml(c.title)}</text></navLabel><content src="${c.file}"/></navPoint>`).join('\n')}
</navMap>
</ncx>
`
  const oebps: Zippable = {
    'content.opf': strToU8(opf),
    'nav.xhtml': strToU8(nav),
    'toc.ncx': strToU8(ncx),
    'style.css': strToU8(CSS)
  }
  for (const c of chapters) oebps[c.file] = strToU8(c.xhtml)
  for (const img of images.values()) oebps[img.name] = [img.bytes, { level: 0 }]

  // `mimetype` must be the first entry and stored uncompressed.
  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF': {
      'container.xml': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`)
    },
    OEBPS: oebps
  })
}

