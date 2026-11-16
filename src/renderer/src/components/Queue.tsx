import type { CSSProperties } from 'react'
import { formatInfo } from '@shared/formats'
import type { Job } from '@shared/types'
import { categoryColor } from '../lib/categories'
import { batchHeadline, isActive, summarize } from '../lib/jobs'
import { fileName } from '../lib/selection'
import { AlertIcon, CheckIcon, ChevronIcon, CloseIcon, FolderIcon } from './icons'

interface QueueProps {
  /** Every visible job, in display order. */
  jobs: Job[]
  /** Jobs of the most recent batch; the collapsed bar describes these. */
  batch: Job[]
  open: boolean
  onToggle: () => void
  onCancel: (id: string) => void
  onReveal: (path: string) => void
  onClearFinished: () => void
}

const STATUS_TEXT: Record<Job['status'], string> = {
  queued: 'Waiting',
  running: 'Converting',
  done: 'Done',
  error: 'Failed',
  cancelled: 'Cancelled'
}

function JobRow({ job, onCancel, onReveal }: { job: Job; onCancel: (id: string) => void; onReveal: (path: string) => void }) {
  const name = fileName(job.outputPath)
  const percent = Math.round(job.progress * 100)
  return (
    <li className={`job is-${job.status}`}>
      <span className="job-badge" style={{ '--cat': categoryColor(formatInfo(job.to)?.category ?? null) } as CSSProperties}>
        {job.to.toUpperCase()}
      </span>
      <div className="job-main">
        <span className="job-name" title={job.outputPath}>
          {name}
        </span>
        {job.status === 'running' ? (
          <div className="meter" role="progressbar" aria-label={`${name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span style={{ width: `${percent}%` }} />
          </div>
        ) : (
          <span className="job-status">
            {job.status === 'error' ? (job.error ?? 'Something went wrong.') : `${STATUS_TEXT[job.status]} · from ${job.from.toUpperCase()}`}
          </span>
        )}
      </div>
      {job.status === 'running' && <span className="job-percent">{percent}%</span>}
      {isActive(job) && (
        <button type="button" className="icon-btn" aria-label={`Cancel ${name}`} title="Cancel" onClick={() => onCancel(job.id)}>
          <CloseIcon />
        </button>
      )}
      {job.status === 'done' && (
        <button type="button" className="icon-btn" aria-label={`Show ${name} in folder`} title="Show in folder" onClick={() => onReveal(job.outputPath)}>
          <FolderIcon />
        </button>
      )}
    </li>
  )
}

export function Queue({ jobs, batch, open, onToggle, onCancel, onReveal, onClearFinished }: QueueProps) {
  if (jobs.length === 0) return null
  const all = summarize(jobs)
  const latest = summarize(batch)
  const busy = latest.active > 0
  const failed = !busy && latest.error > 0
  const lastDone = [...batch].reverse().find((job) => job.status === 'done')
  const finishedCount = all.total - all.active

  return (
    <section className={`queue${open ? ' is-open' : ''}`} aria-label="Conversions">
      {open && (
        <div className="queue-panel" id="queue-panel">
          <div className="queue-head">
            <span>
              {all.total} {all.total === 1 ? 'conversion' : 'conversions'}
              {all.active > 0 && ` · ${all.active} in progress`}
              {all.error > 0 && ` · ${all.error} failed`}
            </span>
            <button type="button" className="btn small" disabled={finishedCount === 0} onClick={onClearFinished}>
              Clear finished
            </button>
          </div>
          <ul className="queue-list">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} onCancel={onCancel} onReveal={onReveal} />
            ))}
          </ul>
        </div>
      )}

      <div className={`queue-bar${failed ? ' is-failed' : ''}${busy ? ' is-busy' : ''}`}>
        <button type="button" className="queue-toggle" aria-expanded={open} aria-controls="queue-panel" onClick={onToggle}>
          <span className="queue-state" aria-hidden="true">
            {busy ? <span className="spinner" /> : failed ? <AlertIcon /> : <CheckIcon />}
          </span>
          <span className="queue-text" role="status">
            {batchHeadline(latest)}
          </span>
          {busy && <span className="queue-percent">{Math.round(latest.progress * 100)}%</span>}
          <span className="queue-chevron" aria-hidden="true">
            <ChevronIcon />
          </span>
        </button>
        {!busy && lastDone && (
          <button type="button" className="icon-btn" aria-label="Show result in folder" title="Show in folder" onClick={() => onReveal(lastDone.outputPath)}>
            <FolderIcon />
          </button>
        )}
        {busy && (
          <div className="queue-progress" aria-hidden="true">
            <span style={{ width: `${latest.progress * 100}%` }} />
          </div>
        )}
      </div>
    </section>
  )
}
