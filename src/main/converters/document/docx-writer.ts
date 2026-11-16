import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  BorderStyle,
  type ParagraphChild
} from 'docx'
import { parse, NodeType, type HTMLElement, type Node } from 'node-html-parser'
import { decodeEntities } from './xml'

/**
 * HTML -> DOCX: headings, paragraphs, bold / italic / underline / strike /
 * code, links, nested bullet and numbered lists, tables, block quotes,
 * preformatted text and embedded (data URI) PNG / JPEG / GIF / BMP images.
 */

interface Marks {
  bold?: boolean
  italics?: boolean
  underline?: boolean
  strike?: boolean
  code?: boolean
}

type Block = Paragraph | Table

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6
]

const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'blockquote', 'pre', 'hr',
  'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'figure', 'figcaption', 'dl', 'dt', 'dd',
  'address', 'details', 'summary'
])

/** Max image width in the page body, in pixels at 96 DPI (A4 minus margins). */
const MAX_IMAGE_WIDTH = 600

export function imageSize(bytes: Uint8Array): { width: number; height: number; type: 'png' | 'jpg' | 'gif' | 'bmp' } | undefined {
  const b = Buffer.from(bytes)
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) {
    return { type: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  }
  if (b.length > 10 && b.toString('ascii', 0, 3) === 'GIF') {
    return { type: 'gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
  }
  if (b.length > 26 && b.toString('ascii', 0, 2) === 'BM') {
    return { type: 'bmp', width: b.readInt32LE(18), height: Math.abs(b.readInt32LE(22)) }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return undefined
      const marker = b[i + 1]
      const length = b.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'jpg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
      }
      i += 2 + length
    }
  }
  return undefined
}

function imageRun(src: string): ImageRun | undefined {
  const m = /^data:[^;,]+;base64,(.*)$/s.exec(src)
  if (!m) return undefined
  const data = Buffer.from(m[1], 'base64')
  const size = imageSize(data)
  if (!size || !size.width || !size.height) return undefined
  const scale = Math.min(1, MAX_IMAGE_WIDTH / size.width)
  return new ImageRun({
    type: size.type,
    data,
    transformation: { width: Math.round(size.width * scale), height: Math.round(size.height * scale) }
  })
}

function text(node: Node): string {
  return decodeEntities(node.rawText)
}

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === NodeType.ELEMENT_NODE
}

function tagOf(node: Node): string {
  return isElement(node) ? (node.rawTagName ?? '').toLowerCase() : ''
}

class Builder {
  private listInstance = 0

  blocks(nodes: Node[], marks: Marks = {}): Block[] {
    const out: Block[] = []
    let inline: Node[] = []
    const flushInline = () => {
      const hasContent = inline.some((node) => isElement(node) || text(node).trim())
      const children = hasContent ? this.inline(inline, marks) : []
      if (children.length) out.push(new Paragraph({ children }))
      inline = []
    }
    for (const node of nodes) {
      if (isElement(node) && BLOCK_TAGS.has(tagOf(node))) {
        flushInline()
        out.push(...this.block(node, marks))
      } else {
        inline.push(node)
      }
    }
    flushInline()
    return out
  }

  private block(el: HTMLElement, marks: Marks): Block[] {
    const tag = tagOf(el)
    const heading = /^h([1-6])$/.exec(tag)
    if (heading) {
      return [new Paragraph({ heading: HEADINGS[Number(heading[1]) - 1], children: this.inline(el.childNodes, marks) })]
    }
    switch (tag) {
      case 'p':
      case 'dt':
      case 'figcaption':
      case 'summary':
        return [new Paragraph({ children: this.inline(el.childNodes, marks) })]
      case 'dd':
        return [new Paragraph({ indent: { left: 720 }, children: this.inline(el.childNodes, marks) })]
      case 'ul':
      case 'ol':
        return this.list(el, tag === 'ol', 0, marks)
      case 'table':
        return [this.table(el, marks)]
      case 'blockquote':
        return this.blocks(el.childNodes, { ...marks, italics: true })
      case 'pre': {
        const lines = text(el).replace(/\n$/, '').split('\n')
        return [
          new Paragraph({
            children: lines.map(
              (line, i) => new TextRun({ text: line, font: 'Consolas', size: 20, break: i > 0 ? 1 : undefined })
            )
          })
        ]
      }
      case 'hr':
        return [
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } },
            children: []
          })
        ]
      default:
        return this.blocks(el.childNodes, marks)
    }
  }

  private list(el: HTMLElement, ordered: boolean, level: number, marks: Marks): Block[] {
    const instance = ++this.listInstance
    const out: Block[] = []
    for (const li of el.childNodes) {
      if (!isElement(li) || tagOf(li) !== 'li') continue
      const inline: Node[] = []
      const nested: Block[] = []
      for (const child of li.childNodes) {
        const t = tagOf(child)
        if (t === 'ul' || t === 'ol') nested.push(...this.list(child as HTMLElement, t === 'ol', level + 1, marks))
        else if (t === 'p') inline.push(...(child as HTMLElement).childNodes, ...[])
        else if (isElement(child) && BLOCK_TAGS.has(t)) nested.push(...this.block(child, marks))
        else inline.push(child)
      }
      const lvl = Math.min(level, 8)
      out.push(
        new Paragraph({
          children: this.inline(inline, marks),
          ...(ordered ? { numbering: { reference: 'ordered', level: lvl, instance } } : { bullet: { level: lvl } })
        }),
        ...nested
      )
    }
    return out
  }

  private table(el: HTMLElement, marks: Marks): Table {
    const rows = el.querySelectorAll('tr').filter((tr) => tr.closest('table') === el)
    const width = Math.max(1, ...rows.map((tr) => tr.childNodes.filter((c) => /^t[dh]$/.test(tagOf(c))).length))
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map(
        (tr) =>
          new TableRow({
            tableHeader: tr.parentNode && tagOf(tr.parentNode) === 'thead' ? true : undefined,
            children: (() => {
              const cells = tr.childNodes.filter((c): c is HTMLElement => /^t[dh]$/.test(tagOf(c)))
              const made = cells.map((cell) => {
                const header = tagOf(cell) === 'th'
                const content = this.blocks(cell.childNodes, header ? { ...marks, bold: true } : marks)
                return new TableCell({
                  columnSpan: Number(cell.getAttribute('colspan')) || undefined,
                  children: content.length ? content : [new Paragraph('')]
                })
              })
              // Ragged rows: pad so Word does not repair the file.
              const spans = cells.reduce((sum, cell) => sum + (Number(cell.getAttribute('colspan')) || 1), 0)
              for (let i = spans; i < width; i++) made.push(new TableCell({ children: [new Paragraph('')] }))
              return made
            })()
          })
      )
    })
  }

  inline(nodes: Node[], marks: Marks): ParagraphChild[] {
    const out: ParagraphChild[] = []
    const visit = (node: Node, m: Marks, link?: string) => {
      if (!isElement(node)) {
        const value = text(node).replace(/\s+/g, ' ')
        if (!value) return
        const run = new TextRun({
          text: value,
          bold: m.bold,
          italics: m.italics,
          underline: m.underline || link ? {} : undefined,
          strike: m.strike,
          font: m.code ? 'Consolas' : undefined,
          color: link ? '0563C1' : undefined
        })
        out.push(link ? new ExternalHyperlink({ link, children: [run] }) : run)
        return
      }
      const tag = tagOf(node)
      const next = { ...m }
      switch (tag) {
        case 'b':
        case 'strong':
          next.bold = true
          break
        case 'i':
        case 'em':
        case 'cite':
          next.italics = true
          break
        case 'u':
        case 'ins':
          next.underline = true
          break
        case 's':
        case 'del':
        case 'strike':
          next.strike = true
          break
        case 'code':
        case 'kbd':
        case 'samp':
          next.code = true
          break
        case 'br':
          out.push(new TextRun({ text: '', break: 1 }))
          return
        case 'img': {
          const run = imageRun(node.getAttribute('src') ?? '')
          if (run) out.push(run)
          else if (node.getAttribute('alt')) out.push(new TextRun({ text: `[${node.getAttribute('alt')}]`, italics: true }))
          return
        }
        case 'a': {
          const href = node.getAttribute('href')
          if (href && /^(https?:|mailto:)/i.test(href)) {
            for (const child of node.childNodes) visit(child, next, href)
            return
          }
          break
        }
        case 'script':
        case 'style':
          return
      }
      for (const child of node.childNodes) visit(child, next, link)
    }
    for (const node of nodes) visit(node, marks)
    // Trim leading whitespace of the paragraph.
    return out
  }
}

export async function htmlToDocx(body: string, title?: string): Promise<Buffer> {
  const root = parse(body, { comment: false, blockTextElements: { pre: true } })
  const children = new Builder().blocks(root.childNodes)
  const doc = new Document({
    title,
    creator: 'Convert',
    numbering: {
      config: [
        {
          reference: 'ordered',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } }
          }))
        }
      ]
    },
    sections: [{ children: children.length ? children : [new Paragraph('')] }]
  })
  return Packer.toBuffer(doc)
}
