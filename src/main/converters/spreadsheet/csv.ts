import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'
import type { Cell } from './table'

/** Excel only reads UTF-8 accents correctly when the file starts with a BOM. */
export const UTF8_BOM = '﻿'

const DELIMITERS = [',', ';', '\t', '|']

/** Decodes bytes as text: UTF-8 (BOM removed), UTF-16 when marked, otherwise Windows-1252. */
export function decodeText(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2))
    for (let i = 0; i + 1 < swapped.length; i += 2) [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]]
    return new TextDecoder('utf-16le').decode(swapped)
  }
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    // Not valid UTF-8: most spreadsheet exports from older Windows apps are Windows-1252.
    return new TextDecoder('windows-1252').decode(body)
  }
}

/** Number of `delimiter` characters in `line` that are not inside double quotes. */
function countOutsideQuotes(line: string, delimiter: string): number {
  let inQuotes = false
  let count = 0
  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes
    else if (!inQuotes && char === delimiter) count++
  }
  return count
}

/**
 * Picks the delimiter that appears the same number of times on the most lines
 * (the header and the data rows agree). Falls back when nothing is consistent.
 */
export function sniffDelimiter(text: string, fallback: string): string {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(0, 50)
  let best = fallback
  let bestScore = [0, 0]
  for (const delimiter of DELIMITERS) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter))
    const first = counts[0] ?? 0
    if (first === 0) continue
    const agreeing = counts.filter((count) => count === first).length
    if (agreeing > bestScore[0] || (agreeing === bestScore[0] && first > bestScore[1])) {
      best = delimiter
      bestScore = [agreeing, first]
    }
  }
  return best
}

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/

/** Numeric text becomes a number; anything else (leading zeros, IDs, dates) stays text. */
export function inferCell(text: string): Cell {
  if (text === '') return null
  if (NUMBER.test(text)) {
    const value = Number(text)
    if (Number.isFinite(value) && (text.includes('.') || Number.isSafeInteger(value))) return value
  }
  return text
}

export function parseDelimited(text: string, delimiter: string): Cell[][] {
  const records: string[][] = parse(text, {
    delimiter,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true
  })
  return records.map((record) => record.map(inferCell))
}

/** Text form of one cell for CSV/TSV output. Dates are ISO 8601. */
export function cellText(cell: Cell): string | number {
  if (cell === null) return ''
  if (cell instanceof Date) return cell.toISOString()
  if (typeof cell === 'boolean') return String(cell)
  return cell
}

export function stringifyDelimited(rows: Cell[][], delimiter: string): string {
  const body = stringify(
    rows.map((row) => row.map(cellText)),
    { delimiter, record_delimiter: '\r\n' }
  )
  return UTF8_BOM + body
}
