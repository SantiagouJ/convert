import { useCallback, useEffect, useState, type DragEvent } from 'react'
import type { Job, TargetOption } from '@shared/types'

/**
 * Placeholder shell that exercises the whole `window.convert` API end to end.
 * The real interface (radial wheel, queue, settings) replaces this file.
 */
export function App() {
  const [files, setFiles] = useState<string[]>([])
  const [targets, setTargets] = useState<TargetOption[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [error, setError] = useState<string | null>(null)

  const select = useCallback(async (paths: string[]) => {
    setError(null)
    setFiles(paths)
    setTargets(paths.length ? await window.convert.getTargets(paths) : [])
  }, [])

  useEffect(() => {
    void window.convert.listJobs().then(setJobs)
    const offJobs = window.convert.onJobUpdate((job) =>
      setJobs((current) => {
        const index = current.findIndex((item) => item.id === job.id)
        if (index === -1) return [job, ...current]
        const next = [...current]
        next[index] = job
        return next
      })
    )
    const offOpened = window.convert.onFilesOpened((paths) => void select(paths))
    return () => {
      offJobs()
      offOpened()
    }
  }, [select])

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    const paths = [...event.dataTransfer.files].map((file) => window.convert.pathForFile(file))
    void select(paths.filter(Boolean))
  }

  const convertTo = async (to: string) => {
    try {
      await window.convert.startJobs({ inputs: files, to })
      await select([])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <main onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <button className="drop" onClick={async () => select(await window.convert.pickFiles())}>
        {files.length === 0 ? 'Drop files here or click to choose' : `${files.length} file(s) selected`}
      </button>

      {files.length > 0 && (
        <section>
          {targets.length === 0 ? (
            <p>No conversions available for this selection.</p>
          ) : (
            targets.map(({ format }) => (
              <button key={format.ext} onClick={() => void convertTo(format.ext)}>
                {format.label}
              </button>
            ))
          )}
        </section>
      )}

      {error && <p className="error">{error}</p>}

      <ul>
        {jobs.map((job) => (
          <li key={job.id}>
            <span title={job.outputPath}>{job.outputPath.replace(/^.*[\\/]/, '')}</span>
            <span>
              {job.status === 'running' ? `${Math.round(job.progress * 100)}%` : job.status}
              {job.status === 'done' && (
                <button onClick={() => void window.convert.reveal(job.outputPath)}>Show</button>
              )}
              {(job.status === 'running' || job.status === 'queued') && (
                <button onClick={() => void window.convert.cancelJob(job.id)}>Cancel</button>
              )}
            </span>
            {job.error && <small className="error">{job.error}</small>}
          </li>
        ))}
      </ul>
    </main>
  )
}
