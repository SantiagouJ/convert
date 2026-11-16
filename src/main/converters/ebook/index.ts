import { readFile, writeFile } from 'node:fs/promises'
import type { Converter } from '@shared/types'
import { TEXT_INPUTS, readAsHtml, writeFromHtml } from '../document/pipeline'
import { epubToHtml, htmlToEpub } from './epub'

export const converters: Converter[] = [
  {
    id: 'ebook.read',
    category: 'ebook',
    from: ['epub'],
    to: ['html', 'md', 'txt', 'docx', 'pdf'],
    async convert(ctx) {
      const doc = epubToHtml(new Uint8Array(await readFile(ctx.inputPath)))
      ctx.onProgress(0.5)
      await writeFromHtml(doc, ctx)
      ctx.onProgress(1)
    }
  },
  {
    id: 'ebook.write',
    category: 'ebook',
    from: TEXT_INPUTS,
    to: ['epub'],
    async convert(ctx) {
      const doc = await readAsHtml(ctx.inputPath, ctx.from)
      ctx.onProgress(0.5)
      ctx.signal.throwIfAborted()
      await writeFile(ctx.outputPath, htmlToEpub(doc))
      ctx.onProgress(1)
    }
  }
]
