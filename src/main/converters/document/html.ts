import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, type HTMLElement } from 'node-html-parser'

/**
 * HTML is the shared intermediate of the document engine: every reader
 * produces a body fragment, every writer consumes one.
 */

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml'
}

export function mimeForPath(path: string): string | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase()
  return ext ? MIME[ext] : undefined
}

export function dataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
}

const STYLE = `
  body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 46em; margin: 0 auto; padding: 1em; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.2em 0 0.5em; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid #999; padding: 0.3em 0.6em; text-align: left; vertical-align: top; }
  pre { background: #f4f4f4; padding: 0.8em; overflow-x: auto; white-space: pre-wrap; }
  code { font-family: Consolas, "Courier New", monospace; }
  blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1em; color: #444; }
  @media print { body { max-width: none; padding: 0; } }
`

/** Full standalone HTML document around a body fragment. */
export function htmlDocument(body: string, title = 'Document'): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`
}

/** The `<body>` content of a full document, or the input when it is already a fragment. */
export function bodyOf(html: string): { body: string; title?: string } {
  const root = parse(html, { comment: false })
  const title = root.querySelector('title')?.text.trim() || undefined
  const body = root.querySelector('body')
  if (body) return { body: body.innerHTML, title }
  for (const tag of ['head', 'script', 'style', 'meta', 'link', 'title']) {
    for (const el of root.querySelectorAll(tag)) el.remove()
  }
  const inner = root.querySelector('html')
  return { body: (inner ?? root).innerHTML, title }
}

/** Removes scripts, styles and event handlers: output documents are static. */
export function sanitize(root: HTMLElement): void {
  for (const el of root.querySelectorAll('script, style, iframe, object, embed, noscript, link, meta')) el.remove()
  for (const el of root.querySelectorAll('*')) {
    for (const name of Object.keys(el.attributes)) {
      if (/^on/i.test(name)) el.removeAttribute(name)
    }
  }
}

/**
 * Replaces local image references with data URIs so the document stays
 * self-contained whatever the output location. Remote images are dropped:
 * the app never touches the network.
 */
export async function inlineImages(body: string, baseDir: string): Promise<string> {
  const root = parse(body, { comment: false })
  sanitize(root)
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? ''
    if (src.startsWith('data:')) continue
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('file:')) {
      replaceWithAlt(img)
      continue
    }
    try {
      const clean = decodeURIComponent(src.split(/[?#]/)[0])
      const path = clean.startsWith('file:') ? fileURLToPath(clean) : isAbsolute(clean) ? clean : resolve(baseDir, clean)
      const mime = mimeForPath(path)
      if (!mime) throw new Error('unsupported image')
      img.setAttribute('src', dataUri(await readFile(path), mime))
    } catch {
      replaceWithAlt(img)
    }
  }
  return root.toString()
}

function replaceWithAlt(img: HTMLElement): void {
  const alt = img.getAttribute('alt')
  if (alt) img.replaceWith(`<em>[${escapeHtml(alt)}]</em>`)
  else img.remove()
}

export function baseDirOf(path: string): string {
  return dirname(path)
}
