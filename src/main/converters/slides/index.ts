import { readFile, writeFile } from 'node:fs/promises'
import { strFromU8 } from 'fflate'
import type { Converter } from '@shared/types'
import { unzip } from '../document/odt'
import { attr, elements, find, findAll, localName, parseXml, textOf, type XmlElement } from '../document/xml'

/**
 * PPTX -> text / Markdown: slide titles, body text (with bullet nesting) and
 * speaker notes, in presentation order. Slide layout and images are not
 * rendered: there is no faithful offline PPTX renderer without an office suite.
 */

export interface Slide {
  title: string
  paragraphs: { text: string; level: number }[]
  notes: string[]
}

function rels(files: Record<string, Uint8Array>, partPath: string): Map<string, { type: string; target: string }> {
  const dir = partPath.split('/').slice(0, -1).join('/')
  const relPath = `${dir}/_rels/${partPath.split('/').pop()}.rels`
  const map = new Map<string, { type: string; target: string }>()
  if (!files[relPath]) return map
  for (const rel of findAll(parseXml(strFromU8(files[relPath])), 'Relationship')) {
    const target = rel.attrs.Target ?? ''
    const parts = dir.split('/')
    for (const seg of target.split('/')) {
      if (seg === '..') parts.pop()
      else if (seg && seg !== '.') parts.push(seg)
    }
    const resolved = target.startsWith('/') ? target.slice(1) : parts.join('/')
    map.set(rel.attrs.Id ?? '', { type: rel.attrs.Type ?? '', target: resolved })
  }
  return map
}

function paragraphsOf(shape: XmlElement): { text: string; level: number }[] {
  return findAll(shape, 'p')
    .filter((p) => p.name === 'a:p')
    .map((p) => {
      const pPr = elements(p).find((el) => localName(el.name) === 'pPr')
      const text = elements(p)
        .map((el) => (localName(el.name) === 'br' ? '\n' : localName(el.name) === 'r' || localName(el.name) === 'fld' ? textOf(find(el, 't') ?? el) : ''))
        .join('')
        .trim()
      return { text, level: Number(pPr ? attr(pPr, 'lvl') ?? 0 : 0) }
    })
    .filter((p) => p.text)
}

export function readSlides(bytes: Uint8Array): Slide[] {
  const files = unzip(bytes)
  const presPath = 'ppt/presentation.xml'
  if (!files[presPath]) throw new Error('This is not a valid PowerPoint (.pptx) file')
  const presRels = rels(files, presPath)
  const order = findAll(parseXml(strFromU8(files[presPath])), 'sldId')
    .map((s) => presRels.get(s.attrs['r:id'] ?? '')?.target)
    .filter((t): t is string => !!t && !!files[t])

  return order.map((slidePath) => {
    const xml = parseXml(strFromU8(files[slidePath]))
    let title = ''
    const paragraphs: Slide['paragraphs'] = []
    for (const shape of findAll(xml, 'sp')) {
      const ph = find(shape, 'ph')
      const type = ph ? attr(ph, 'type') : undefined
      const paras = paragraphsOf(shape)
      if (!title && (type === 'title' || type === 'ctrTitle')) title = paras.map((p) => p.text).join(' ')
      else if (type !== 'sldNum' && type !== 'dt' && type !== 'ftr') paragraphs.push(...paras)
    }
    // Table cells count as body text.
    for (const cell of findAll(xml, 'tc')) paragraphs.push(...paragraphsOf(cell))

    const notesTarget = [...rels(files, slidePath).values()].find((r) => r.type.endsWith('/notesSlide'))?.target
    const notes: string[] = []
    if (notesTarget && files[notesTarget]) {
      for (const shape of findAll(parseXml(strFromU8(files[notesTarget])), 'sp')) {
        const ph = find(shape, 'ph')
        if (ph && attr(ph, 'type') === 'body') notes.push(...paragraphsOf(shape).map((p) => p.text))
      }
    }
    return { title, paragraphs, notes }
  })
}

export function slidesToText(slides: Slide[]): string {
  return (
    slides
      .map((slide, i) => {
        const lines = [`Slide ${i + 1}${slide.title ? `: ${slide.title}` : ''}`, '']
        for (const p of slide.paragraphs) lines.push(`${'  '.repeat(p.level)}${p.text}`)
        if (slide.notes.length) lines.push('', 'Notes:', ...slide.notes)
        return lines.join('\n').trimEnd()
      })
      .join('\n\n\n') + '\n'
  )
}

const mdEscape = (s: string) => s.replace(/([\\`*_[\]#<>|])/g, '\\$1')

export function slidesToMarkdown(slides: Slide[]): string {
  return (
    slides
      .map((slide, i) => {
        const lines = [`## Slide ${i + 1}${slide.title ? `: ${mdEscape(slide.title)}` : ''}`, '']
        for (const p of slide.paragraphs) lines.push(`${'  '.repeat(p.level)}- ${mdEscape(p.text).replace(/\n/g, ' ')}`)
        if (slide.notes.length) {
          lines.push('', '> **Notes**', '>')
          for (const note of slide.notes) lines.push(`> ${mdEscape(note)}`)
        }
        return lines.join('\n').trimEnd()
      })
      .join('\n\n') + '\n'
  )
}

export const converters: Converter[] = [
  {
    id: 'slides.text',
    category: 'slides',
    from: ['pptx'],
    to: ['txt', 'md'],
    async convert({ inputPath, outputPath, to, signal, onProgress }) {
      const slides = readSlides(new Uint8Array(await readFile(inputPath)))
      if (slides.length === 0) throw new Error('This presentation has no slides')
      signal.throwIfAborted()
      onProgress(0.5)
      await writeFile(outputPath, to === 'md' ? slidesToMarkdown(slides) : slidesToText(slides), 'utf8')
      onProgress(1)
    }
  }
]
