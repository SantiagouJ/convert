import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JobQueue } from '../../src/main/jobs'
import { runFfmpeg } from '../../src/main/lib/ffmpeg'
import type { OptionValues } from '../../src/shared/types'

export async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'convert-media-'))
}

export const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })

const signal = new AbortController().signal

export async function ffmpeg(args: string[]): Promise<void> {
  await runFfmpeg(['-y', ...args], { signal })
}

/** Passes only when ffmpeg can fully decode the file. Returns its size. */
export async function expectDecodes(path: string): Promise<number> {
  await ffmpeg(['-i', path, '-f', 'null', '-'])
  return (await stat(path)).size
}

/** Runs one conversion through the real queue; returns the final job. */
export async function convertWithQueue(input: string, to: string, options?: OptionValues) {
  const queue = new JobQueue({ concurrency: 4 })
  const [job] = queue.start({ inputs: [input], to, options })
  await queue.idle()
  return { job: queue.list()[0], outputPath: job.outputPath }
}

/** Tiny source clips (lavfi) per container. */
export const VIDEO_CODECS: Record<string, string[]> = {
  mp4: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'],
  mov: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'],
  mkv: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'],
  webm: ['-c:v', 'libvpx', '-b:v', '200k', '-c:a', 'libvorbis'],
  avi: ['-c:v', 'mpeg4', '-c:a', 'libmp3lame'],
  wmv: ['-c:v', 'wmv2', '-c:a', 'wmav2']
}

export async function makeVideo(path: string, seconds = 1, size = '96x64'): Promise<void> {
  const ext = path.split('.').pop()!
  await ffmpeg([
    '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=12:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    ...VIDEO_CODECS[ext], '-shortest', path
  ])
}
