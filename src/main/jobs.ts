import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { extOf, normalizeExt } from '@shared/formats'
import type { Converter, Job, OptionValues, StartJobsRequest } from '@shared/types'
import { findConverter, resolveOptions } from './registry'

interface Entry {
  job: Job
  converter: Converter
  options: OptionValues
  controller: AbortController
}

export interface JobQueueOptions {
  concurrency?: number
  onUpdate?: (job: Job) => void
}

/** File name without its (possibly compound) extension. */
function stem(path: string): string {
  const name = basename(path)
  const ext = extOf(name)
  if (!ext) return name
  // The on-disk extension may be an alias (`.jpeg`, `.tgz`): try the compound length first and keep the dots that normalize to `ext`.
  const parts = name.split('.')
  for (const dots of [2, 1]) {
    if (parts.length > dots && normalizeExt(parts.slice(-dots).join('.')) === ext) {
      return parts.slice(0, -dots).join('.')
    }
  }
  return name
}

export class JobQueue {
  private readonly entries = new Map<string, Entry>()
  private readonly pending: string[] = []
  private readonly reserved = new Set<string>()
  private running = 0
  private readonly concurrency: number
  private readonly onUpdate: (job: Job) => void

  constructor(options: JobQueueOptions = {}) {
    this.concurrency = options.concurrency ?? 2
    this.onUpdate = options.onUpdate ?? (() => {})
  }

  list(): Job[] {
    return [...this.entries.values()].map((entry) => ({ ...entry.job }))
  }

  /** Queues one job per input. Throws when an input has no converter for the target. */
  start(request: StartJobsRequest): Job[] {
    const to = normalizeExt(request.to)
    const planned = request.inputs.map((inputPath) => {
      const from = extOf(inputPath)
      const converter = findConverter(from, to)
      if (!converter) throw new Error(`No converter for .${from || '?'} -> .${to}`)
      return { inputPath, from, converter }
    })

    const jobs: Job[] = []
    for (const { inputPath, from, converter } of planned) {
      const directory = request.outputDir ?? dirname(inputPath)
      const isDirectory = converter.outputKind?.(from, to) === 'directory'
      const outputPath = this.freeOutputPath(directory, stem(inputPath), isDirectory ? '' : to)
      const job: Job = {
        id: randomUUID(),
        inputPath,
        outputPath,
        from,
        to,
        status: 'queued',
        progress: 0
      }
      this.entries.set(job.id, {
        job,
        converter,
        options: resolveOptions(converter.options?.(to) ?? [], request.options),
        controller: new AbortController()
      })
      this.pending.push(job.id)
      jobs.push({ ...job })
      this.emit(job)
    }
    this.pump()
    return jobs
  }

  cancel(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    if (entry.job.status === 'queued') {
      this.pending.splice(this.pending.indexOf(id), 1)
      this.reserved.delete(entry.job.outputPath)
      entry.job.status = 'cancelled'
      this.emit(entry.job)
    } else if (entry.job.status === 'running') {
      entry.controller.abort()
    }
  }

  cancelAll(): void {
    for (const id of [...this.entries.keys()]) this.cancel(id)
  }

  /** Resolves once nothing is queued or running. */
  async idle(): Promise<void> {
    while (this.running > 0 || this.pending.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  /** Never overwrite: `name.ext`, then `name (1).ext`, `name (2).ext`... */
  private freeOutputPath(directory: string, name: string, ext: string): string {
    const suffix = ext ? `.${ext}` : ''
    for (let n = 0; ; n++) {
      const candidate = join(directory, n === 0 ? `${name}${suffix}` : `${name} (${n})${suffix}`)
      if (!this.reserved.has(candidate) && !existsSync(candidate)) {
        this.reserved.add(candidate)
        return candidate
      }
    }
  }

  private emit(job: Job): void {
    this.onUpdate({ ...job })
  }

  private pump(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const id = this.pending.shift()!
      void this.run(this.entries.get(id)!)
    }
  }

  private async run(entry: Entry): Promise<void> {
    const { job, converter, controller } = entry
    this.running++
    job.status = 'running'
    this.emit(job)

    let lastEmit = 0
    try {
      await mkdir(dirname(job.outputPath), { recursive: true })
      await converter.convert({
        inputPath: job.inputPath,
        outputPath: job.outputPath,
        from: job.from,
        to: job.to,
        options: entry.options,
        signal: controller.signal,
        onProgress: (fraction) => {
          if (job.status !== 'running') return
          job.progress = Math.min(1, Math.max(job.progress, fraction || 0))
          const now = Date.now()
          if (now - lastEmit >= 80) {
            lastEmit = now
            this.emit(job)
          }
        }
      })
      if (controller.signal.aborted) throw new Error('cancelled')
      job.progress = 1
      job.status = 'done'
    } catch (error) {
      await rm(job.outputPath, { recursive: true, force: true }).catch(() => {})
      if (controller.signal.aborted) {
        job.status = 'cancelled'
      } else {
        job.status = 'error'
        job.error = error instanceof Error ? error.message : String(error)
      }
    } finally {
      this.reserved.delete(job.outputPath)
      this.running--
      this.emit(job)
      this.pump()
    }
  }
}
