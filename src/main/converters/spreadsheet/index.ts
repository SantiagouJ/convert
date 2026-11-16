import { readFile, writeFile } from 'node:fs/promises'
import type { Converter, OptionSpec } from '@shared/types'
import { stringifyDelimited } from './csv'
import { readDelimited, readJson, readWorkbook, toHtml, toJsonText, toWorkbookBytes, type Sheet } from './table'

const TEXT_TARGETS = ['csv', 'tsv', 'json']

const SHEET_OPTION: OptionSpec = {
  key: 'sheet',
  label: 'Sheet to export (1 = first)',
  type: 'number',
  min: 1,
  max: 999,
  step: 1,
  default: 1
}

function readSheets(bytes: Buffer, from: string): Sheet[] {
  try {
    if (from === 'csv' || from === 'tsv') return readDelimited(bytes, from)
    if (from === 'json') return readJson(bytes)
    return readWorkbook(bytes)
  } catch (error) {
    if (from === 'json' && error instanceof Error && error.message.startsWith('The JSON must')) throw error
    if (from === 'json') throw new Error('This JSON file is not valid. Check it for missing commas or brackets.')
    throw new Error(`This ${from.toUpperCase()} file could not be read. It may be damaged or password-protected.`)
  }
}

export const converters: Converter[] = [
  {
    id: 'spreadsheet.table',
    category: 'spreadsheet',
    from: ['xlsx', 'xls', 'ods', 'csv', 'tsv', 'json'],
    to: ['xlsx', 'ods', 'csv', 'tsv', 'json', 'html'],
    options: (to) => (TEXT_TARGETS.includes(to) ? [SHEET_OPTION] : []),
    async convert({ inputPath, outputPath, from, to, options, onProgress, signal }) {
      const bytes = await readFile(inputPath)
      onProgress(0.2)
      const sheets = readSheets(bytes, from)
      if (sheets.length === 0) throw new Error('This file has no sheets to convert')
      signal.throwIfAborted()
      onProgress(0.5)

      if (to === 'xlsx' || to === 'ods') {
        await writeFile(outputPath, toWorkbookBytes(sheets, to))
      } else if (to === 'html') {
        await writeFile(outputPath, toHtml(sheets), 'utf8')
      } else {
        // Text targets take a single sheet; the option picks which one (1-based).
        const index = Number(options.sheet ?? 1) - 1
        const sheet = sheets[index]
        if (!sheet) throw new Error(`This file has ${sheets.length} sheet(s). Pick a sheet number between 1 and ${sheets.length}.`)
        if (to === 'json') await writeFile(outputPath, toJsonText(sheet.rows), 'utf8')
        else await writeFile(outputPath, stringifyDelimited(sheet.rows, to === 'tsv' ? '\t' : ','), 'utf8')
      }
      onProgress(1)
    }
  }
]
