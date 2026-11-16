import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { JobQueue } from '../src/main/jobs'
import { findConverter } from '../src/main/registry'
import type { Job } from '@shared/types'
import {
  FIXTURE_MTIME,
  expectSampleSpreadsheet,
  writeZipWithRawName,
  readArchive,
  sampleTree,
  writeSpreadsheetSource,
  writeTar,
  writeZip,
  type FixtureEntry
} from './data/fixtures'

const SHEET_IN = ['xlsx', 'xls', 'ods', 'csv', 'tsv', 'json'] as const
const SHEET_OUT = ['xlsx', 'ods', 'csv', 'tsv', 'json', 'html'] as const
const ARCHIVES = ['zip', 'tar', 'tar.gz'] as const

let dir: string
let queue: JobQueue
let updates: Job[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'convert-data-'))
  updates = []
  queue = new JobQueue({ onUpdate: (job) => updates.push(job) })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Runs one real job through the queue and returns its final state. */
async function convert(input: string, to: string, options?: Record<string, number>): Promise<Job> {
  const [started] = queue.start({ inputs: [input], to, options })
  await queue.idle()
  return queue.list().find((job) => job.id === started.id)!
}

async function makeDir(name: string): Promise<string> {
  const path = join(dir, name)
  await rm(path, { recursive: true, force: true })
  await mkdir(path)
  return path
}

describe('spreadsheet converter', () => {
  for (const from of SHEET_IN) {
    for (const to of SHEET_OUT) {
      if (from === to) continue
      it(`converts ${from} -> ${to}`, async () => {
        const work = await makeDir(`${from}-${to}`)
        const source = await writeSpreadsheetSource(work, from)
        expect(findConverter(from, to)?.id).toBe('spreadsheet.table')

        const job = await convert(source, to)

        expect(job.error).toBeUndefined()
        expect(job.status).toBe('done')
        expect(job.outputPath).toBe(join(work, `people.${to}`))
        await expectSampleSpreadsheet(job.outputPath, to)
      })
    }
  }

  it('exports one sheet of a multi-sheet workbook and keeps all sheets for spreadsheet targets', async () => {
    const source = join(dir, 'book.xlsx')
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['first'], ['1']]), 'One')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['second'], ['2']]), 'Two')
    await writeFile(source, Buffer.from(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' })))

    const second = await convert(source, 'csv', { sheet: 2 })
    expect(second.status).toBe('done')
    expect((await readFile(second.outputPath, 'utf8')).replace('﻿', '')).toBe('second\r\n2\r\n')

    const all = await convert(source, 'ods')
    expect(all.status).toBe('done')
    const reread = XLSX.read(await readFile(all.outputPath), { type: 'buffer' })
    expect(reread.SheetNames).toEqual(['One', 'Two'])
  })

  it('reports a sheet number that does not exist', async () => {
    const source = await writeSpreadsheetSource(dir, 'xlsx')
    const job = await convert(source, 'csv', { sheet: 3 })
    expect(job.status).toBe('error')
    expect(job.error).toMatch(/has 1 sheet/)
    await expect(stat(job.outputPath)).rejects.toThrow()
  })

  it('detects semicolon delimiters and Windows-1252 text', async () => {
    const source = join(dir, 'semi.csv')
    // "café" in Windows-1252: 0xE9 is not valid UTF-8 on its own.
    await writeFile(source, Buffer.from('nombre;ciudad\nAna;Bogotá\nLuis;Medellín\n', 'latin1'))
    const job = await convert(source, 'json')
    expect(job.status).toBe('done')
    expect(JSON.parse(await readFile(job.outputPath, 'utf8'))).toEqual([
      { nombre: 'Ana', ciudad: 'Bogotá' },
      { nombre: 'Luis', ciudad: 'Medellín' }
    ])
  })

  it('keeps leading zeros as text and plain numbers as numbers', async () => {
    const source = join(dir, 'codes.csv')
    await writeFile(source, 'code,qty,price\n007,3,2.50\n10,1e5,-4\n')
    const job = await convert(source, 'json')
    expect(JSON.parse(await readFile(job.outputPath, 'utf8'))).toEqual([
      { code: '007', qty: 3, price: 2.5 },
      { code: 10, qty: '1e5', price: -4 }
    ])
  })

  it('writes dates as ISO strings in JSON', async () => {
    const source = await writeSpreadsheetSource(dir, 'xlsx')
    const job = await convert(source, 'json')
    const [first] = JSON.parse(await readFile(job.outputPath, 'utf8')) as Record<string, string>[]
    expect(first.joined).toBe('2024-01-05T00:00:00.000Z')
  })

  it('explains a JSON file that is not a list of objects', async () => {
    const source = join(dir, 'bad.json')
    await writeFile(source, '{"name": "Ana"}')
    const job = await convert(source, 'csv')
    expect(job.status).toBe('error')
    expect(job.error).toMatch(/list of objects/)
  })

  it('explains invalid JSON and damaged workbooks in plain words', async () => {
    const broken = join(dir, 'broken.json')
    await writeFile(broken, '[{"name": "Ana",}')
    expect((await convert(broken, 'csv')).error).toMatch(/not valid/)

    const damaged = join(dir, 'damaged.xlsx')
    await writeFile(damaged, 'not really a workbook')
    const job = await convert(damaged, 'csv')
    expect(job.status).toBe('error')
    expect(job.error).toMatch(/could not be read/)
  })
})

describe('archive converter', () => {
  for (const from of ARCHIVES) {
    for (const to of ARCHIVES) {
      if (from === to) continue
      it(`repacks ${from} -> ${to} with paths and times kept`, async () => {
        const work = await makeDir(`${from}-${to}`)
        const source = join(work, `bundle.${from}`)
        const entries = sampleTree()
        await writeFixture(source, from, entries)

        const job = await convert(source, to)

        expect(job.error).toBeUndefined()
        expect(job.status).toBe('done')
        expect(job.outputPath).toBe(join(work, `bundle.${to}`))

        const result = await readArchive(job.outputPath, to)
        expect(result.map((entry) => entry.name).sort()).toEqual(expectedNames(entries))
        const file = result.find((entry) => entry.name === 'docs/readme.txt')
        expect(file?.content).toBe('hello archive')
        expect(file?.mtime?.getTime()).toBe(FIXTURE_MTIME.getTime())
        expect(result.find((entry) => entry.name === 'ñandú notes.txt')?.content).toBe('unicode')
        expect(result.find((entry) => entry.name === 'empty/')).toBeDefined()
      })
    }
  }

  it('refuses archives with path traversal entries and leaves no output', async () => {
    const source = join(dir, 'evil.zip')
    await writeZipWithRawName(source, '../escape.txt', 'nope')
    const job = await convert(source, 'tar')
    expect(job.status).toBe('error')
    expect(job.error).toMatch(/unsafe file path/)
    await expect(stat(job.outputPath)).rejects.toThrow()
    await expect(stat(join(dir, '..', 'escape.txt'))).rejects.toThrow()
  })

  it('refuses tar archives with absolute paths', async () => {
    const source = join(dir, 'absolute.tar')
    await writeTar(source, [{ name: '/etc/evil', content: 'nope' }])
    const job = await convert(source, 'zip')
    expect(job.status).toBe('error')
    expect(job.error).toMatch(/unsafe file path/)
  })

  it('skips symlinks because they cannot be stored portably', async () => {
    const source = join(dir, 'links.tar')
    await writeTar(source, [
      { name: 'real.txt', content: 'kept' },
      { name: 'link', symlink: 'real.txt' }
    ])
    const job = await convert(source, 'zip')
    expect(job.status).toBe('done')
    const result = await readArchive(job.outputPath, 'zip')
    expect(result.map((entry) => entry.name)).toEqual(['real.txt'])
  })

  it('reports an archive that cannot be read', async () => {
    const source = join(dir, 'fake.zip')
    await writeFile(source, 'definitely not a zip file')
    const job = await convert(source, 'tar')
    expect(job.status).toBe('error')
    expect(job.error).toMatch(/could not be read/)
  })

  it('reads a tar archive produced by another tool (tar.gz to zip)', async () => {
    const source = join(dir, 'gz-input.tgz')
    await writeTar(source, [{ name: 'a.txt', content: 'alpha' }], true)
    const job = await convert(source, 'zip')
    expect(job.status).toBe('done')
    expect(job.outputPath).toBe(join(dir, 'gz-input.zip'))
    const result = await readArchive(job.outputPath, 'zip')
    expect(result).toEqual([expect.objectContaining({ name: 'a.txt', content: 'alpha' })])
  })

  it('does not offer folder extraction or gzip-only conversions', () => {
    expect(findConverter('zip', 'gz')).toBeUndefined()
    expect(findConverter('tar.gz', 'gz')).toBeUndefined()
    expect(findConverter('zip', 'rar')).toBeUndefined()
    expect(findConverter('7z', 'zip')).toBeUndefined()
  })
})

/** Builds a fixture in the requested archive format. */
async function writeFixture(path: string, format: 'zip' | 'tar' | 'tar.gz', entries: FixtureEntry[]): Promise<void> {
  if (format === 'zip') await writeZip(path, entries)
  else await writeTar(path, entries, format === 'tar.gz')
}

function expectedNames(entries: FixtureEntry[]): string[] {
  return entries.map((entry) => (entry.directory ? `${entry.name}/` : entry.name)).sort()
}
