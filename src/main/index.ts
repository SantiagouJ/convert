import { join } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC, type Settings, type StartJobsRequest } from '@shared/types'
import { JobQueue } from './jobs'
import { targetsForFiles } from './registry'
import { SettingsStore } from './settings'

let mainWindow: BrowserWindow | null = null
let settings: SettingsStore

const queue = new JobQueue({
  onUpdate: (job) => mainWindow?.webContents.send(IPC.jobUpdate, job)
})

/** File paths passed on a command line ("Open with", drag onto the exe). */
function filesFromArgv(argv: string[]): string[] {
  return argv.slice(1).filter((arg) => {
    if (arg.startsWith('-')) return false
    try {
      return existsSync(arg) && statSync(arg).isFile()
    } catch {
      return false
    }
  })
}

function sendOpenedFiles(paths: string[]): void {
  if (paths.length === 0 || !mainWindow) return
  mainWindow.webContents.send(IPC.filesOpened, paths)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 620,
    minWidth: 380,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#14110f',
    title: 'Convert',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.webContents.once('did-finish-load', () => sendOpenedFiles(filesFromArgv(process.argv)))

  // Dropping a file outside a drop zone must not navigate the window away.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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
  ipcMain.handle(IPC.updateSettings, (_event, patch: Partial<Settings>) => {
    const next = settings.update(patch)
    applySettings(next)
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC.settingsChanged, next)
    return next
  })
}

/** Pushes settings into the running app. Called at startup and after every change. */
function applySettings(next: Settings): void {
  mainWindow?.setAlwaysOnTop(next.alwaysOnTop)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    sendOpenedFiles(filesFromArgv(argv))
  })

  void app.whenReady().then(() => {
    settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
    registerIpc()
    createWindow()
    applySettings(settings.get())
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => queue.cancelAll())
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
