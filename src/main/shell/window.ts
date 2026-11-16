import { join } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { BrowserWindow } from 'electron'

/** File paths passed on a command line ("Open with", Explorer verb, drag onto the exe). */
export function filesFromArgv(argv: string[]): string[] {
  return argv.slice(1).filter((arg) => {
    if (arg.startsWith('-')) return false
    try {
      return existsSync(arg) && statSync(arg).isFile()
    } catch {
      return false
    }
  })
}

export interface WindowOptions {
  iconPath: string
  startHidden: boolean
  /** Close hides instead of destroying when this returns true. */
  shouldHideOnClose: () => boolean
  onReady: () => void
  onClosed: () => void
}

export function createMainWindow(options: WindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 460,
    height: 620,
    minWidth: 380,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#14110f',
    title: 'Convert',
    icon: options.iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => {
    if (!options.startHidden) win.show()
  })
  win.webContents.on('did-finish-load', options.onReady)
  win.on('close', (event) => {
    if (options.shouldHideOnClose()) {
      event.preventDefault()
      win.hide()
    }
  })
  win.on('closed', options.onClosed)

  // Dropping a file outside a drop zone must not navigate the window away.
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

export function showWindow(win: BrowserWindow | null): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function toggleWindow(win: BrowserWindow | null): void {
  if (!win) return
  if (win.isVisible() && win.isFocused()) win.hide()
  else showWindow(win)
}
