import { createWriteStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import * as tar from 'tar-stream'
import yauzl from 'yauzl'
import yazl from 'yazl'
import * as XLSX from 'xlsx'
import { expect } from 'vitest'

/** Helpers that build small source files at test time and read conversion results back. */

export const SAMPLE_HEADER = ['name', 'age', 'joined', 'note']
export const SAMPLE_JOINED = new Date('2024-01-05T00:00:00.000Z')

/** Rows as spreadsheets see them: real numbers and real dates for binary formats. */
export function sampleRows(): (string | number | Date)[][] {
  return [
    SAMPLE_HEADER,
    ['Ana', 31, SAMPLE_JOINED, 'café'],
    ['Luis', 27, new Date('2023-06-30T00:00:00.000Z'), 'ok']
  ]
}

/** Writes a sample spreadsheet in the given format and returns its path. */
export async function writeSpreadsheetSource(dir: string, ext: string): Promise<string> {
  const path = join(dir, `people.${ext}`)
  if (ext === 'xlsx' || ext === 'xls' || ext === 'ods') {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sampleRows(), { cellDates: true }), 'People')
    await writeFile(path, Buffer.from(XLSX.write(workbook, { bookType: ext, type: 'buffer' })))
  } else if (ext === 'csv' || ext === 'tsv') {
    const delimiter = ext === 'tsv' ? '\t' : ','
    const lines = [
      SAMPLE_HEADER,
      ['Ana', '31', '2024-01-05T00:00:00.000Z', 'café'],
      ['Luis', '27', '2023-06-30T00:00:00.000Z', 'ok']
    ].map((line) => line.map((cell) => (cell.includes(delimiter) ? `"${cell}"` : cell)).join(delimiter))
    await writeFile(path, '﻿' + lines.join('\r\n') + '\r\n', 'utf8')
  } else if (ext === 'json') {
    const records = [
      { name: 'Ana', age: 31, joined: '2024-01-05T00:00:00.000Z', note: 'café' },
      { name: 'Luis', age: 27, joined: '2023-06-30T00:00:00.000Z', note: 'ok' }
    ]
    await writeFile(path, JSON.stringify(records), 'utf8')
  } else {
    throw new Error(`no sample writer for ${ext}`)
  }
  return path
}

/** Reads a spreadsheet written by Convert and checks it holds the sample data. */
export async function expectSampleSpreadsheet(path: string, ext: string): Promise<void> {
  if (ext === 'csv' || ext === 'tsv' || ext === 'html') {
    const text = await readFile(path, 'utf8')
    if (ext === 'html') {
      expect(text).toContain('Ana')
      expect(text).toContain('café')
      expect(text).toContain('2024-01-05')
      return
    }
    expect(text.startsWith('﻿'), 'UTF-8 BOM').toBe(true)
    const delimiter = ext === 'tsv' ? '\t' : ','
    const records = parseLines(text.slice(1), delimiter)
    expect(records[0]).toEqual(SAMPLE_HEADER)
    expect(records[1]).toEqual(['Ana', '31', '2024-01-05T00:00:00.000Z', 'café'])
    return
  }
  if (ext === 'json') {
    const records = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>[]
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ name: 'Ana', age: 31, note: 'café' })
    expect(String(records[0].joined)).toContain('2024-01-05')
    return
  }
  // xlsx, xls, ods
  const workbook = XLSX.read(await readFile(path), { type: 'buffer', cellDates: true })
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: true })
  expect(rows[0]).toEqual(SAMPLE_HEADER)
  expect(rows[1][0]).toBe('Ana')
  expect(rows[1][1]).toBe(31)
  expect(cellText(rows[1][2])).toContain('2024-01-05')
  expect(rows[1][3]).toBe('café')
}

function cellText(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

/** Minimal RFC 4180 line splitter for the fixtures above (no embedded newlines). */
function parseLines(text: string, delimiter: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line !== '')
    .map((line) => line.split(delimiter).map((cell) => cell.replace(/^"(.*)"$/, '$1')))
}

export interface FixtureEntry {
  name: string
  /** Text content of a file entry. */
  content?: string
  directory?: boolean
  /** Symlink target; the entry is a symlink when set. */
  symlink?: string
  mtime?: Date
}

export const FIXTURE_MTIME = new Date('2020-02-03T04:05:06.000Z')

/** A small tree that exercises nested folders, unicode, empty folders and long names. */
export function sampleTree(): FixtureEntry[] {
  return [
    { name: 'docs', directory: true, mtime: FIXTURE_MTIME },
    { name: 'docs/readme.txt', content: 'hello archive', mtime: FIXTURE_MTIME },
    { name: 'docs/nested/deep.txt', content: 'deep', mtime: FIXTURE_MTIME },
    { name: 'empty', directory: true, mtime: FIXTURE_MTIME },
    { name: 'ñandú notes.txt', content: 'unicode', mtime: FIXTURE_MTIME },
    { name: `long/${'x'.repeat(120)}.txt`, content: 'long', mtime: FIXTURE_MTIME }
  ]
}

/**
 * A zip whose single entry is named `rawName`. yazl refuses names such as
 * `../x`, so a placeholder of the same length is written and swapped in the bytes.
 */
export async function writeZipWithRawName(path: string, rawName: string, content: string): Promise<void> {
  const placeholder = 'a'.repeat(rawName.length)
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from(content), placeholder, { mtime: FIXTURE_MTIME })
  zip.end()
  const chunks: Buffer[] = []
  for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer)
  const bytes = Buffer.concat(chunks).toString('latin1').split(placeholder).join(rawName)
  await writeFile(path, Buffer.from(bytes, 'latin1'))
}

export async function writeZip(path: string, entries: FixtureEntry[]): Promise<void> {
  const zip = new yazl.ZipFile()
  for (const entry of entries) {
    if (entry.directory) zip.addEmptyDirectory(entry.name, { mtime: entry.mtime ?? FIXTURE_MTIME })
    else zip.addBuffer(Buffer.from(entry.content ?? ''), entry.name, { mtime: entry.mtime ?? FIXTURE_MTIME })
  }
  zip.end()
  await pipeTo(zip.outputStream, path)
}

export async function tarBuffer(entries: FixtureEntry[]): Promise<Buffer> {
  const pack = tar.pack()
  const chunks: Buffer[] = []
  pack.on('data', (chunk: unknown) => chunks.push(chunk as Buffer))
  const finished = new Promise<void>((resolve, reject) => {
    pack.on('end', resolve)
    pack.on('error', reject)
  })
  for (const entry of entries) {
    const mtime = entry.mtime ?? FIXTURE_MTIME
    if (entry.symlink !== undefined) {
      await new Promise<void>((resolve, reject) =>
        pack.entry({ name: entry.name, type: 'symlink', linkname: entry.symlink, mtime }, (error) =>
          error ? reject(error) : resolve()
        )
      )
    } else if (entry.directory) {
      await new Promise<void>((resolve, reject) =>
        pack.entry({ name: `${entry.name}/`, type: 'directory', mtime }, (error) => (error ? reject(error) : resolve()))
      )
    } else {
      const content = Buffer.from(entry.content ?? '')
      await new Promise<void>((resolve, reject) => {
        const stream = pack.entry({ name: entry.name, size: content.length, mtime }, (error) =>
          error ? reject(error) : resolve()
        )
        stream.end(content)
      })
    }
  }
  pack.finalize()
  await finished
  return Buffer.concat(chunks)
}

export async function writeTar(path: string, entries: FixtureEntry[], gzipped = false): Promise<void> {
  const bytes = await tarBuffer(entries)
  await writeFile(path, gzipped ? gzipSync(bytes) : bytes)
}

export interface ReadEntry {
  /** Name with a trailing slash for folders. */
  name: string
  content?: string
  mtime?: Date
}

/** Lists the entries of a zip, tar or tar.gz file, with contents and modification times. */
export async function readArchive(path: string, format: 'zip' | 'tar' | 'tar.gz'): Promise<ReadEntry[]> {
  if (format === 'zip') return readZipEntries(path)
  const raw = await readFile(path)
  return readTarEntries(format === 'tar.gz' ? gunzipSync(raw) : raw)
}

function readZipEntries(path: string): Promise<ReadEntry[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, decodeStrings: true }, (openError, zip) => {
      if (openError || !zip) return reject(openError)
      const entries: ReadEntry[] = []
      zip.on('error', reject)
      zip.on('end', () => resolve(entries))
      zip.on('entry', (entry: yauzl.Entry) => {
        const mtime = entry.getLastModDate()
        if (entry.fileName.endsWith('/')) {
          entries.push({ name: entry.fileName, mtime })
          zip.readEntry()
          return
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return reject(error)
          const chunks: Buffer[] = []
          stream.on('data', (chunk: unknown) => chunks.push(chunk as Buffer))
          stream.on('end', () => {
            entries.push({ name: entry.fileName, content: Buffer.concat(chunks).toString('utf8'), mtime })
            zip.readEntry()
          })
        })
      })
      zip.readEntry()
    })
  })
}

function readTarEntries(bytes: Buffer): Promise<ReadEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: ReadEntry[] = []
    const extract = tar.extract()
    extract.on('entry', (header, stream, next) => {
      const chunks: Buffer[] = []
      stream.on('data', (chunk: unknown) => chunks.push(chunk as Buffer))
      stream.on('end', () => {
        const isDirectory = header.type === 'directory'
        entries.push({
          name: isDirectory ? `${header.name.replace(/\/$/, '')}/` : header.name,
          content: isDirectory ? undefined : Buffer.concat(chunks).toString('utf8'),
          mtime: header.mtime ?? undefined
        })
        next()
      })
    })
    extract.on('finish', () => resolve(entries))
    extract.on('error', reject)
    extract.end(bytes)
  })
}

function pipeTo(source: NodeJS.ReadableStream, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(path)
    source.pipe(out)
    out.on('finish', () => resolve())
    out.on('error', reject)
  })
}
