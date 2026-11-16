import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type DragEvent } from 'react'
import { DEFAULT_SETTINGS, type OptionValues, type Settings, type TargetOption } from '@shared/types'
import { getApi, isMock } from './api'
import { Empty, Idle } from './components/DropField'
import { OptionsSheet } from './components/OptionsSheet'
import { Queue } from './components/Queue'
import { SettingsPanel } from './components/SettingsPanel'
import { Wheel, type WheelHandle } from './components/Wheel'
import { CloseIcon, Mark, SlidersIcon } from './components/icons'
import { categoryColor } from './lib/categories'
import { initialQueue, latestBatch, orderedJobs, queueReducer } from './lib/jobs'
import { predictExts } from './lib/mime'
import { summarizeSelection } from './lib/selection'
import type { Point } from './lib/wheel'

interface Selection {
  id: number
  files: string[]
  /** null while the targets are being looked up. */
  targets: TargetOption[] | null
  /** Where the files were dropped, in drop-field coordinates. */
  origin: Point | null
}

interface DragState {
  /** Targets guessed from the dragged MIME types; null when they cannot be told before the drop. */
  targets: TargetOption[] | null
  label: string
}

const HIDDEN_KEY = 'convert.clearedJobs'

function loadHidden(): string[] {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(HIDDEN_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** Strips Electron's IPC wrapper so the user only reads the converter's own sentence. */
function friendly(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

const isFileDrag = (event: DragEvent): boolean => Array.from(event.dataTransfer.types).includes('Files')

export function App() {
  const api = getApi()
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [queue, dispatchQueue] = useReducer(queueReducer, undefined, () => initialQueue(loadHidden()))
  const [selection, setSelection] = useState<Selection | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [sheet, setSheet] = useState<{ target: TargetOption; files: string[] } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

  const fieldRef = useRef<HTMLDivElement>(null)
  const wheelRef = useRef<WheelHandle>(null)
  const dragActive = useRef(false)
  const dragWatch = useRef(0)
  const dragToken = useRef(0)
  const request = useRef(0)

  // ---- selection ---------------------------------------------------------

  const select = useCallback(
    async (files: string[], origin: Point | null = null) => {
      const id = ++request.current
      if (files.length === 0) {
        setSelection(null)
        return
      }
      setNotice(null)
      setQueueOpen(false)
      setSelection({ id, files, targets: null, origin })
      try {
        const targets = await api.getTargets(files)
        if (request.current === id) setSelection({ id, files, targets, origin })
      } catch (error) {
        if (request.current !== id) return
        setSelection(null)
        setNotice(friendly(error))
      }
    },
    [api]
  )

  const clear = useCallback(() => {
    request.current++
    setSelection(null)
    setSheet(null)
  }, [])

  const browse = useCallback(async () => {
    const files = await api.pickFiles()
    if (files.length > 0) void select(files)
  }, [api, select])

  const start = useCallback(
    async (files: string[], target: TargetOption, options?: OptionValues) => {
      try {
        const jobs = await api.startJobs({ inputs: files, to: target.format.ext, options })
        dispatchQueue({ type: 'batch', ids: jobs.map((job) => job.id) })
        dispatchQueue({ type: 'snapshot', jobs })
        clear()
        setAnnouncement(`Converting ${jobs.length} ${jobs.length === 1 ? 'file' : 'files'} to ${target.format.label}`)
      } catch (error) {
        setSheet(null)
        setNotice(friendly(error))
      }
    },
    [api, clear]
  )

  const pick = (files: string[], target: TargetOption, withOptions: boolean): void => {
    if (withOptions && target.options.length > 0) setSheet({ target, files })
    else void start(files, target)
  }

  // ---- subscriptions -----------------------------------------------------

  useEffect(() => {
    void api.listJobs().then((jobs) => dispatchQueue({ type: 'snapshot', jobs }))
    void api.getSettings().then(setSettings)
    const offJobs = api.onJobUpdate((job) => dispatchQueue({ type: 'update', job }))
    const offOpened = api.onFilesOpened((paths) => void select(paths))
    const offSettings = api.onSettingsChanged(setSettings)
    return () => {
      offJobs()
      offOpened()
      offSettings()
    }
  }, [api, select])

  useEffect(() => {
    try {
      sessionStorage.setItem(HIDDEN_KEY, JSON.stringify(queue.hidden.slice(-500)))
    } catch {
      // Storage being unavailable only means cleared jobs reappear after a reload.
    }
  }, [queue.hidden])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => setSystemDark(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const theme = settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useLayoutEffect(() => {
    const node = fieldRef.current
    if (!node) return
    const measure = (): void => setSize({ width: node.clientWidth, height: node.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => window.clearTimeout(dragWatch.current), [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 7000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) clear()
      else if ((event.ctrlKey || event.metaKey) && event.key === ',') setSettingsOpen(true)
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void browse()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [browse, clear])

  // ---- drag and drop -----------------------------------------------------

  const endDrag = (): void => {
    dragActive.current = false
    dragToken.current++
    window.clearTimeout(dragWatch.current)
    setDrag(null)
  }

  /**
   * Called for every dragenter and dragover. Starts the drag state on the
   * first one and keeps it alive: dragover normally repeats while files hover
   * over the window, so a long silence without a drop or a leave means the
   * drag ended somewhere we could not see. Should that guess ever be wrong,
   * the next movement simply starts the drag state again.
   */
  const trackDrag = (event: DragEvent): void => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    window.clearTimeout(dragWatch.current)
    dragWatch.current = window.setTimeout(endDrag, 2500)
    if (dragActive.current) return
    dragActive.current = true

    setSheet(null)
    setSettingsOpen(false)
    setQueueOpen(false)
    setDrag({ targets: null, label: '' })
    const token = ++dragToken.current
    const types = Array.from(event.dataTransfer.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.type)
    const exts = predictExts(types)
    if (!exts) return
    const names = exts.map((ext, index) => `dragged-${index}.${ext}`)
    void api.getTargets(names).then(
      (targets) => {
        if (dragToken.current === token && targets.length > 0) {
          setDrag({ targets, label: summarizeSelection(names).badge })
        }
      },
      () => {}
    )
  }

  const onDragLeave = (event: DragEvent): void => {
    // Leaving for another element of the app is not leaving the window.
    const next = event.relatedTarget
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) endDrag()
  }

  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files)
      .map((file) => api.pathForFile(file))
      .filter(Boolean)
    const hit = drag?.targets ? (wheelRef.current?.hitAt(event.clientX, event.clientY) ?? null) : null
    const wantsOptions = event.shiftKey || event.altKey
    const rect = fieldRef.current?.getBoundingClientRect()
    const origin = rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : null
    endDrag()
    if (files.length === 0) return
    if (!hit) {
      void select(files, origin)
      return
    }

    // The wheel shown during the drag was a guess from MIME types; confirm it with the real files.
    const id = ++request.current
    setSelection({ id, files, targets: null, origin })
    void api.getTargets(files).then(
      (targets) => {
        if (request.current !== id) return
        setSelection({ id, files, targets, origin })
        const target = targets.find((item) => item.format.ext === hit.target.format.ext)
        if (target) pick(files, target, hit.withOptions || wantsOptions)
        else if (targets.length > 0) setNotice(`${hit.target.format.label} is not available for these files. Pick another format.`)
      },
      (error: unknown) => {
        if (request.current !== id) return
        setSelection(null)
        setNotice(friendly(error))
      }
    )
  }

  // ---- render ------------------------------------------------------------

  const summary = useMemo(() => summarizeSelection(selection?.files ?? []), [selection?.files])
  const jobs = useMemo(() => orderedJobs(queue), [queue])
  const batch = useMemo(() => latestBatch(queue), [queue])
  const ready = size.width > 0 && size.height > 0
  const wheelTargets = drag ? drag.targets : (selection?.targets ?? null)
  const anyOptions = wheelTargets?.some((target) => target.options.length > 0) ?? false

  let field = null
  if (!ready) {
    field = null
  } else if (drag) {
    field = drag.targets ? (
      <Wheel
        key="drag"
        ref={wheelRef}
        targets={drag.targets}
        width={size.width}
        height={size.height}
        origin={null}
        sourceLabel={drag.label}
        dragging
        onPick={() => {}}
        onCancel={() => {}}
      />
    ) : (
      <Idle width={size.width} height={size.height} dragging onBrowse={() => {}} />
    )
  } else if (!selection) {
    field = <Idle width={size.width} height={size.height} dragging={false} onBrowse={() => void browse()} />
  } else if (selection.targets === null) {
    field = (
      <div className="loading" role="status">
        Looking at your files…
      </div>
    )
  } else if (selection.targets.length === 0) {
    field = <Empty summary={summary} onBrowse={() => void browse()} onClear={clear} />
  } else {
    field = (
      <Wheel
        key={selection.id}
        targets={selection.targets}
        width={size.width}
        height={size.height}
        origin={selection.origin}
        sourceLabel={summary.badge}
        onPick={(target, withOptions) => pick(selection.files, target, withOptions)}
        onCancel={clear}
      />
    )
  }

  let hint = 'Everything stays on this computer.'
  if (drag) hint = drag.targets ? 'Drop on a format to convert right away.' : 'Drop anywhere, then pick a format.'
  else if (selection?.targets?.length) {
    hint = anyOptions ? 'Enter converts · dotted edge or Shift: options' : 'Arrows move · Enter converts · Esc cancels'
  } else if (selection) hint = ''

  return (
    <div className="app" onDragEnter={trackDrag} onDragOver={trackDrag} onDragLeave={onDragLeave} onDrop={onDrop}>
      <header className="bar">
        <Mark />
        <h1>Convert</h1>
        {isMock() && <span className="tag">demo data</span>}
        <span className="spacer" />
        <button type="button" className="icon-btn" aria-label="Settings" title="Settings (Ctrl+,)" onClick={() => setSettingsOpen(true)}>
          <SlidersIcon />
        </button>
      </header>

      <main className="stage">
        <div className="strip">
          {selection && !drag && (
            <>
              <span className="strip-dots" aria-hidden="true">
                {summary.groups.slice(0, 4).map((group) => (
                  <i key={group.ext} style={{ background: categoryColor(group.category) }} />
                ))}
              </span>
              <span className="strip-text" title={summary.names.join('\n')}>
                <strong>{summary.headline}</strong>
                <span>{summary.names.join(', ')}</span>
              </span>
              <button type="button" className="icon-btn" aria-label="Clear selection" title="Clear (Esc)" onClick={clear}>
                <CloseIcon />
              </button>
            </>
          )}
        </div>

        <div className="dropfield" ref={fieldRef}>
          {field}
        </div>

        <p className="hint">{hint}</p>

        {notice && (
          <div className="notice" role="alert">
            <span>{notice}</span>
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>
              <CloseIcon />
            </button>
          </div>
        )}
      </main>

      <Queue
        jobs={jobs}
        batch={batch}
        open={queueOpen}
        onToggle={() => setQueueOpen((open) => !open)}
        onCancel={(id) => void api.cancelJob(id)}
        onReveal={(path) => void api.reveal(path)}
        onClearFinished={() => dispatchQueue({ type: 'clear-finished' })}
      />

      {sheet && (
        <OptionsSheet
          target={sheet.target}
          sourceLabel={summarizeSelection(sheet.files).headline}
          onConvert={(values) => void start(sheet.files, sheet.target, values)}
          onClose={() => setSheet(null)}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onChange={(patch) => {
            setSettings((current) => ({ ...current, ...patch }))
            void api.updateSettings(patch).then(setSettings, (error: unknown) => setNotice(friendly(error)))
          }}
          pickFolder={() => api.pickFolder()}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </div>
  )
}
