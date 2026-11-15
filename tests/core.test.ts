import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extOf, formatInfo, normalizeExt } from '@shared/formats'
import type { Job } from '@shared/types'
import { JobQueue } from '../src/main/jobs'
import { allConverters, findConverter, targetsForFiles } from '../src/main/registry'
import { parseCues, toSrt, toVtt } from '../src/main/converters/subtitle'

const SRT = `1
00:00:01,000 --> 00:00:02,500
Hello

2
00:01:00,000 --> 00:01:03,250
Second <i>line</i>
with a break
`

describe('formats', () => {
  it('normalizes extensions and aliases', () => {
    expect(normalizeExt('.JPEG')).toBe('jpg')
    expect(extOf('C:\\a\\photo.final.TIF')).toBe('tiff')
    expect(extOf('/tmp/backup.tar.gz')).toBe('tar.gz')
    expect(extOf('Makefile')).toBe('')
    expect(extOf('.gitignore')).toBe('')
  })
})

describe('registry', () => {
  it('only registers converters whose formats are in the catalog', () => {
    expect(allConverters().length).toBeGreaterThan(0)
    const ids = allConverters().map((converter) => converter.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const converter of allConverters()) {
      for (const ext of [...converter.from, ...converter.to]) {
        expect(formatInfo(ext), `${converter.id}: "${ext}" missing from src/shared/formats.ts`).toBeDefined()
        expect(normalizeExt(ext), `${converter.id}: "${ext}" is not normalized`).toBe(ext)
      }
    }
  })

  it('finds converters and never offers identity conversions', () => {
    expect(findConverter('SRT', '.vtt')?.id).toBe('subtitle.text')
    expect(findConverter('srt', 'srt')).toBeUndefined()
    expect(targetsForFiles(['a.srt']).map((target) => target.format.ext)).toEqual(['vtt', 'txt'])
  })

  it('offers only targets common to every selected file', () => {
    expect(targetsForFiles(['a.srt', 'b.vtt']).map((target) => target.format.ext)).toEqual(['txt'])
    expect(targetsForFiles(['a.srt', 'noext'])).toEqual([])
    expect(targetsForFiles([])).toEqual([])
  })
})

describe('subtitle converter', () => {
  it('round-trips SRT through WebVTT', () => {
    const cues = parseCues(SRT)
    expect(cues).toHaveLength(2)
    expect(cues[1]).toMatchObject({ start: 60_000, end: 63_250 })
    expect(toVtt(cues)).toContain('WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello')
    expect(toSrt(parseCues(toVtt(cues)))).toBe(SRT)
  })

  it('parses WebVTT short timestamps', () => {
    expect(parseCues('WEBVTT\n\n01:02.5 --> 01:04.000\nHi')[0]).toMatchObject({ start: 62_500, end: 64_000 })
  })
})

describe('job queue', () => {
  let dir: string
  let updates: Job[]
  let queue: JobQueue

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'convert-test-'))
    updates = []
    queue = new JobQueue({ onUpdate: (job) => updates.push(job) })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('converts next to the input without overwriting existing files', async () => {
    const input = join(dir, 'movie.srt')
    await writeFile(input, SRT)
    await writeFile(join(dir, 'movie.vtt'), 'keep me')

    const [first, second] = queue.start({ inputs: [input, input], to: 'vtt' })
    await queue.idle()

    expect(first.outputPath).toBe(join(dir, 'movie (1).vtt'))
    expect(second.outputPath).toBe(join(dir, 'movie (2).vtt'))
    expect(await readFile(join(dir, 'movie.vtt'), 'utf8')).toBe('keep me')
    expect(await readFile(first.outputPath, 'utf8')).toContain('WEBVTT')
    expect(queue.list().every((job) => job.status === 'done' && job.progress === 1)).toBe(true)
    expect(updates.at(-1)?.status).toBe('done')
  })

  it('reports failures and leaves no partial output', async () => {
    const input = join(dir, 'empty.srt')
    await writeFile(input, 'not a subtitle')

    const [job] = queue.start({ inputs: [input], to: 'vtt' })
    await queue.idle()

    const result = queue.list()[0]
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/No subtitle cues/)
    expect(existsSync(job.outputPath)).toBe(false)
  })

  it('rejects unsupported conversions before queueing anything', () => {
    expect(() => queue.start({ inputs: [join(dir, 'a.srt'), join(dir, 'b.xyz')], to: 'vtt' })).toThrow(
      /No converter/
    )
    expect(queue.list()).toEqual([])
  })

  it('cancels queued jobs', async () => {
    const serial = new JobQueue({ concurrency: 1 })
    const input = join(dir, 'a.srt')
    await writeFile(input, SRT)
    const jobs = serial.start({ inputs: [input, input, input], to: 'txt' })
    serial.cancel(jobs[2].id)
    await serial.idle()
    expect(serial.list().map((job) => job.status)).toEqual(['done', 'done', 'cancelled'])
    expect(existsSync(jobs[2].outputPath)).toBe(false)
  })
})
