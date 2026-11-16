import { spawn } from 'node:child_process'
import ffmpegStatic from 'ffmpeg-static'

/** Resolves the bundled ffmpeg; inside a packaged app the binary lives in app.asar.unpacked. */
export function ffmpegPath(): string {
  if (!ffmpegStatic) throw new Error('The media engine is not available on this system')
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
}

export interface RunOptions {
  signal: AbortSignal
  /** Total duration in seconds, enables progress reporting. */
  durationSec?: number
  onProgress?: (fraction: number) => void
  /** Piped to ffmpeg's stdin. */
  stdin?: Buffer
}

function parseClock(text: string): number {
  const m = /(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0
}

/** Duration in seconds read from `ffmpeg -i` output, or 0 when unknown. */
export async function probeDuration(inputPath: string, signal: AbortSignal): Promise<number> {
  const { stderr } = await run(['-hide_banner', '-i', inputPath], { signal }, true)
  const m = /Duration:\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(stderr)
  return m ? parseClock(m[1]) : 0
}

const live = new Set<number>()

/** Number of ffmpeg processes this app currently has running (used by tests to catch orphans). */
export function liveFfmpegCount(): number {
  return live.size
}

interface Result {
  stderr: string
}

function run(args: string[], opts: RunOptions, allowFailure = false): Promise<Result> {
  return new Promise((resolve, reject) => {
    if (opts.signal.aborted) return reject(new Error('cancelled'))
    const child = spawn(ffmpegPath(), args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    if (child.pid) live.add(child.pid)
    let stderr = ''
    let buffer = ''
    const kill = (): void => {
      child.kill('SIGKILL')
    }
    opts.signal.addEventListener('abort', kill, { once: true })

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line)
        if (m && opts.durationSec && opts.onProgress) {
          // Both out_time_us and out_time_ms are reported in microseconds.
          opts.onProgress(Math.min(0.99, Number(m[1]) / 1e6 / opts.durationSec))
        }
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-20_000)
    })
    child.stdin.on('error', () => {})
    if (opts.stdin) child.stdin.end(opts.stdin)
    else child.stdin.end()

    child.on('error', (error) => {
      if (child.pid) live.delete(child.pid)
      opts.signal.removeEventListener('abort', kill)
      reject(error)
    })
    child.on('close', (code) => {
      if (child.pid) live.delete(child.pid)
      opts.signal.removeEventListener('abort', kill)
      if (opts.signal.aborted) return reject(new Error('cancelled'))
      if (code === 0 || allowFailure) return resolve({ stderr })
      reject(new Error(friendlyError(stderr)))
    })
  })
}

function friendlyError(stderr: string): string {
  if (/Invalid data found|moov atom not found|does not contain any stream/i.test(stderr)) {
    return 'This file looks damaged or is not a valid media file'
  }
  if (/No such file|Permission denied/i.test(stderr)) return 'The file could not be read'
  return 'The conversion failed'
}

/** Runs ffmpeg with `-progress pipe:1`. Rejects with a user-friendly Error; kills the process on abort. */
export async function runFfmpeg(args: string[], opts: RunOptions): Promise<void> {
  await run(['-hide_banner', ...(opts.stdin ? [] : ['-nostdin']), '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', ...args], opts)
}
