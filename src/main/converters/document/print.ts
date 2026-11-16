import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * HTML -> PDF through Chromium's print pipeline. This is the only part of the
 * document engine that needs Electron, so it is imported lazily and kept
 * apart from the code that unit tests load under plain Node.
 */
export async function printHtmlToPdf(html: string, signal: AbortSignal): Promise<Buffer> {
  const electron = await import('electron')
  const { BrowserWindow, session } = electron
  if (!BrowserWindow) throw new Error('PDF export is only available inside the app')

  // A private in-memory session that refuses anything but local content.
  const printSession = session.fromPartition(`convert-print-${randomUUID()}`, { cache: false })
  printSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !/^(file|data|blob|about|devtools):/i.test(details.url) })
  })

  const file = join(tmpdir(), `convert-print-${randomUUID()}.html`)
  await writeFile(file, html, 'utf8')
  const win = new BrowserWindow({
    show: false,
    webPreferences: { session: printSession, javascript: false, sandbox: true, offscreen: false }
  })
  const abort = () => {
    if (!win.isDestroyed()) win.destroy()
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    await win.loadFile(file)
    signal.throwIfAborted()
    return await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }
    })
  } finally {
    signal.removeEventListener('abort', abort)
    abort()
    await rm(file, { force: true })
  }
}
