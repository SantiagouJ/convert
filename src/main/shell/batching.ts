import type { Job } from '@shared/types'

/**
 * Collects file paths arriving in quick succession and flushes them once as a single batch.
 * Explorer launches one process per selected file, so a multi-selection shows up as several
 * "second-instance" events within a few milliseconds.
 */
export class FileBatcher {
  private buffer: string[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly flush: (paths: string[]) => void,
    private readonly delayMs = 500
  ) {}

  add(paths: string[]): void {
    if (paths.length === 0) return
    for (const path of paths) if (!this.buffer.includes(path)) this.buffer.push(path)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      const batch = this.buffer
      this.buffer = []
      this.flush(batch)
    }, this.delayMs)
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.buffer = []
  }
}

export interface BatchSummary {
  total: number
  done: number
  failed: number
  cancelled: number
  /** Output of the first successful job, handy for "reveal". */
  firstOutput?: string
  /** Directory of the first successful output. */
  outputDir?: string
}

const TERMINAL = new Set<Job['status']>(['done', 'error', 'cancelled'])

/**
 * Follows job updates and groups them into batches: a batch starts with the first job after the
 * queue was idle and ends once every job it contains is finished.
 */
export class BatchTracker {
  private jobs = new Map<string, Job>()

  /** Feed every job update. Returns a summary exactly once, when the batch completes. */
  update(job: Job): BatchSummary | null {
    this.jobs.set(job.id, job)
    const all = [...this.jobs.values()]
    if (!all.every((j) => TERMINAL.has(j.status))) return null
    this.jobs = new Map()
    const done = all.filter((j) => j.status === 'done')
    const first = done[0]
    return {
      total: all.length,
      done: done.length,
      failed: all.filter((j) => j.status === 'error').length,
      cancelled: all.filter((j) => j.status === 'cancelled').length,
      firstOutput: first?.outputPath,
      outputDir: first ? first.outputPath.replace(/[\\/][^\\/]*$/, '') : undefined
    }
  }

  /** Overall progress 0..1 of the running batch, or `null` when nothing is active (-> no bar). */
  progress(): number | null {
    const all = [...this.jobs.values()]
    if (all.length === 0) return null
    const sum = all.reduce((acc, j) => acc + (TERMINAL.has(j.status) ? 1 : j.progress), 0)
    return sum / all.length
  }
}

/** Human-readable one-liner for the "batch finished" notification. */
export function describeBatch(summary: BatchSummary): { title: string; body: string } {
  if (summary.failed === 0 && summary.done > 0) {
    return {
      title: 'Conversion finished',
      body: summary.done === 1 ? '1 file converted.' : `${summary.done} files converted.`
    }
  }
  if (summary.done === 0 && summary.failed > 0) {
    return {
      title: 'Conversion failed',
      body: summary.failed === 1 ? 'The file could not be converted.' : `${summary.failed} files could not be converted.`
    }
  }
  return {
    title: 'Conversion finished with problems',
    body: `${summary.done} converted, ${summary.failed} failed.`
  }
}
