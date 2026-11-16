import { parse, NodeType, type HTMLElement, type Node } from 'node-html-parser'
import TurndownService from 'turndown'
import { gfm } from '@joplin/turndown-plugin-gfm'
import { decodeEntities } from './xml'
import { escapeHtml } from './html'

/** HTML -> GitHub-flavoured Markdown (tables, strike-through). */
export function htmlToMarkdown(body: string): string {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*'
  })
  service.use(gfm)
  service.remove(['script', 'style'])
  // One space after list markers (turndown pads to four columns by default).
  service.addRule('listItem', {
    filter: 'li',
    replacement(content, node) {
      const parent = node.parentNode as Element | null
      let prefix = '- '
      if (parent?.nodeName === 'OL') {
        const start = Number(parent.getAttribute('start') ?? 1)
        prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `
      }
      const body = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '\n')
        .replace(/\n(?!$)/g, `\n${' '.repeat(prefix.length)}`)
      return prefix + body + (node.nextSibling && !body.endsWith('\n') ? '\n' : '')
    }
  })
  return service.turndown(body).trim() + '\n'
}

/** Plain text -> HTML: blank lines separate paragraphs, single newlines are kept. */
export function textToHtml(source: string): string {
  return source
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.replace(/^\n+|\s+$/g, ''))
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
}

const BLOCK = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'tr', 'blockquote', 'pre', 'hr',
  'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'figure', 'figcaption', 'dl', 'dt', 'dd',
  'address', 'details', 'summary', 'body', 'html'
])

/**
 * HTML -> readable plain text: paragraphs separated by blank lines, list
 * markers, tab-separated table cells, link targets in parentheses.
 */
export function htmlToText(body: string): string {
  const root = parse(body, { comment: false, blockTextElements: { pre: true, script: false, style: false } })
  const blocks: string[] = []

  const inline = (node: Node): string => {
    if (node.nodeType !== NodeType.ELEMENT_NODE) return decodeEntities(node.rawText).replace(/\s+/g, ' ')
    const el = node as HTMLElement
    const tag = (el.rawTagName ?? '').toLowerCase()
    if (tag === 'br') return '\n'
    if (tag === 'img') return el.getAttribute('alt') ? `[${el.getAttribute('alt')}]` : ''
    const inner = el.childNodes.map(inline).join('')
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? ''
      const label = inner.trim()
      if (/^(https?:|mailto:)/i.test(href) && label && label !== href && `mailto:${label}` !== href) {
        return `${inner} (${href})`
      }
    }
    return inner
  }

  const clean = (s: string) =>
    s
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n')
      .trim()

  const walk = (nodes: Node[], prefix = '') => {
    let buffer = ''
    const flush = () => {
      const t = clean(buffer)
      if (t) blocks.push(prefix + t.replace(/\n/g, `\n${prefix}`))
      buffer = ''
    }
    for (const node of nodes) {
      const el = node as HTMLElement
      const tag = node.nodeType === NodeType.ELEMENT_NODE ? (el.rawTagName ?? '').toLowerCase() : ''
      if (!BLOCK.has(tag)) {
        buffer += inline(node)
        continue
      }
      flush()
      switch (tag) {
        case 'ul':
        case 'ol': {
          let n = 0
          const lines: string[] = []
          const list = (listEl: HTMLElement, depth: number, ordered: boolean) => {
            for (const li of listEl.childNodes) {
              const liEl = li as HTMLElement
              if ((liEl.rawTagName ?? '').toLowerCase() !== 'li') continue
              const own = liEl.childNodes.filter((c) => !/^(ul|ol)$/i.test((c as HTMLElement).rawTagName ?? ''))
              const marker = ordered ? `${++n}.` : '-'
              lines.push(`${'  '.repeat(depth)}${marker} ${clean(own.map(inline).join(''))}`)
              for (const sub of liEl.childNodes) {
                const subTag = ((sub as HTMLElement).rawTagName ?? '').toLowerCase()
                if (subTag === 'ul' || subTag === 'ol') {
                  const saved = n
                  n = 0
                  list(sub as HTMLElement, depth + 1, subTag === 'ol')
                  n = saved
                }
              }
            }
          }
          list(el, 0, tag === 'ol')
          blocks.push(lines.map((line) => prefix + line).join('\n'))
          break
        }
        case 'table': {
          const rows = el
            .querySelectorAll('tr')
            .map((tr) =>
              tr.childNodes
                .filter((c) => /^t[dh]$/i.test((c as HTMLElement).rawTagName ?? ''))
                .map((c) => clean(inline(c)).replace(/\n/g, ' '))
                .join('\t')
            )
          blocks.push(rows.map((row) => prefix + row).join('\n'))
          break
        }
        case 'pre':
          blocks.push(decodeEntities(el.rawText).replace(/\n$/, ''))
          break
        case 'hr':
          blocks.push(prefix + '----------')
          break
        case 'blockquote':
          walk(el.childNodes, prefix + '> ')
          break
        default:
          walk(el.childNodes, prefix)
      }
    }
    flush()
  }

  walk(root.childNodes)
  return blocks.join('\n\n') + '\n'
}
