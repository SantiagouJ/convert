import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'

/** Tiny JSON-file settings store. Unknown or missing keys fall back to defaults. */
export class SettingsStore {
  private current: Settings

  constructor(private readonly filePath: string) {
    this.current = this.load()
  }

  get(): Settings {
    return { ...this.current }
  }

  update(patch: Partial<Settings>): Settings {
    const next = { ...this.current }
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (patch[key] !== undefined) Object.assign(next, { [key]: patch[key] })
    }
    this.current = next
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(next, null, 2), 'utf8')
    return this.get()
  }

  private load(): Settings {
    try {
      const stored = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<Settings>
      const merged = { ...DEFAULT_SETTINGS }
      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
        if (typeof stored[key] === typeof DEFAULT_SETTINGS[key]) Object.assign(merged, { [key]: stored[key] })
      }
      return merged
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }
}
