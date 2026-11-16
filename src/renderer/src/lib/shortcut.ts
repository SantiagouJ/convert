/** Turning keyboard events into Electron accelerators (`Control+Alt+C`) and back into key caps. */

export interface KeyLike {
  key: string
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  Enter: 'Return',
  Tab: 'Tab',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`'
}

/** The non-modifier key of an event as Electron names it, or null for modifiers and unknown keys. */
export function acceleratorKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return CODE_KEYS[code] ?? null
}

/**
 * Accelerator for a key press, or null while only modifiers are held or the
 * combination would hijack normal typing (a global shortcut needs Ctrl, Alt
 * or Win, unless it is a function key).
 */
export function acceleratorFromEvent(event: KeyLike): string | null {
  const key = acceleratorKey(event.code)
  if (!key) return null
  const isFunctionKey = /^F\d+$/.test(key)
  if (!event.ctrlKey && !event.altKey && !event.metaKey && !isFunctionKey) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Super')
  parts.push(key)
  return parts.join('+')
}

const CAPS: Record<string, string> = {
  Control: 'Ctrl',
  CommandOrControl: 'Ctrl',
  CmdOrCtrl: 'Ctrl',
  Command: 'Cmd',
  Super: 'Win',
  Meta: 'Win',
  Return: 'Enter',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→'
}

/** Key caps to display for an accelerator. Empty for an empty accelerator. */
export function acceleratorCaps(accelerator: string): string[] {
  if (!accelerator) return []
  // A trailing "+" is the plus key itself (`Control++`).
  const parts = accelerator.endsWith('++')
    ? [...accelerator.slice(0, -2).split('+'), '+']
    : accelerator.split('+')
  return parts.filter(Boolean).map((part) => CAPS[part] ?? part)
}
