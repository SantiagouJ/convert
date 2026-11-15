import type { Category, FormatInfo } from './formats'

/** A user-tunable setting a converter exposes (quality, bitrate, ...). */
export type OptionSpec =
  | {
      key: string
      label: string
      type: 'number'
      min: number
      max: number
      step?: number
      default: number
      unit?: string
    }
  | {
      key: string
      label: string
      type: 'select'
      choices: { value: string; label: string }[]
      default: string
    }
  | { key: string; label: string; type: 'boolean'; default: boolean }

export type OptionValues = Record<string, string | number | boolean>

export interface ConvertContext {
  /** Absolute path of the source file. Never modify or delete it. */
  inputPath: string
  /**
   * Absolute path the converter must write. The job queue guarantees it does
   * not exist yet and removes it if the conversion throws or is cancelled.
   * When `outputKind` is `'directory'` this is a directory to create.
   */
  outputPath: string
  /** Normalized source extension. */
  from: string
  /** Normalized target extension. */
  to: string
  /** Values for the converter's `options`, already filled with defaults. */
  options: OptionValues
  /** Report progress in the 0..1 range. Optional but encouraged. */
  onProgress: (fraction: number) => void
  /** Aborted when the user cancels. Kill child processes and reject. */
  signal: AbortSignal
}

/**
 * A converter handles every `from` x `to` pair it declares, except pairs
 * rejected by `supports` and identity pairs (`png` -> `png`).
 *
 * Converters live in `src/main/converters/<domain>/index.ts`, which must
 * export `converters: Converter[]`. The registry picks them up automatically.
 */
export interface Converter {
  /** Unique, stable id such as `image.sharp`. */
  id: string
  category: Category
  from: string[]
  to: string[]
  /** Narrow the from x to matrix when not every pair is valid. */
  supports?: (from: string, to: string) => boolean
  /** Options offered for a given target. */
  options?: (to: string) => OptionSpec[]
  /**
   * `'directory'` when one input produces several files (PDF -> PNG pages,
   * archive extraction). Defaults to `'file'`.
   */
  outputKind?: (from: string, to: string) => 'file' | 'directory'
  /** Higher wins when several converters handle the same pair. Default 0. */
  priority?: number
  convert: (ctx: ConvertContext) => Promise<void>
}

/** A target format offered to the user for the current selection. */
export interface TargetOption {
  format: FormatInfo
  options: OptionSpec[]
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface Job {
  id: string
  inputPath: string
  outputPath: string
  from: string
  to: string
  status: JobStatus
  /** 0..1 */
  progress: number
  error?: string
}

export interface StartJobsRequest {
  inputs: string[]
  to: string
  /** Defaults to the directory of each input. */
  outputDir?: string
  options?: OptionValues
}

export interface Settings {
  /** `source`: next to each input. `folder`: always into `outputDir`. */
  outputMode: 'source' | 'folder'
  /** Used when `outputMode` is `folder`. Empty string means not chosen yet. */
  outputDir: string
  /** Show the result in the file manager when a batch finishes. */
  revealWhenDone: boolean
  /** System notification when a batch finishes while the window is unfocused. */
  notifyWhenDone: boolean
  alwaysOnTop: boolean
  /** Closing the window keeps the app running in the tray. */
  closeToTray: boolean
  launchAtLogin: boolean
  /** Electron accelerator that shows the window, e.g. `Control+Alt+C`. Empty disables it. */
  globalShortcut: string
  theme: 'system' | 'dark' | 'light'
}

export const DEFAULT_SETTINGS: Settings = {
  outputMode: 'source',
  outputDir: '',
  revealWhenDone: false,
  notifyWhenDone: true,
  alwaysOnTop: false,
  closeToTray: true,
  launchAtLogin: false,
  globalShortcut: 'Control+Alt+C',
  theme: 'system'
}

/** API exposed to the renderer as `window.convert`. */
export interface ConvertApi {
  /** Absolute path of a dropped `File`. */
  pathForFile: (file: File) => string
  /** Targets every given file can be converted to. */
  getTargets: (paths: string[]) => Promise<TargetOption[]>
  startJobs: (request: StartJobsRequest) => Promise<Job[]>
  cancelJob: (id: string) => Promise<void>
  /** Snapshot of all jobs of this session. */
  listJobs: () => Promise<Job[]>
  /** Subscribe to job changes. Returns the unsubscribe function. */
  onJobUpdate: (listener: (job: Job) => void) => () => void
  /** Subscribe to files handed over by the OS (CLI args, "Open with", tray). */
  onFilesOpened: (listener: (paths: string[]) => void) => () => void
  /** Native file picker. Resolves with the chosen paths (may be empty). */
  pickFiles: () => Promise<string[]>
  /** Native folder picker. Resolves with the chosen path or `null`. */
  pickFolder: () => Promise<string | null>
  /** Show a file in the system file manager. */
  reveal: (path: string) => Promise<void>
  getSettings: () => Promise<Settings>
  /** Merges the patch, persists it and resolves with the full settings. */
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>
  /** Subscribe to settings changes made anywhere (tray menu, other windows). */
  onSettingsChanged: (listener: (settings: Settings) => void) => () => void
}

export const IPC = {
  getTargets: 'convert:get-targets',
  startJobs: 'convert:start-jobs',
  cancelJob: 'convert:cancel-job',
  listJobs: 'convert:list-jobs',
  jobUpdate: 'convert:job-update',
  filesOpened: 'convert:files-opened',
  pickFiles: 'convert:pick-files',
  reveal: 'convert:reveal',
  pickFolder: 'convert:pick-folder',
  getSettings: 'convert:get-settings',
  updateSettings: 'convert:update-settings',
  settingsChanged: 'convert:settings-changed'
} as const
