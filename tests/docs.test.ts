import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import mammoth from 'mammoth'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Job, StartJobsRequest } from '@shared/types'
import { JobQueue } from '../src/main/jobs'
import { findConverter, targetsForExt } from '../src/main/registry'
import { openPdf, pdfToHtml } from '../src/main/converters/document/pdf-read'
import { imageSize } from '../src/main/converters/document/docx-writer'
import { rtfToHtml } from '../src/main/converters/document/rtf'
import { HTML, MARKDOWN, PNG_1PX, RTF, TEXT, makeDocx, makeEpub, makeOdt, makePdf, makePptx } from './docs/fixtures'

let dir: string

async function writeSources(): Promise<void> {
  await writeFile(join(dir, 'sample.md'), MARKDOWN.replace('Closing paragraph.', 'Closing paragraph.\n\n![dot](dot.png)'))
  await writeFile(join(dir, 'dot.png'), PNG_1PX)
  await writeFile(join(dir, 'sample.html'), HTML)
  await writeFile(join(dir, 'sample.txt'), TEXT)
  await writeFile(join(dir, 'sample.docx'), await makeDocx())
  await writeFile(join(dir, 'sample.rtf'), RTF, 'latin1')
  await writeFile(join(dir, 'sample.odt'), makeOdt())
  await writeFile(join(dir, 'sample.pdf'), await makePdf())
  await writeFile(join(dir, 'sample.epub'), makeEpub())
  await writeFile(join(dir, 'sample.pptx'), makePptx())
}

/** Plain text of any produced file, for content assertions. */
async function contentOf(path: string, ext: string): Promise<string> {
  switch (ext) {
    case 'docx':
      return (await mammoth.convertToHtml({ path })).value
    case 'epub': {
      const files = unzipSync(new Uint8Array(await readFile(path)))
      return Object.entries(files)
        .filter(([name]) => name.endsWith('.xhtml'))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, data]) => strFromU8(data))
        .join('\n')
    }
    case 'pdf':
      return pdfToHtml(new Uint8Array(await readFile(path)), new AbortController().signal, () => {})
    default:
      return readFile(path, 'utf8')
  }
}

async function convert(source: string, to: string, options?: StartJobsRequest['options']): Promise<{ job: Job; text: string }> {
  const queue = new JobQueue()
  const [started] = queue.start({ inputs: [join(dir, `sample.${source}`)], to, outputDir: join(dir, 'out'), options })
  await queue.idle()
  const job = queue.list().find((j) => j.id === started.id)!
  expect(job.error).toBeUndefined()
  expect(job.status).toBe('done')
  return { job, text: to === 'png' || to === 'jpg' ? '' : await contentOf(job.outputPath, to) }
}

/** Shared expectations: the fixture's words survive every conversion. */
function expectCommonText(text: string, source: string): void {
  for (const word of ['Report Title', 'important', 'Closing paragraph']) expect(text).toContain(word)
  if (source !== 'pdf') for (const word of ['alpha', 'beta', 'Cell A1', 'Cell B1']) expect(text).toContain(word)
}

/** Structure carried by every input except plain text (which has none). */
function expectStructure(text: string, to: string, source: string): void {
  if (source === 'txt') return
  switch (to) {
    case 'md':
      expect(text).toMatch(/^# Report Title/m)
      if (source !== 'pdf') {
        expect(text).toContain('**important**')
        expect(text).toMatch(/^- alpha$/m)
        expect(text).toContain('[link](https://example.com)')
        expect(text).toMatch(/\| Cell A1 \| Cell B1 \|/)
      }
      break
    case 'html':
    case 'docx':
    case 'epub':
      expect(text).toMatch(/<h1[^>]*>Report Title<\/h1>/)
      if (source !== 'pdf') {
        expect(text).toMatch(/<(strong|b)>important<\/(strong|b)>/)
        expect(text).toMatch(/<li>(<p>)?alpha/)
        expect(text).toContain('href="https://example.com"')
        expect(text).toMatch(/<td>(<p>)?Cell A1/)
      }
      break
    case 'txt':
      if (source !== 'pdf') {
        expect(text).toMatch(/^- alpha$/m)
        expect(text).toContain('Cell A1\tCell B1')
        expect(text).toContain('link (https://example.com)')
      }
      break
  }
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'convert-docs-'))
  await writeSources()
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('document registry', () => {
  it('declares the expected targets per source', () => {
    expect(targetsForExt('md').sort()).toEqual(['docx', 'epub', 'html', 'pdf', 'txt'])
    expect(targetsForExt('rtf').sort()).toEqual(['docx', 'epub', 'html', 'md', 'pdf', 'txt'])
    expect(targetsForExt('pdf').sort()).toEqual(['docx', 'html', 'jpg', 'md', 'png', 'txt'])
    expect(targetsForExt('epub').sort()).toEqual(['docx', 'html', 'md', 'pdf', 'txt'])
    expect(targetsForExt('pptx').sort()).toEqual(['md', 'txt'])
    expect(findConverter('pdf', 'png')?.outputKind?.('pdf', 'png')).toBe('directory')
  })
})

// Every pair that runs under plain Node. Pairs to PDF need Electron and are
// covered by the Electron run at the end of this file.
const TEXT_SOURCES = ['md', 'html', 'txt', 'docx', 'rtf', 'odt'] as const
const NODE_PAIRS: [string, string][] = [
  ...TEXT_SOURCES.flatMap((from) => ['md', 'html', 'txt', 'docx', 'epub'].filter((to) => to !== from).map((to): [string, string] => [from, to])),
  ...['txt', 'md', 'html', 'docx'].map((to): [string, string] => ['pdf', to]),
  ...['html', 'md', 'txt', 'docx'].map((to): [string, string] => ['epub', to])
]

describe('text family through the job queue', () => {
  it.each(NODE_PAIRS)('%s -> %s', async (from, to) => {
    const { text } = await convert(from, to)
    expectCommonText(text, from)
    expectStructure(text, to, from)
  })

  it('keeps images: md (local file) and odt (embedded) -> docx and epub', async () => {
    for (const from of ['md', 'odt']) {
      const docx = await convert(from, 'docx')
      expect(docx.text).toMatch(/<img src="data:image\/png;base64,/)
      const epub = await convert(from, 'epub')
      const files = unzipSync(new Uint8Array(await readFile(epub.job.outputPath)))
      expect(Object.keys(files)).toContain('OEBPS/images/img1.png')
      expect(epub.text).toContain('src="images/img1.png"')
    }
  })

  it('writes a valid EPUB container', async () => {
    const { job, text } = await convert('md', 'epub')
    const bytes = new Uint8Array(await readFile(job.outputPath))
    // `mimetype` first and stored: readers sniff the raw bytes at offset 30.
    expect(Buffer.from(bytes.subarray(30, 58)).toString('latin1')).toBe('mimetypeapplication/epub+zip')
    const files = unzipSync(bytes)
    const opf = strFromU8(files['OEBPS/content.opf'])
    expect(opf).toContain('<dc:title>Report Title</dc:title>')
    expect(opf.match(/<itemref /g)).toHaveLength(1)
    expect(strFromU8(files['OEBPS/nav.xhtml'])).toContain('Report Title')
    expect(text).toMatch(/^<\?xml/)
  })

  it('splits epub chapters at top-level headings and reads them back in order', async () => {
    const md = '# One\n\nFirst.\n\n# Two\n\nSecond.\n'
    await writeFile(join(dir, 'sample-chapters.md'), md)
    const queue = new JobQueue()
    const [job] = queue.start({ inputs: [join(dir, 'sample-chapters.md')], to: 'epub', outputDir: join(dir, 'out') })
    await queue.idle()
    const files = unzipSync(new Uint8Array(await readFile(job.outputPath)))
    expect(Object.keys(files).filter((name) => name.endsWith('.xhtml') && name.includes('chapter'))).toHaveLength(2)
    const [back] = queue.start({ inputs: [job.outputPath], to: 'txt', outputDir: join(dir, 'out') })
    await queue.idle()
    const text = await readFile(back.outputPath, 'utf8')
    expect(text.indexOf('First.')).toBeLessThan(text.indexOf('Second.'))
  })

  it('drops scripts and remote images from HTML input', async () => {
    await writeFile(join(dir, 'sample-remote.html'), '<p>Hi<img src="https://example.com/x.png" alt="remote"><script>bad()</script></p>')
    const queue = new JobQueue()
    const [job] = queue.start({ inputs: [join(dir, 'sample-remote.html')], to: 'md', outputDir: join(dir, 'out') })
    await queue.idle()
    const md = await readFile(job.outputPath, 'utf8')
    expect(md).toMatch(/Hi\*\\?\[remote\\?\]\*/)
    expect(md).not.toContain('bad()')
    expect(md).not.toContain('example.com')
  })
})

describe('pdf input', () => {
  it('detects headings by font size and joins wrapped lines', async () => {
    const html = await pdfToHtml(await makePdf(), new AbortController().signal, () => {})
    expect(html).toContain('<h1>Report Title</h1>')
    expect(html).toContain('<h2>Second Section</h2>')
    expect(html).toContain('<p>Intro with important words and a link. This line continues the same paragraph.</p>')
    expect(html.indexOf('Closing paragraph')).toBeLessThan(html.indexOf('Page two text'))
  })

  it.each(['png', 'jpg'])('pdf -> %s writes one image per page at the chosen DPI', async (to) => {
    const { job } = await convert('pdf', to, { dpi: '150' })
    const pages = (await readdir(job.outputPath)).sort()
    expect(pages).toEqual([`page-001.${to}`, `page-002.${to}`])
    const first = await readFile(join(job.outputPath, pages[0]))
    if (to === 'png') {
      // A4 at 150 DPI: 595pt x 842pt -> 1240 x 1755 px.
      expect(imageSize(first)).toMatchObject({ type: 'png', width: 1240, height: 1755 })
    } else {
      expect(imageSize(first)).toMatchObject({ type: 'jpg', width: 1240, height: 1755 })
    }
  })

  it('renders text pixels, not a blank page', async () => {
    const { createCanvas, loadImage } = await import('@napi-rs/canvas')
    const { job } = await convert('pdf', 'png', { dpi: '72' })
    const image = await loadImage(await readFile(join(job.outputPath, 'page-001.png')))
    const canvas = createCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    // Title area (x 50..200, y 842-760-24 .. 842-760) must contain dark pixels.
    const data = ctx.getImageData(50, 60, 150, 26).data
    let dark = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] < 100) dark++
    expect(dark).toBeGreaterThan(50)
  })

  it('reports PDFs without text and damaged PDFs clearly', async () => {
    const { PDFDocument } = await import('pdf-lib')
    const blank = await PDFDocument.create()
    blank.addPage()
    await writeFile(join(dir, 'sample-blank.pdf'), await blank.save())
    await writeFile(join(dir, 'sample-broken.pdf'), 'not a pdf')
    const queue = new JobQueue()
    queue.start({ inputs: [join(dir, 'sample-blank.pdf'), join(dir, 'sample-broken.pdf')], to: 'txt', outputDir: join(dir, 'out') })
    await queue.idle()
    const [blankJob, brokenJob] = queue.list()
    expect(blankJob.error).toMatch(/no selectable text/)
    expect(brokenJob.error).toMatch(/damaged/)
    expect(existsSync(blankJob.outputPath)).toBe(false)
  })

  it('opens PDFs under plain Node', async () => {
    const doc = await openPdf(await makePdf())
    expect(doc.numPages).toBe(2)
    await doc.loadingTask.destroy()
  })
})

describe('rtf reader', () => {
  it('decodes code-page and unicode escapes and drops destinations', () => {
    const html = rtfToHtml(RTF)
    expect(html).toContain('Café €')
    expect(html).not.toContain('Calibri')
    expect(html).not.toContain('Test;')
    expect(html).toContain('<h1>Report Title</h1>')
    expect(html).toContain('<ul><li>alpha</li><li>beta</li></ul>')
  })

  it('rejects non-RTF input', () => {
    expect(() => rtfToHtml('hello')).toThrow(/not a valid RTF/)
  })
})

describe('slides', () => {
  it.each(['txt', 'md'])('pptx -> %s keeps presentation order, levels and notes', async (to) => {
    const { text } = await convert('pptx', to)
    expect(text.indexOf('Opening Slide')).toBeLessThan(text.indexOf('Closing Slide'))
    expect(text).toContain('Remember to smile')
    expect(text).toContain('Thanks & questions')
    if (to === 'md') {
      expect(text).toContain('## Slide 1: Opening Slide')
      expect(text).toContain('  - Sub point')
      expect(text).toContain('> Remember to smile')
    } else {
      expect(text).toContain('Slide 1: Opening Slide')
      expect(text).toContain('  Sub point')
    }
  })
})

/**
 * Pairs that need Electron (print to PDF), plus page rasterization, run in a
 * real Electron main process through the same JobQueue. Skipped only when the
 * Electron binary is not installed.
 */
const require = createRequire(import.meta.url)
const electronPath: string | undefined = (() => {
  try {
    const path = require('electron') as unknown as string
    return existsSync(path) ? path : undefined
  } catch {
    return undefined
  }
})()

describe.skipIf(!electronPath)('inside Electron', () => {
  const PDF_SOURCES = ['md', 'html', 'txt', 'docx', 'rtf', 'odt', 'epub']
  let results: { electron?: string; jobs?: Job[]; error?: string }

  beforeAll(async () => {
    const root = resolve(import.meta.dirname, '..')
    const outDir = join(root, 'node_modules', '.cache', 'convert-docs-harness')
    const { build } = await import('vite')
    await build({
      configFile: false,
      logLevel: 'silent',
      root,
      resolve: { alias: { '@shared': join(root, 'src/shared') } },
      build: {
        ssr: join(root, 'tests/docs/electron-harness.ts'),
        outDir,
        emptyOutDir: true,
        minify: false,
        rollupOptions: { external: ['electron'], output: { format: 'cjs', entryFileNames: 'harness.cjs' } }
      }
    })
    const electronOut = join(dir, 'electron')
    await mkdir(electronOut, { recursive: true })
    const resultPath = join(dir, 'electron-result.json')
    const jobs: StartJobsRequest[] = [
      ...PDF_SOURCES.map((from) => ({ inputs: [join(dir, `sample.${from}`)], to: 'pdf', outputDir: electronOut })),
      { inputs: [join(dir, 'sample.pdf')], to: 'png', outputDir: electronOut, options: { dpi: '300' } },
      { inputs: [join(dir, 'sample.pdf')], to: 'jpg', outputDir: electronOut, options: { dpi: '72' } }
    ]
    const specPath = join(dir, 'electron-spec.json')
    await writeFile(specPath, JSON.stringify({ jobs, resultPath }))
    const run = spawnSync(electronPath!, [join(outDir, 'harness.cjs'), specPath], {
      encoding: 'utf8',
      timeout: 120_000,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE'))
    })
    if (!existsSync(resultPath)) throw new Error(`Electron run failed: ${run.status} ${run.stderr}`)
    results = JSON.parse(await readFile(resultPath, 'utf8'))
  }, 180_000)

  it('ran in a real Electron main process', () => {
    expect(results.error).toBeUndefined()
    expect(results.electron).toMatch(/^\d+\./)
  })

  it.each(PDF_SOURCES)('%s -> pdf prints real, text-bearing pages', async (from) => {
    const job = results.jobs!.find((j) => j.from === from && j.to === 'pdf')!
    expect(job.error).toBeUndefined()
    expect(job.status).toBe('done')
    const bytes = await readFile(job.outputPath)
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const text = await contentOf(job.outputPath, 'pdf')
    expectCommonText(text, from)
    if (from !== 'txt') expect(text).toMatch(/<h1>Report Title<\/h1>/)
  })

  it('pdf -> png / jpg rasterize in Electron at the requested DPI', async () => {
    const png = results.jobs!.find((j) => j.to === 'png')!
    const jpg = results.jobs!.find((j) => j.to === 'jpg')!
    expect(png.status).toBe('done')
    expect(jpg.status).toBe('done')
    const pngFirst = await readFile(join(png.outputPath, 'page-001.png'))
    expect(imageSize(pngFirst)).toMatchObject({ width: 2480, height: 3509 })
    expect((await readdir(jpg.outputPath)).sort()).toEqual(['page-001.jpg', 'page-002.jpg'])
    expect(imageSize(await readFile(join(jpg.outputPath, 'page-001.jpg')))).toMatchObject({ width: 595, height: 842 })
  })
})
