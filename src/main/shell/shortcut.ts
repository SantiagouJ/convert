import { globalShortcut } from 'electron'

export interface ShortcutResult {
  ok: boolean
  /** Short message for the user when `ok` is false. */
  error?: string
}

/**
 * Keeps exactly one global shortcut registered. Re-registers on change and reports conflicts
 * instead of throwing.
 */
export class ShortcutManager {
  private current = ''

  constructor(private readonly onTrigger: () => void) {}

  apply(accelerator: string): ShortcutResult {
    const wanted = accelerator.trim()
    if (this.current) {
      globalShortcut.unregister(this.current)
      this.current = ''
    }
    if (!wanted) return { ok: true }
    try {
      const registered = globalShortcut.register(wanted, this.onTrigger)
      if (!registered) {
        return { ok: false, error: `The shortcut ${wanted} is already used by another app.` }
      }
      this.current = wanted
      return { ok: true }
    } catch {
      return { ok: false, error: `${wanted} is not a valid shortcut.` }
    }
  }

  dispose(): void {
    if (this.current) globalShortcut.unregister(this.current)
    this.current = ''
  }
}
