import { readFile } from 'node:fs/promises'
import type { Converter } from '@shared/types'
import { HTML_OUTPUTS, TEXT_INPUTS, readAsHtml, writeFromHtml } from './pipeline'
import { pdfToHtml, rasterizePdf } from './pdf-read'
import { decodeEntities } from './xml'

/**
 * Document engine. Everything goes through one HTML intermediate:
 * readers (md, html, txt, docx, rtf, odt, pdf) produce a body fragment and
 * writers (md, html, txt, docx, pdf) consume it. No external programs.
 */
export const converters: Converter[] = [
  {
    id: 'document.text',
    category: 'document',
    from: TEXT_INPUTS,
    to: HTML_OUTPUTS,
    async convert(ctx) {
      ctx.onProgress(0.1)
      const doc = await readAsHtml(ctx.inputPath, ctx.from)
      ctx.onProgress(0.5)
      await writeFromHtml(doc, ctx)
      ctx.onProgress(1)
    }
  },
  {
    id: 'document.pdf',
    category: 'document',
    from: ['pdf'],
    to: ['txt', 'md', 'html', 'docx', 'png', 'jpg'],
    outputKind: (_from, to) => (to === 'png' || to === 'jpg' ? 'directory' : 'file'),
    options: (to) =>
      to === 'png' || to === 'jpg'
        ? [
            {
              key: 'dpi',
              label: 'Resolution',
              type: 'select',
              choices: [
                { value: '72', label: '72 DPI (screen)' },
                { value: '150', label: '150 DPI' },
                { value: '300', label: '300 DPI (print)' }
              ],
              default: '300'
            }
          ]
        : [],
    async convert(ctx) {
      const bytes = new Uint8Array(await readFile(ctx.inputPath))
      if (ctx.to === 'png' || ctx.to === 'jpg') {
        const dpi = Number(ctx.options.dpi) || 300
        await rasterizePdf(bytes, ctx.outputPath, ctx.to, dpi, ctx.signal, ctx.onProgress)
        return
      }
      const body = await pdfToHtml(bytes, ctx.signal, ctx.onProgress)
      const title = decodeEntities(/<h1>(.*?)<\/h1>/.exec(body)?.[1] ?? 'Document')
      await writeFromHtml({ body, title }, ctx)
      ctx.onProgress(1)
    }
  }
]
