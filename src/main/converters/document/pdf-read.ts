import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { escapeHtml } from './html'

/**
 * PDF reading through pdf.js (pure JS, runs in Node and in Electron's main
 * process) and page rasterization through @napi-rs/canvas, which pdf.js
 * picks up as its Node canvas backend. Neither needs a browser window.
 */

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type PdfDocument = Awaited<ReturnType<PdfJs['getDocument']>['promise']>

let pdfjsPromise: Promise<PdfJs> | undefined

function pdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjsPromise
}

/** Data directories shipped inside pdfjs-dist (fonts, CMaps, decoders). */
function assetDir(name: string): string {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  return join(root, name).replace(/\\/g, '/') + '/'
}

export async function openPdf(bytes: Uint8Array): Promise<PdfDocument> {
  const lib = await pdfjs()
  try {
    return await lib.getDocument({
      data: bytes,
      standardFontDataUrl: assetDir('standard_fonts'),
      cMapUrl: assetDir('cmaps'),
      cMapPacked: true,
      wasmUrl: assetDir('wasm'),
      iccUrl: assetDir('iccs'),
      useSystemFonts: false,
      verbosity: 0
    }).promise
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'PasswordException') throw new Error('This PDF is password protected')
    throw new Error('The PDF is damaged or could not be read')
  }
}

interface Line {
  text: string
  size: number
  y: number
  x: number
  height: number
}

interface TextItemLike {
  str: string
  transform: number[]
  height: number
  width?: number
  hasEOL: boolean
}

function isTextItem(item: unknown): item is TextItemLike {
  return typeof item === 'object' && item !== null && 'str' in item && 'transform' in item
}

/**
 * Groups text runs into lines (content-stream order, which is the reading
 * order authoring tools write) and lines into paragraphs by vertical gaps.
 */
async function pageLines(doc: PdfDocument, n: number): Promise<Line[]> {
  const page = await doc.getPage(n)
  const content = await page.getTextContent()
  const lines: Line[] = []
  let current: Line | undefined
  for (const item of content.items) {
    if (!isTextItem(item)) continue
    const [, , , d, x, y] = item.transform
    const size = Math.abs(d) || item.height || 10
    const sameLine = current && Math.abs(current.y - y) < size * 0.5
    if (!current || !sameLine) {
      if (current && current.text.trim()) lines.push(current)
      current = { text: '', size, y, x, height: size }
    } else if (item.str && current.text && !/\s$/.test(current.text) && !/^\s/.test(item.str)) {
      // Separate runs that pdf.js did not space (visible gap between glyph runs).
      if (x - current.x > size * 0.15) current.text += ' '
    }
    current.text += item.str
    current.size = Math.max(current.size, size)
    current.x = x + (item.width ?? 0)
    if (item.hasEOL) {
      if (current.text.trim()) lines.push(current)
      current = undefined
    }
  }
  if (current && current.text.trim()) lines.push(current)
  page.cleanup()
  return lines
}

/** Text structure of a PDF as an HTML fragment: headings by font size, paragraphs by spacing. */
export async function pdfToHtml(bytes: Uint8Array, signal: AbortSignal, onProgress: (f: number) => void): Promise<string> {
  const doc = await openPdf(bytes)
  try {
    const pages: Line[][] = []
    for (let n = 1; n <= doc.numPages; n++) {
      signal.throwIfAborted()
      pages.push(await pageLines(doc, n))
      onProgress((n / doc.numPages) * 0.9)
    }
    const all = pages.flat()
    if (all.length === 0) {
      throw new Error('This PDF has no selectable text (it may be scanned images)')
    }
    // Body size: the size covering the most characters.
    const weight = new Map<number, number>()
    for (const line of all) {
      const key = Math.round(line.size)
      weight.set(key, (weight.get(key) ?? 0) + line.text.length)
    }
    const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const headingSizes = [...new Set(all.map((l) => Math.round(l.size)).filter((s) => s >= body * 1.2))].sort((a, b) => b - a)

    const blocks: string[] = []
    for (const lines of pages) {
      let para: string[] = []
      let prev: Line | undefined
      const flush = () => {
        if (para.length) blocks.push(`<p>${para.join(' ').replace(/- (?=[a-z])/g, '')}</p>`)
        para = []
      }
      for (const line of lines) {
        const size = Math.round(line.size)
        const text = escapeHtml(line.text.replace(/\s+/g, ' ').trim())
        if (headingSizes.includes(size) && line.text.trim().length < 200) {
          flush()
          const level = Math.min(headingSizes.indexOf(size) + 1, 6)
          const last = blocks.at(-1)
          // Multi-line heading: same level directly after the previous one.
          if (prev && Math.round(prev.size) === size && last?.startsWith(`<h${level}>`)) {
            blocks[blocks.length - 1] = last.replace(`</h${level}>`, ` ${text}</h${level}>`)
          } else blocks.push(`<h${level}>${text}</h${level}>`)
        } else {
          const gap = prev ? Math.abs(prev.y - line.y) : 0
          if (prev && (gap > line.size * 1.7 || Math.round(prev.size) !== size)) flush()
          if (prev && headingSizes.includes(Math.round(prev.size))) flush()
          para.push(text)
        }
        prev = line
      }
      flush()
    }
    return blocks.join('\n')
  } finally {
    await doc.loadingTask.destroy()
  }
}

/** Renders every page to `outDir/page-001.png` (or .jpg) at the given DPI. */
export async function rasterizePdf(
  bytes: Uint8Array,
  outDir: string,
  format: 'png' | 'jpg',
  dpi: number,
  signal: AbortSignal,
  onProgress: (f: number) => void
): Promise<number> {
  const { createCanvas } = await import('@napi-rs/canvas')
  const doc = await openPdf(bytes)
  try {
    await mkdir(outDir, { recursive: true })
    const digits = Math.max(3, String(doc.numPages).length)
    for (let n = 1; n <= doc.numPages; n++) {
      signal.throwIfAborted()
      const page = await doc.getPage(n)
      const viewport = page.getViewport({ scale: dpi / 72 })
      const width = Math.ceil(viewport.width)
      const height = Math.ceil(viewport.height)
      const canvas = createCanvas(width, height)
      const context = canvas.getContext('2d')
      // PDFs assume a white page; JPEG has no transparency anyway.
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      const task = page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport, background: 'white' })
      const cancel = () => task.cancel()
      signal.addEventListener('abort', cancel, { once: true })
      try {
        await task.promise
      } finally {
        signal.removeEventListener('abort', cancel)
      }
      signal.throwIfAborted()
      const data = format === 'png' ? await canvas.encode('png') : await canvas.encode('jpeg', 90)
      await writeFile(join(outDir, `page-${String(n).padStart(digits, '0')}.${format}`), data)
      page.cleanup()
      onProgress(n / doc.numPages)
    }
    return doc.numPages
  } finally {
    await doc.loadingTask.destroy()
  }
}
