import type { CSSProperties } from 'react'
import type { SelectionSummary } from '../lib/selection'
import { sectorPath, slotAngles, wheelMetrics } from '../lib/wheel'

const GHOST_SLOTS = 9
const GHOST_CATEGORIES = ['image', 'video', 'audio', 'document', 'spreadsheet', 'slides', 'subtitle', 'archive', 'ebook']

interface IdleProps {
  width: number
  height: number
  /** Files are being dragged over the window. */
  dragging: boolean
  onBrowse: () => void
}

/** The resting state: a faint wheel that invites a drop, and browses on click. */
export function Idle({ width, height, dragging, onBrowse }: IdleProps) {
  const metrics = wheelMetrics(width, height)
  const center = { x: width / 2, y: height / 2 }
  const outer = metrics.outer * 0.92
  return (
    <button type="button" className={`idle${dragging ? ' is-dragging' : ''}`} onClick={onBrowse}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
        <g className="ghost" style={{ transformOrigin: `${center.x}px ${center.y}px` }}>
          {Array.from({ length: GHOST_SLOTS }, (_, index) => {
            const { start, end } = slotAngles(index, GHOST_SLOTS)
            return (
              <path
                key={index}
                d={sectorPath(center, outer * 0.62, outer, start, end, 7)}
                style={{ '--cat': `var(--cat-${GHOST_CATEGORIES[index]})` } as CSSProperties}
              />
            )
          })}
        </g>
      </svg>
      <span className="idle-text">
        <strong>{dragging ? 'Let go' : 'Drop files'}</strong>
        <span>{dragging ? 'to pick a format' : 'or click to browse'}</span>
      </span>
    </button>
  )
}

interface EmptyProps {
  summary: SelectionSummary
  onBrowse: () => void
  onClear: () => void
}

/** Shown when nothing can be done with the selected files. */
export function Empty({ summary, onBrowse, onClear }: EmptyProps) {
  const first = summary.groups[0]
  let title = 'Nothing to convert to'
  let text = 'Convert does not know this kind of file yet.'
  if (summary.mixed) {
    title = 'No format in common'
    text = 'These files are different kinds and share no target. Try one kind at a time.'
  } else if (first?.category) {
    text = `${first.label} files cannot be converted to anything yet.`
  }
  return (
    <div className="empty" role="status">
      <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true" focusable="false">
        <circle cx="36" cy="36" r="27" pathLength="100" strokeDasharray="14 11" />
      </svg>
      <h2>{title}</h2>
      <p>{text}</p>
      <div className="empty-actions">
        <button type="button" className="btn primary" onClick={onBrowse} data-autofocus>
          Choose other files
        </button>
        <button type="button" className="btn" onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  )
}
