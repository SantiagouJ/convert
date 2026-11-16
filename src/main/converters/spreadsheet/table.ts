import * as XLSX from 'xlsx'
import { decodeText, parseDelimited, sniffDelimiter } from './csv'

/** One value of a sheet. Dates come from binary workbooks and stay dates until written. */
export type Cell = string | number | boolean | Date | null

export interface Sheet {
  name: string
  rows: Cell[][]
}

/** Reads every sheet of an xlsx, xls or ods file. */
export function readWorkbook(bytes: Buffer): Sheet[] {
  if (!isWorkbookContainer(bytes)) throw new Error('not a workbook')
  const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: true })
  return workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<Cell[]>(workbook.Sheets[name]!, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true
    })
  }))
}

/** xlsx and ods are zip files, xls is an OLE compound file. Anything else is not a workbook. */
function isWorkbookContainer(bytes: Buffer): boolean {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
  return zip || ole
}

/** One sheet from a CSV or TSV file, with delimiter, BOM and numbers handled. */
export function readDelimited(bytes: Buffer, from: 'csv' | 'tsv'): Sheet[] {
  const text = decodeText(bytes)
  const delimiter = sniffDelimiter(text, from === 'tsv' ? '\t' : ',')
  return [{ name: 'Sheet1', rows: parseDelimited(text, delimiter) }]
}

function jsonCell(value: unknown): Cell {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return JSON.stringify(value)
}

/** A JSON array of objects: the header row is every key, in first-seen order. */
export function readJson(bytes: Buffer): Sheet[] {
  const data: unknown = JSON.parse(decodeText(bytes))
  if (!Array.isArray(data) || !data.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))) {
    throw new Error('The JSON must be a list of objects, for example [{"name": "Ana", "age": 31}]')
  }
  const records = data as Record<string, unknown>[]
  const headers = [...new Set(records.flatMap((record) => Object.keys(record)))]
  const rows: Cell[][] = [headers]
  for (const record of records) rows.push(headers.map((key) => jsonCell(record[key])))
  return [{ name: 'Sheet1', rows }]
}

/** Column names for JSON output: blanks and duplicates get a unique fallback. */
function jsonHeaders(header: Cell[]): string[] {
  const seen = new Set<string>()
  return header.map((cell, index) => {
    let name = cell === null ? '' : String(cell).trim()
    if (name === '') name = `Column ${index + 1}`
    let unique = name
    for (let n = 2; seen.has(unique); n++) unique = `${name} (${n})`
    seen.add(unique)
    return unique
  })
}

export function toJsonText(rows: Cell[][]): string {
  const [header = [], ...body] = rows
  const headers = jsonHeaders(header)
  const records = body
    .filter((row) => row.some((cell) => cell !== null && cell !== ''))
    .map((row) => {
      const record: Record<string, string | number | boolean | null> = {}
      headers.forEach((key, index) => {
        const cell = row[index] ?? null
        record[key] = cell instanceof Date ? cell.toISOString() : cell
      })
      return record
    })
  return JSON.stringify(records, null, 2) + '\n'
}

function toWorkbook(sheets: Sheet[]): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new()
  const used = new Set<string>()
  sheets.forEach((sheet, index) => {
    const base = sheet.name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || `Sheet${index + 1}`
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`
    used.add(name.toLowerCase())
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows as unknown[][], { cellDates: true })
    XLSX.utils.book_append_sheet(workbook, worksheet, name)
  })
  return workbook
}

export function toWorkbookBytes(sheets: Sheet[], bookType: 'xlsx' | 'ods'): Buffer {
  return Buffer.from(XLSX.write(toWorkbook(sheets), { bookType, type: 'buffer' }) as Uint8Array)
}

/** HTML is for reading: dates are written as ISO text so every view shows the same value. */
export function toHtml(sheets: Sheet[]): string {
  const text = sheets.map((sheet) => ({
    name: sheet.name,
    rows: sheet.rows.map((row) => row.map((cell) => (cell instanceof Date ? cell.toISOString() : cell)))
  }))
  return XLSX.write(toWorkbook(text), { bookType: 'html', type: 'string' }) as string
}
