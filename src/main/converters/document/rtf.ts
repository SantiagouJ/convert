import { escapeHtml } from './html'

/**
 * RTF -> HTML. Covers what word processors emit for ordinary text:
 * paragraphs, bold / italic / underline / strike, headings via
 * `\outlinelevel`, bullets via `\listtext` / `\pntext`, hyperlinks, tables
 * (`\cell` / `\row`) and Unicode escapes. Pictures, fonts and colours are
 * ignored.
 */

interface CharState {
  b: boolean
  i: boolean
  u: boolean
  s: boolean
  /** Characters to skip after `\uN`. */
  uc: number
}

interface Group {
  state: CharState
  skip: boolean
  kind?: 'list' | 'fldinst' | 'fldrslt'
}

/** Destinations whose content is never visible text. */
const SKIP = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'headerl', 'headerr', 'footerl',
  'footerr', 'footnote', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata',
  'colorschememapping', 'latentstyles', 'datastore', 'object', 'filetbl', 'revtbl', 'mmathPr', 'pgdsctbl'
])

// Windows-1252 bytes 0x80..0x9f; others map to Latin-1.
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ'

function decodeByte(byte: number): string {
  return byte >= 0x80 && byte <= 0x9f ? CP1252[byte - 0x80] : String.fromCharCode(byte)
}

interface Paragraph {
  html: string
  text: string
  outline: number
  list: boolean
  inTable: boolean
}

export function rtfToHtml(source: string): string {
  if (!source.startsWith('{\\rtf')) throw new Error('This is not a valid RTF file')

  const blocks: string[] = []
  let para: Paragraph = { html: '', text: '', outline: -1, list: false, inTable: false }
  let openState: CharState | null = null
  let state: CharState = { b: false, i: false, u: false, s: false, uc: 1 }
  const stack: Group[] = []
  let skip = false
  let kind: Group['kind']
  let pendingSkip = 0
  let fieldUrl = ''
  let tableRows: string[][] = []
  let row: string[] = []
  let listItems: string[] = []

  const closeRun = () => {
    if (!openState) return
    para.html += closingTags(openState)
    openState = null
  }

  const emit = (text: string) => {
    if (!text) return
    if (kind === 'fldinst') {
      fieldUrl += text
      return
    }
    if (skip) return
    if (kind === 'list') return
    if (!openState || !sameStyle(openState, state)) {
      closeRun()
      para.html += openingTags(state)
      openState = { ...state }
    }
    para.html += escapeHtml(text)
    para.text += text
  }

  const flushList = () => {
    if (listItems.length === 0) return
    blocks.push(`<ul>${listItems.map((item) => `<li>${item}</li>`).join('')}</ul>`)
    listItems = []
  }

  const endParagraph = () => {
    closeRun()
    const html = para.html.trim()
    if (para.inTable) {
      // Paragraphs inside a cell are joined with line breaks.
      if (html) cellBuffer += (cellBuffer ? '<br>' : '') + html
    } else if (para.list && html) {
      flushTable()
      listItems.push(html)
    } else if (html) {
      flushTable()
      flushList()
      {
        const level = para.outline >= 0 && para.outline < 6 ? para.outline + 1 : 0
        // Headings are bold by style already; drop the redundant markup.
        const heading = html.replace(/<\/?strong>/g, '')
        blocks.push(level ? `<h${level}>${heading}</h${level}>` : `<p>${html}</p>`)
      }
    }
    para = { html: '', text: '', outline: para.outline, list: false, inTable: para.inTable }
  }

  let cellBuffer = ''
  const endCell = () => {
    closeRun()
    const html = para.html.trim()
    cellBuffer += (cellBuffer && html ? '<br>' : '') + html
    row.push(cellBuffer)
    cellBuffer = ''
    para = { ...para, html: '', text: '' }
  }
  const endRow = () => {
    if (row.length) tableRows.push(row)
    row = []
  }
  const flushTable = () => {
    if (tableRows.length === 0) return
    flushList()
    const body = tableRows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
    blocks.push(`<table><tbody>${body}</tbody></table>`)
    tableRows = []
  }

  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === '{') {
      stack.push({ state: { ...state }, skip, kind })
      i++
      continue
    }
    if (ch === '}') {
      const group = stack.pop()
      if (kind === 'fldrslt' && group && group.kind !== 'fldrslt' && fieldUrl) {
        closeRun()
        para.html += '</a>'
        fieldUrl = ''
      }
      if (group) {
        state = group.state
        skip = group.skip
        kind = group.kind
      }
      i++
      continue
    }
    if (ch === '\r' || ch === '\n') {
      i++
      continue
    }
    if (ch !== '\\') {
      if (pendingSkip > 0) {
        pendingSkip--
        i++
        continue
      }
      let end = i
      while (end < source.length && !'\\{}\r\n'.includes(source[end])) end++
      emit(source.slice(i, end))
      i = end
      continue
    }

    // Control symbol or word.
    const next = source[i + 1]
    if (next === "'") {
      const byte = parseInt(source.slice(i + 2, i + 4), 16)
      i += 4
      if (pendingSkip > 0) pendingSkip--
      else if (Number.isFinite(byte)) emit(decodeByte(byte))
      continue
    }
    if (next === '*') {
      skip = true
      i += 2
      continue
    }
    if (next === '\\' || next === '{' || next === '}') {
      emit(next)
      i += 2
      continue
    }
    if (next === '~') {
      emit('\u00a0')
      i += 2
      continue
    }
    if (next === '-' || next === '_') {
      if (next === '_') emit('-')
      i += 2
      continue
    }
    if (next === '\n' || next === '\r') {
      endParagraph()
      i += 2
      continue
    }
    const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(source.slice(i, i + 40))
    if (!m) {
      i += 2
      continue
    }
    i += m[0].length
    const word = m[1]
    const param = m[2] === undefined ? undefined : Number(m[2])
    const on = param !== 0

    if (SKIP.has(word)) {
      skip = true
      continue
    }
    switch (word) {
      case 'par':
      case 'sect':
        endParagraph()
        break
      case 'line':
        closeRun()
        para.html += '<br>'
        break
      case 'tab':
        emit('\t')
        break
      case 'pard':
        para.outline = -1
        para.list = false
        para.inTable = false
        break
      case 'plain':
        state = { ...state, b: false, i: false, u: false, s: false }
        break
      case 'b':
        state = { ...state, b: on }
        break
      case 'i':
        state = { ...state, i: on }
        break
      case 'ul':
        state = { ...state, u: on }
        break
      case 'ulnone':
        state = { ...state, u: false }
        break
      case 'strike':
        state = { ...state, s: on }
        break
      case 'outlinelevel':
        para.outline = param ?? -1
        break
      case 'intbl':
        para.inTable = true
        break
      case 'cell':
        endCell()
        break
      case 'row':
        endRow()
        break
      case 'listtext':
      case 'pntext':
        para.list = true
        kind = 'list'
        break
      case 'fldinst':
        kind = 'fldinst'
        fieldUrl = ''
        break
      case 'fldrslt': {
        const url = /HYPERLINK\s+"([^"]+)"/.exec(fieldUrl)?.[1]
        kind = 'fldrslt'
        if (url) {
          closeRun()
          para.html += `<a href="${escapeHtml(url)}">`
          fieldUrl = url
        } else fieldUrl = ''
        break
      }
      case 'uc':
        state = { ...state, uc: param ?? 1 }
        break
      case 'u': {
        const code = (param ?? 0) < 0 ? (param ?? 0) + 65536 : (param ?? 0)
        emit(String.fromCharCode(code))
        pendingSkip = state.uc
        break
      }
      case 'emdash':
        emit('—')
        break
      case 'endash':
        emit('–')
        break
      case 'bullet':
        emit('•')
        break
      case 'lquote':
        emit('‘')
        break
      case 'rquote':
        emit('’')
        break
      case 'ldblquote':
        emit('“')
        break
      case 'rdblquote':
        emit('”')
        break
      default:
        break
    }
  }
  endParagraph()
  flushTable()
  flushList()
  return blocks.join('\n')
}

function sameStyle(a: CharState, b: CharState): boolean {
  return a.b === b.b && a.i === b.i && a.u === b.u && a.s === b.s
}

function openingTags(s: CharState): string {
  return (s.b ? '<strong>' : '') + (s.i ? '<em>' : '') + (s.u ? '<u>' : '') + (s.s ? '<s>' : '')
}

function closingTags(s: CharState): string {
  return (s.s ? '</s>' : '') + (s.u ? '</u>' : '') + (s.i ? '</em>' : '') + (s.b ? '</strong>' : '')
}
