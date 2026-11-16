import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { IPC, type Job, type Settings, type StartJobsRequest } from '@shared/types'
import { JobQueue } from './jobs'
import { targetsForFiles } from './registry'
import { SettingsStore } from './settings'
import { BatchTracker, describeBatch, FileBatcher } from './shell/batching'
import {
  isExplorerEntryRegistered,
  registerExplorerEntry,
  unregisterExplorerEntry
} from './shell/explorer'
import { ShortcutManager } from './shell/shortcut'
import { AppTray } from './shell/tray'
import { createMainWindow, filesFromArgv, showWindow, toggleWindow } from './shell/window'

const FLAG_HIDDEN = '--hidden'
const FLAG_UNREGISTER = '--unregister-shell'

let mainWindow: BrowserWindow | null = null
let rendererReady = false
let quitting = false
let settings: SettingsStore
let tray: AppTray | null = null
let explorerRegistered = false
let lastOutputDir: string | null = null
const pendingFiles: string[] = []
const tracker = new BatchTracker()
const shortcuts = new ShortcutManager(() => toggleWindow(mainWindow))

const iconPath = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build', 'icon.png')

const queue = new JobQueue({ onUpdate: onJobUpdate })

/** Hands files to the renderer, holding them until it has loaded. */
function deliverFiles(paths: string[]): void {
  pendingFiles.push(...paths)
  flushFiles()
}

function flushFiles(): void {
  if (!rendererReady || !mainWindow || pendingFiles.length === 0) return
  mainWindow.webContents.send(IPC.filesOpened, pendingFiles.splice(0))
}

// Explorer starts one process per selected file; collect them into one batch.
const batcher = new FileBatcher((paths) => {
  showWindow(mainWindow)
  deliverFiles(paths)
})

function onJobUpdate(job: Job): void {
  mainWindow?.webContents.send(IPC.jobUpdate, job)

  // Taskbar progress for the whole batch.
  const summary = tracker.update(job)
  const fraction = tracker.progress()
  mainWindow?.setProgressBar(fraction === null ? -1 : fraction)
  tray?.setProgressTooltip(fraction === null ? 'Convert' : `Convert — ${Math.round(fraction * 100)}%`)

  if (job.status === 'done') lastOutputDir = dirname(job.outputPath)
  if (!summary) return

  const current = settings.get()
  if (current.revealWhenDone && summary.firstOutput) shell.showItemInFolder(summary.firstOutput)
  const unfocused = !mainWindow || !mainWindow.isFocused()
  if (current.notifyWhenDone && unfocused && Notification.isSupported() && summary.total > 0) {
    const { title, body } = describeBatch(summary)
    const notification = new Notification({ title, body })
    notification.on('click', () => {
      if (summary.firstOutput) shell.showItemInFolder(summary.firstOutput)
      else showWindow(mainWindow)
    })
    notification.show()
  }
}

async function pickAndSendFiles(): Promise<void> {
  const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
  if (result.canceled || result.filePaths.length === 0) return
  showWindow(mainWindow)
  deliverFiles(result.filePaths)
}

function openOutputFolder(): void {
  const { outputMode, outputDir } = settings.get()
  const target = lastOutputDir ?? (outputMode === 'folder' && outputDir ? outputDir : app.getPath('documents'))
  void shell.openPath(target)
}

function changeSettings(patch: Partial<Settings>): Settings {
  const next = settings.update(patch)
  applySettings(next)
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC.settingsChanged, next)
  return next
}

/** Pushes settings into the running app. Called at startup and after every change. */
function applySettings(next: Settings): void {
  mainWindow?.setAlwaysOnTop(next.alwaysOnTop)
  const result = shortcuts.apply(next.globalShortcut)
  if (!result.ok) {
    console.warn(`[shell] ${result.error}`)
    if (Notification.isSupported()) new Notification({ title: 'Convert', body: result.error ?? '' }).show()
  }
  // Only a packaged app has a stable exe to start at login.
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: next.launchAtLogin, args: [FLAG_HIDDEN] })
  tray?.update(next, explorerRegistered)
}

async function setExplorerEntry(enabled: boolean): Promise<void> {
  try {
    if (enabled) await registerExplorerEntry(process.execPath)
    else await unregisterExplorerEntry()
  } catch (error) {
    console.warn(`[shell] ${error instanceof Error ? error.message : String(error)}`)
  }
  explorerRegistered = await isExplorerEntryRegistered()
  tray?.update(settings.get(), explorerRegistered)
}

/** Registers the Explorer verb once. Later runs respect a user who removed it. */
async function firstRunSetup(): Promise<void> {
  const marker = join(app.getPath('userData'), 'shell-registered')
  if (app.isPackaged && !existsSync(marker)) {
    await setExplorerEntry(true)
    writeFileSync(marker, new Date().toISOString())
  } else {
    explorerRegistered = await isExplorerEntryRegistered()
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.getTargets, (_event, paths: string[]) => targetsForFiles(paths))
  ipcMain.handle(IPC.startJobs, (_event, request: StartJobsRequest) => {
    const { outputMode, outputDir } = settings.get()
    const fallbackDir = outputMode === 'folder' && outputDir ? outputDir : undefined
    return queue.start({ ...request, outputDir: request.outputDir ?? fallbackDir })
  })
  ipcMain.handle(IPC.cancelJob, (_event, id: string) => queue.cancel(id))
  ipcMain.handle(IPC.listJobs, () => queue.list())
  ipcMain.handle(IPC.pickFiles, async () => {
    const options: Electron.OpenDialogOptions = { properties: ['openFile', 'multiSelections'] }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle(IPC.pickFolder, async () => {
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC.reveal, (_event, path: string) => shell.showItemInFolder(path))
  ipcMain.handle(IPC.getSettings, () => settings.get())
  ipcMain.handle(IPC.updateSettings, (_event, patch: Partial<Settings>) => changeSettings(patch))
}

function openWindow(startHidden: boolean): void {
  rendererReady = false
  mainWindow = createMainWindow({
    iconPath: iconPath(),
    startHidden,
    shouldHideOnClose: () => !quitting && settings.get().closeToTray && tray !== null,
    onReady: () => {
      rendererReady = true
      flushFiles()
    },
    onClosed: () => {
      mainWindow = null
      rendererReady = false
    }
  })
  mainWindow.setAlwaysOnTop(settings.get().alwaysOnTop)
}

if (process.argv.includes(FLAG_UNREGISTER)) {
  // Remove the Explorer entry and exit (also usable by hand).
  void app.whenReady().then(async () => {
    await unregisterExplorerEntry()
    app.exit(0)
  })
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const files = filesFromArgv(argv)
    if (files.length > 0) batcher.add(files)
    else showWindow(mainWindow)
  })

  void app.whenReady().then(async () => {
    settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
    registerIpc()
    const files = filesFromArgv(process.argv)
    openWindow(process.argv.includes(FLAG_HIDDEN) && files.length === 0)
    await firstRunSetup()
    tray = new AppTray(iconPath(), settings.get(), {
      show: () => showWindow(mainWindow),
      convertFiles: () => void pickAndSendFiles(),
      openOutputFolder,
      setLaunchAtLogin: (value) => changeSettings({ launchAtLogin: value }),
      setExplorerEntry: (value) => void setExplorerEntry(value),
      quit: () => app.quit()
    })
    applySettings(settings.get())
    // The first launch of a multi-selection gets one path; the rest arrive as second-instance.
    batcher.add(files)

    app.on('activate', () => {
      if (!mainWindow) openWindow(false)
    })
  })

  app.on('before-quit', () => {
    quitting = true
    queue.cancelAll()
  })
  app.on('will-quit', () => {
    shortcuts.dispose()
    batcher.dispose()
    tray?.destroy()
  })
  // The tray keeps the app alive; quitting goes through the tray or `app.quit()`.
  app.on('window-all-closed', () => {
    if (!tray) app.quit()
  })
}
