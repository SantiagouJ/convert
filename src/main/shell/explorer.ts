import { execFile } from 'node:child_process'

/**
 * Per-user Explorer integration (no admin rights): a "Convert with Convert" verb on every file
 * under HKCU\Software\Classes\*\shell. On Windows 11 it appears under "Show more options".
 */
export const VERB_KEY = 'HKCU\\Software\\Classes\\*\\shell\\ConvertWithConvert'
export const VERB_LABEL = 'Convert with Convert'

export interface RegCommand {
  args: string[]
}

/** The `reg.exe` invocations that install the context-menu entry. Pure, so it can be tested. */
export function registerCommands(exePath: string): RegCommand[] {
  return [
    { args: ['add', VERB_KEY, '/ve', '/d', VERB_LABEL, '/f'] },
    { args: ['add', VERB_KEY, '/v', 'Icon', '/d', `${exePath},0`, '/f'] },
    // Multi-selection: Explorer starts one process per file; the single-instance handler batches them.
    { args: ['add', `${VERB_KEY}\\command`, '/ve', '/d', `"${exePath}" "%1"`, '/f'] }
  ]
}

export function unregisterCommands(): RegCommand[] {
  return [{ args: ['delete', VERB_KEY, '/f'] }]
}

function reg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true }, (error, _stdout, stderr) => {
      const code = error ? ((error as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0
      resolve({ code: typeof code === 'number' ? code : 1, stderr: String(stderr) })
    })
  })
}

async function runAll(commands: RegCommand[], tolerateMissing = false): Promise<void> {
  for (const { args } of commands) {
    const result = await reg(args)
    // `reg delete` on a missing key exits 1; that is a successful "already unregistered".
    if (result.code !== 0 && !tolerateMissing) {
      throw new Error(`Could not update the Explorer menu: ${result.stderr.trim() || `reg.exe exit ${result.code}`}`)
    }
  }
}

export async function registerExplorerEntry(exePath: string): Promise<void> {
  if (process.platform !== 'win32') return
  await runAll(registerCommands(exePath))
}

export async function unregisterExplorerEntry(): Promise<void> {
  if (process.platform !== 'win32') return
  await runAll(unregisterCommands(), true)
}

export async function isExplorerEntryRegistered(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  return (await reg(['query', VERB_KEY])).code === 0
}
