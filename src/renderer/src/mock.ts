/**
 * Dev-only stand-in for `window.convert`.
 *
 * Offers a wide fake catalog, slow progress and predictable failures (any file
 * whose name contains "fail", "corrupt" or "broken") so the whole interface can
 * be built and checked in a plain browser. Never loaded in production builds.
 */
import { FORMATS, extOf, formatInfo, type Category } from '@shared/formats'
import {
  DEFAULT_SETTINGS,
  type ConvertApi,
  type Job,
  type OptionSpec,
  type Settings,
  type TargetOption
} from '@shared/types'

const byCategory = (category: Category): string[] =>
  FORMATS.filter((format) => format.category === category).map((format) => format.ext)

function targetsForExt(ext: string): string[] {
  const info = formatInfo(ext)
  if (!info) return []
  const pool: Record<Category, string[]> = {
    image: [...byCategory('image'), 'pdf'],
    video: [...byCategory('video'), ...byCategory('audio'), 'gif', 'png', 'jpg', 'webp', 'avif', 'bmp', 'tiff'],
    audio: byCategory('audio'),
    document: [...byCategory('document'), 'epub'],
    ebook: ['pdf', 'txt', 'html', 'md'],
    slides: [...byCategory('slides'), 'pdf', 'png', 'jpg'],
    spreadsheet: byCategory('spreadsheet'),
    subtitle: [...byCategory('subtitle'), 'txt'],
    archive: ['zip', 'tar', 'tar.gz', '7z']
  }
  return pool[info.category].filter((target) => target !== ext)
}

function optionsFor(to: string): OptionSpec[] {
  switch (to) {
    case 'jpg':
    case 'webp':
    case 'avif':
    case 'heic':
      return [
        { key: 'quality', label: 'Quality', type: 'number', min: 1, max: 100, default: 82, unit: '%' },
        { key: 'strip', label: 'Remove location and camera data', type: 'boolean', default: false }
      ]
    case 'png':
      return [{ key: 'compress', label: 'Smaller file (slower)', type: 'boolean', default: false }]
    case 'gif':
      return [
        { key: 'fps', label: 'Frame rate', type: 'number', min: 5, max: 30, default: 12, unit: 'fps' },
        { key: 'width', label: 'Width', type: 'number', min: 120, max: 1280, step: 20, default: 480, unit: 'px' }
      ]
    case 'mp3':
    case 'm4a':
    case 'ogg':
    case 'opus':
    case 'wma':
      return [
        {
          key: 'bitrate',
          label: 'Bitrate',
          type: 'select',
          default: '192',
          choices: ['96', '128', '160', '192', '256', '320'].map((value) => ({ value, label: `${value} kbps` }))
        }
      ]
    case 'mp4':
    case 'mkv':
    case 'webm':
    case 'mov':
      return [
        {
          key: 'size',
          label: 'Resolution',
          type: 'select',
          default: 'source',
          choices: [
            { value: 'source', label: 'Original' },
            { value: '1080', label: '1080p' },
            { value: '720', label: '720p' },
            { value: '480', label: '480p' }
          ]
        },
        { key: 'quality', label: 'Quality', type: 'number', min: 1, max: 100, step: 1, default: 70, unit: '%' },
        { key: 'audio', label: 'Keep the sound', type: 'boolean', default: true }
      ]
    case 'pdf':
      return [
        {
          key: 'page',
          label: 'Page size',
          type: 'select',
          default: 'a4',
          choices: [
            { value: 'a4', label: 'A4' },
            { value: 'letter', label: 'Letter' }
          ]
        }
      ]
    default:
      return []
  }
}

function targetsForFiles(paths: string[]): TargetOption[] {
  const exts = [...new Set(paths.map(extOf))]
  if (exts.length === 0 || exts.includes('')) return []
  const [first, ...rest] = exts.map(targetsForExt)
  return first
    .filter((to) => rest.every((list) => list.includes(to)))
    .flatMap((to) => {
      const format = formatInfo(to)
      return format ? [{ format, options: optionsFor(to) }] : []
    })
}

const SAMPLE_PICKS: string[][] = [
  ['C:\\Users\\you\\Pictures\\harbour at dawn.png', 'C:\\Users\\you\\Pictures\\market.png', 'C:\\Users\\you\\Pictures\\ferry.png'],
  ['C:\\Users\\you\\Videos\\birthday 2026.mov'],
  ['C:\\Users\\you\\Documents\\report.docx', 'C:\\Users\\you\\Documents\\notes.md'],
  ['C:\\Users\\you\\Downloads\\episode.srt'],
  [
    'C:\\Users\\you\\Music\\01 intro.wav',
    'C:\\Users\\you\\Music\\02 corrupt take.wav',
    'C:\\Users\\you\\Music\\03 verse.wav',
    'C:\\Users\\you\\Music\\04 bridge.wav',
    'C:\\Users\\you\\Music\\05 outro.wav'
  ],
  ['C:\\Users\\you\\Desktop\\scan.png', 'C:\\Users\\you\\Desktop\\voice memo.m4a'],
  ['C:\\Users\\you\\Desktop\\savegame.dat']
]

const hash = (text: string): number => {
  let value = 0
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0
  return value
}

const splitPath = (path: string): { dir: string; name: string; sep: string } => {
  const sep = path.includes('\\') ? '\\' : '/'
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return { dir: path.slice(0, Math.max(0, cut)), name: path.slice(cut + 1), sep }
}

export function createMockApi(): ConvertApi {
  let settings: Settings = { ...DEFAULT_SETTINGS }
  // Ids must differ between page loads: the interface remembers cleared job ids for the session.
  const session = Date.now().toString(36)
  let nextId = 1
  let pick = 0
  let running = 0
  const jobs = new Map<string, Job>()
  const pending: string[] = []
  const timers = new Map<string, number>()
  const jobListeners = new Set<(job: Job) => void>()
  const openListeners = new Set<(paths: string[]) => void>()
  const settingsListeners = new Set<(settings: Settings) => void>()

  const emit = (job: Job): void => jobListeners.forEach((listener) => listener({ ...job }))

  const finish = (job: Job, status: Job['status'], error?: string): void => {
    window.clearInterval(timers.get(job.id))
    timers.delete(job.id)
    job.status = status
    if (error) job.error = error
    if (status === 'done') job.progress = 1
    running--
    emit(job)
    pump()
  }

  const run = (job: Job): void => {
    running++
    job.status = 'running'
    emit(job)
    const name = splitPath(job.inputPath).name
    const duration = 2500 + (hash(name) % 5000)
    const doomed = /fail|corrupt|broken/i.test(name)
    const started = performance.now()
    timers.set(
      job.id,
      window.setInterval(() => {
        job.progress = Math.min(1, (performance.now() - started) / duration)
        if (doomed && job.progress > 0.55) {
          finish(job, 'error', 'This file looks damaged and could not be read.')
        } else if (job.progress >= 1) {
          finish(job, 'done')
        } else {
          emit(job)
        }
      }, 120)
    )
  }

  function pump(): void {
    while (running < 2 && pending.length > 0) run(jobs.get(pending.shift()!)!)
  }

  const api: ConvertApi = {
    pathForFile: (file) => `C:\\Users\\you\\Dropped\\${file.name}`,
    getTargets: async (paths) => targetsForFiles(paths),
    startJobs: async ({ inputs, to, outputDir }) => {
      const allowed = targetsForFiles(inputs).some((target) => target.format.ext === to)
      if (!allowed) throw new Error(`These files cannot be converted to .${to}`)
      const folder = outputDir ?? (settings.outputMode === 'folder' && settings.outputDir ? settings.outputDir : null)
      const created = inputs.map((inputPath) => {
        const { dir, name, sep } = splitPath(inputPath)
        const from = extOf(name)
        const stem = name.slice(0, name.length - from.length - 1)
        const job: Job = {
          id: `mock-${session}-${nextId++}`,
          inputPath,
          outputPath: `${folder ?? dir}${sep}${stem}.${to}`,
          from,
          to,
          status: 'queued',
          progress: 0
        }
        jobs.set(job.id, job)
        pending.push(job.id)
        emit(job)
        return { ...job }
      })
      pump()
      return created
    },
    cancelJob: async (id) => {
      const job = jobs.get(id)
      if (!job) return
      if (job.status === 'queued') {
        pending.splice(pending.indexOf(id), 1)
        job.status = 'cancelled'
        emit(job)
      } else if (job.status === 'running') {
        finish(job, 'cancelled')
      }
    },
    listJobs: async () => [...jobs.values()].map((job) => ({ ...job })),
    onJobUpdate: (listener) => {
      jobListeners.add(listener)
      return () => jobListeners.delete(listener)
    },
    onFilesOpened: (listener) => {
      openListeners.add(listener)
      return () => openListeners.delete(listener)
    },
    pickFiles: async () => SAMPLE_PICKS[pick++ % SAMPLE_PICKS.length],
    pickFolder: async () => 'C:\\Users\\you\\Documents\\Converted',
    reveal: async (path) => console.info('[mock] reveal', path),
    getSettings: async () => ({ ...settings }),
    updateSettings: async (patch) => {
      settings = { ...settings, ...patch }
      settingsListeners.forEach((listener) => listener({ ...settings }))
      return { ...settings }
    },
    onSettingsChanged: (listener) => {
      settingsListeners.add(listener)
      return () => settingsListeners.delete(listener)
    }
  }

  // Lets a developer simulate "Open with" from the console: __convertMock.open(['a.png'])
  Object.assign(window, {
    __convertMock: { open: (paths: string[]) => openListeners.forEach((listener) => listener(paths)) }
  })

  return api
}
