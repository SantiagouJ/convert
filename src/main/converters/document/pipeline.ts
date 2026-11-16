import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { marked } from 'marked'
import mammoth from 'mammoth'
import type { ConvertContext } from '@shared/types'
import { bodyOf, htmlDocument, inlineImages } from './html'
import { htmlToDocx } from './docx-writer'
import { odtToHtml } from './odt'
import { rtfToHtml } from './rtf'
import { htmlToMarkdown, htmlToText, textToHtml } from './text'

/** A document read into the shared intermediate. */
export interface HtmlDoc {
  body: string
  title: string
}

export const TEXT_INPUTS = ['md', 'html', 'txt', 'docx', 'rtf', 'odt']
export const HTML_OUTPUTS = ['md', 'html', 'txt', 'docx', 'pdf']

function stemOf(path: string): string {
  return basename(path).replace(/\.[^.]+$/, '')
}

function firstHeading(body: string): string | undefined {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(body)
  return m ? m[1].replace(/<[^>]+>/g, '').trim() || undefined : undefined
}

async function decodeText(path: string): Promise<string> {
  const bytes = await readFile(path)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le')
  return bytes.toString('utf8').replace(/^﻿/, '')
}

/** Reads any text-family document into HTML. */
export async function readAsHtml(path: string, from: string): Promise<HtmlDoc> {
  const fallbackTitle = stemOf(path)
  let body: string
  let title: string | undefined
  switch (from) {
    case 'md':
      body = await marked.parse(await decodeText(path), { gfm: true, async: true })
      body = await inlineImages(body, dirname(path))
      break
    case 'html': {
      const parsed = bodyOf(await decodeText(path))
      title = parsed.title
      body = await inlineImages(parsed.body, dirname(path))
      break
    }
    case 'txt':
      body = textToHtml(await decodeText(path))
      break
    case 'docx': {
      let result
      try {
        result = await mammoth.convertToHtml({ buffer: await readFile(path) })
      } catch {
        throw new Error('The Word file is damaged or is not a .docx document')
      }
      body = result.value
      break
    }
    case 'rtf':
      body = rtfToHtml(await readFile(path, 'latin1'))
      break
    case 'odt':
      body = odtToHtml(await readFile(path))
      break
    default:
      throw new Error(`Cannot read .${from} files`)
  }
  if (!body.replace(/<[^>]+>/g, '').trim() && !/<img/i.test(body)) {
    throw new Error('The document is empty')
  }
  return { body, title: title || firstHeading(body) || fallbackTitle }
}

/** Writes the intermediate to `ctx.outputPath` in the target format. */
export async function writeFromHtml(doc: HtmlDoc, ctx: ConvertContext): Promise<void> {
  ctx.signal.throwIfAborted()
  switch (ctx.to) {
    case 'html':
      await writeFile(ctx.outputPath, htmlDocument(doc.body, doc.title), 'utf8')
      break
    case 'md':
      await writeFile(ctx.outputPath, htmlToMarkdown(doc.body), 'utf8')
      break
    case 'txt':
      await writeFile(ctx.outputPath, htmlToText(doc.body), 'utf8')
      break
    case 'docx':
      await writeFile(ctx.outputPath, await htmlToDocx(doc.body, doc.title))
      break
    case 'pdf': {
      const { printHtmlToPdf } = await import('./print')
      await writeFile(ctx.outputPath, await printHtmlToPdf(htmlDocument(doc.body, doc.title), ctx.signal))
      break
    }
    default:
      throw new Error(`Cannot write .${ctx.to} files`)
  }
}
