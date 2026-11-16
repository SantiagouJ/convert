import type { Job } from '@shared/types'

export const isActive = (job: Job): boolean => job.status === 'queued' || job.status === 'running'

export interface QueueState {
  /** Visible jobs in arrival order. */
  jobs: Job[]
  /** Ids the user cleared; later snapshots and updates for them are ignored. */
  hidden: string[]
  /** Batch number of each job. 0 means "from before this view started". */
  batchOf: Record<string, number>
  /** Number of batches started from this view. */
  batches: number
}

export type QueueAction =
  | { type: 'snapshot'; jobs: Job[] }
  | { type: 'update'; job: Job }
  /** `startJobs` resolved: these ids form one batch. */
  | { type: 'batch'; ids: string[] }
  | { type: 'clear-finished' }

export function initialQueue(hidden: string[] = []): QueueState {
  return { jobs: [], hidden, batchOf: {}, batches: 0 }
}

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'snapshot': {
      const known = new Set(state.jobs.map((job) => job.id))
      const fresh = action.jobs.filter((job) => !known.has(job.id) && !state.hidden.includes(job.id))
      if (fresh.length === 0) return state
      const batchOf = { ...state.batchOf }
      for (const job of fresh) batchOf[job.id] ??= 0
      // Snapshot jobs are older than anything that arrived through updates.
      return { ...state, jobs: [...fresh, ...state.jobs], batchOf }
    }
    case 'update': {
      const { job } = action
      if (state.hidden.includes(job.id)) return state
      const index = state.jobs.findIndex((item) => item.id === job.id)
      if (index === -1) {
        // Updates can arrive before `startJobs` resolves; file them under the upcoming batch.
        return {
          ...state,
          jobs: [...state.jobs, job],
          batchOf: { ...state.batchOf, [job.id]: state.batchOf[job.id] ?? state.batches + 1 }
        }
      }
      const jobs = [...state.jobs]
      jobs[index] = job
      return { ...state, jobs }
    }
    case 'batch': {
      const batches = state.batches + 1
      const batchOf = { ...state.batchOf }
      for (const id of action.ids) batchOf[id] = batches
      return { ...state, batchOf, batches }
    }
    case 'clear-finished': {
      const finished = state.jobs.filter((job) => !isActive(job)).map((job) => job.id)
      if (finished.length === 0) return state
      return {
        ...state,
        jobs: state.jobs.filter(isActive),
        hidden: [...state.hidden, ...finished]
      }
    }
  }
}

/** Jobs for display: newest batch first, original order inside a batch. */
export function orderedJobs(state: QueueState): Job[] {
  return state.jobs
    .map((job, index) => ({ job, index, batch: state.batchOf[job.id] ?? 0 }))
    .sort((a, b) => b.batch - a.batch || a.index - b.index)
    .map((entry) => entry.job)
}

/** Jobs of the most recent batch that still has visible jobs. */
export function latestBatch(state: QueueState): Job[] {
  if (state.jobs.length === 0) return []
  const latest = Math.max(...state.jobs.map((job) => state.batchOf[job.id] ?? 0))
  return state.jobs.filter((job) => (state.batchOf[job.id] ?? 0) === latest)
}

export interface JobSummary {
  total: number
  queued: number
  running: number
  done: number
  error: number
  cancelled: number
  /** queued + running */
  active: number
  /** 0..1 across every job that was not cancelled. */
  progress: number
}

export function summarize(jobs: readonly Job[]): JobSummary {
  const summary: JobSummary = {
    total: jobs.length,
    queued: 0,
    running: 0,
    done: 0,
    error: 0,
    cancelled: 0,
    active: 0,
    progress: 0
  }
  let work = 0
  for (const job of jobs) {
    summary[job.status]++
    if (job.status === 'cancelled') continue
    work += job.status === 'done' || job.status === 'error' ? 1 : job.status === 'running' ? job.progress : 0
  }
  summary.active = summary.queued + summary.running
  const counted = summary.total - summary.cancelled
  summary.progress = counted === 0 ? 1 : Math.min(1, work / counted)
  return summary
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/** One-line description of a batch for the collapsed queue bar. */
export function batchHeadline(summary: JobSummary): string {
  if (summary.total === 0) return 'Nothing in the queue'
  if (summary.active > 0) {
    const counted = summary.total - summary.cancelled
    const current = Math.min(counted, summary.done + summary.error + 1)
    return counted === 1 ? 'Converting 1 file' : `Converting ${current} of ${counted}`
  }
  const parts: string[] = []
  if (summary.done > 0) parts.push(`${plural(summary.done, 'file')} converted`)
  if (summary.error > 0) parts.push(`${summary.error} failed`)
  if (summary.cancelled > 0) parts.push(`${summary.cancelled} cancelled`)
  return parts.join(' · ')
}
