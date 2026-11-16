import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JobQueue } from '../src/main/jobs'
import { liveFfmpegCount } from '../src/main/lib/ffmpeg'
import { audioEncodeArgs } from '../src/main/converters/audio'
import { findConverter, targetsForExt } from '../src/main/registry'
import type { Job } from '../src/shared/types'
import { convertWithQueue, expectDecodes, ffmpeg, makeVideo, removeDir, tempDir } from './media/helpers'

let dir: string
beforeAll(async () => {
  dir = await tempDir()
})
afterAll(async () => {
  await removeDir(dir)
})

const IMAGE_IN = ['jpg', 'png', 'webp', 'tiff', 'gif', 'svg', 'avif', 'bmp', 'ico']
const IMAGE_OUT = ['jpg', 'png', 'webp', 'avif', 'tiff', 'bmp', 'gif', 'ico']
const AUDIO = ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aiff', 'wma']
const VIDEO = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'wmv']

function pairs(from: string[], to: string[]): [string, string][] {
  return from.flatMap((a) => to.filter((b) => b !== a).map((b): [string, string] => [a, b]))
}

describe('images', () => {
  const sources = new Map<string, string>()

  beforeAll(async () => {
    const base = sharp({ create: { width: 40, height: 30, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 0.5 } } })
    const png = await base.clone().png().toBuffer()
    for (const ext of ['jpg', 'png', 'webp', 'tiff', 'gif', 'avif']) {
      const path = join(dir, `src.${ext}`)
      await sharp(png).toFormat(ext === 'jpg' ? 'jpeg' : (ext as 'png')).toFile(path)
      sources.set(ext, path)
    }
    const svg = join(dir, 'src.svg')
    await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="red"/></svg>')
    sources.set('svg', svg)
    for (const ext of ['bmp', 'ico']) {
      const path = join(dir, `src.${ext}`)
      await writeFile(join(dir, 'tmp.png'), png)
      await ffmpeg(['-i', join(dir, 'tmp.png'), ...(ext === 'bmp' ? ['-pix_fmt', 'bgr24'] : []), path])
      sources.set(ext, path)
    }
  })

  it.each(pairs(IMAGE_IN, IMAGE_OUT))('%s -> %s', async (from, to) => {
    expect(findConverter(from, to)?.id).toBe('image.sharp')
    const { job, outputPath } = await convertWithQueue(sources.get(from)!, to)
    expect(job.error).toBeUndefined()
    expect(job.status).toBe('done')
    if (to === 'bmp' || to === 'ico') {
      await expectDecodes(outputPath)
      const head = (await readFile(outputPath)).subarray(0, 4)
      expect(to === 'bmp' ? head.toString('latin1', 0, 2) : head.readUInt16LE(2)).toBe(to === 'bmp' ? 'BM' : 1)
    } else {
      const meta = await sharp(outputPath).metadata()
      expect(meta.format).toBe(to === 'jpg' ? 'jpeg' : to === 'avif' ? 'heif' : to)
      expect(meta.width).toBeGreaterThan(0)
    }
  })

  it('flattens transparency onto white for jpg', async () => {
    const { outputPath } = await convertWithQueue(join(dir, 'src.png'), 'jpg', { quality: 90 })
    const { data } = await sharp(outputPath).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true })
    // 50% red over white is a light red, never dark/black.
    expect(data[0]).toBeGreaterThan(200)
    expect(data[1]).toBeGreaterThan(100)
  })

  it('does not offer HEIC, which this sharp build cannot decode', () => {
    expect(targetsForExt('heic')).toEqual([])
  })

  it('fails clearly on a corrupt image and leaves no output', async () => {
    const bad = join(dir, 'bad.png')
    await writeFile(bad, 'nope')
    const { job, outputPath } = await convertWithQueue(bad, 'jpg')
    expect(job.status).toBe('error')
    expect(job.error).toMatch(/could not be read/)
    expect(existsSync(outputPath)).toBe(false)
  })
})

describe('audio', () => {
  const sources = new Map<string, string>()

  beforeAll(async () => {
    for (const ext of AUDIO) {
      const path = join(dir, `src.${ext}`)
      await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...audioEncodeArgs(ext, 128), path])
      sources.set(ext, path)
    }
  })

  it.each(pairs(AUDIO, AUDIO))('%s -> %s', async (from, to) => {
    expect(findConverter(from, to)?.id).toBe('audio.ffmpeg')
    const { job, outputPath } = await convertWithQueue(sources.get(from)!, to)
    expect(job.error).toBeUndefined()
    expect(job.status).toBe('done')
    expect(await expectDecodes(outputPath)).toBeGreaterThan(500)
  })

  it('honors the bitrate option', async () => {
    const low = await convertWithQueue(sources.get('wav')!, 'mp3', { bitrate: '96' })
    const high = await convertWithQueue(sources.get('wav')!, 'mp3', { bitrate: '320' })
    expect((await readFile(high.outputPath)).length).toBeGreaterThan((await readFile(low.outputPath)).length)
  })
})

describe('video', () => {
  const sources = new Map<string, string>()

  beforeAll(async () => {
    for (const ext of VIDEO) {
      const path = join(dir, `src.${ext}`)
      await makeVideo(path)
      sources.set(ext, path)
    }
  })

  it.each(pairs(VIDEO, [...VIDEO, 'gif', 'mp3', 'm4a', 'wav']))('%s -> %s', async (from, to) => {
    expect(findConverter(from, to)?.id).toBe('video.ffmpeg')
    const { job, outputPath } = await convertWithQueue(sources.get(from)!, to)
    expect(job.error).toBeUndefined()
    expect(job.status).toBe('done')
    expect(await expectDecodes(outputPath)).toBeGreaterThan(500)
  })

  it('caps height without upscaling', async () => {
    const small = await convertWithQueue(sources.get('mp4')!, 'mkv', { maxHeight: 32 })
    const tall = await convertWithQueue(sources.get('mp4')!, 'mkv', { maxHeight: 4000 })
    const probe = async (path: string) => {
      await ffmpeg(['-i', path, '-frames:v', '1', join(dir, 'probe.png')])
      return (await sharp(join(dir, 'probe.png')).metadata()).height
    }
    expect(await probe(small.outputPath)).toBe(32)
    expect(await probe(tall.outputPath)).toBe(64)
  })

  it('makes an animated gif', async () => {
    const { outputPath } = await convertWithQueue(sources.get('mp4')!, 'gif')
    const meta = await sharp(outputPath, { animated: true }).metadata()
    expect(meta.pages).toBeGreaterThan(1)
  })

  it('reports progress while converting', async () => {
    const long = join(dir, 'long-progress.mp4')
    await makeVideo(long, 8, '320x240')
    const updates: Job[] = []
    const queue = new JobQueue({ onUpdate: (job) => updates.push(job) })
    queue.start({ inputs: [long], to: 'mkv', options: { quality: 'high' } })
    await queue.idle()
    const values = updates.map((job) => job.progress)
    expect(values.some((p) => p > 0 && p < 1)).toBe(true)
    expect(values.at(-1)).toBe(1)
  })

  it('cancelling leaves no output file and no ffmpeg process', async () => {
    const long = join(dir, 'long-cancel.mp4')
    await makeVideo(long, 90, '640x360')
    const queue = new JobQueue({ concurrency: 1 })
    const [job] = queue.start({ inputs: [long], to: 'webm', options: { quality: 'high' } })
    while (liveFfmpegCount() === 0) await new Promise((r) => setTimeout(r, 20))
    await new Promise((r) => setTimeout(r, 400))
    expect(existsSync(job.outputPath)).toBe(true) // partial output exists while running
    queue.cancel(job.id)
    await queue.idle()
    expect(queue.list()[0].status).toBe('cancelled')
    expect(existsSync(job.outputPath)).toBe(false)
    expect(liveFfmpegCount()).toBe(0)
  })
})
