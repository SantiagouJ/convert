import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '../src/shared/types'
import { DEFAULT_SETTINGS } from '../src/shared/types'
import { BatchTracker, describeBatch, FileBatcher } from '../src/main/shell/batching'
import { registerCommands, unregisterCommands, VERB_KEY } from '../src/main/shell/explorer'
import { SettingsStore } from '../src/main/settings'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const job = (id: string, status: Job['status'], progress = 0, out = `C:\\out\\${id}.png`): Job => ({
  id,
  inputPath: `C:\\in\\${id}.jpg`,
  outputPath: out,
  from: 'jpg',
  to: 'png',
  status,
  progress
})

describe('FileBatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('merges launches within the debounce window into one batch', () => {
    const flush = vi.fn()
    const batcher = new FileBatcher(flush, 300)
    batcher.add(['a.png'])
    vi.advanceTimersByTime(100)
    batcher.add(['b.png'])
    vi.advanceTimersByTime(100)
    batcher.add(['c.png', 'a.png'])
    expect(flush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledWith(['a.png', 'b.png', 'c.png'])
  })

  it('starts a new batch after a flush and ignores empty adds', () => {
    const flush = vi.fn()
    const batcher = new FileBatcher(flush, 50)
    batcher.add([])
    vi.advanceTimersByTime(100)
    expect(flush).not.toHaveBeenCalled()
    batcher.add(['a'])
    vi.advanceTimersByTime(60)
    batcher.add(['b'])
    vi.advanceTimersByTime(60)
    expect(flush.mock.calls).toEqual([[['a']], [['b']]])
  })
})

describe('BatchTracker', () => {
  it('reports one summary when every job finished and resets', () => {
    const t = new BatchTracker()
    expect(t.update(job('1', 'queued'))).toBeNull()
    expect(t.update(job('2', 'queued'))).toBeNull()
    expect(t.update(job('1', 'done', 1))).toBeNull()
    const summary = t.update(job('2', 'error'))
    expect(summary).toMatchObject({ total: 2, done: 1, failed: 1, firstOutput: 'C:\\out\\1.png', outputDir: 'C:\\out' })
    expect(t.progress()).toBeNull()
    expect(t.update(job('3', 'done', 1))).toMatchObject({ total: 1, done: 1 })
  })

  it('computes overall progress', () => {
    const t = new BatchTracker()
    t.update(job('1', 'running', 0.5))
    t.update(job('2', 'queued', 0))
    expect(t.progress()).toBeCloseTo(0.25)
    t.update(job('2', 'running', 1))
    expect(t.progress()).toBeCloseTo(0.75)
  })

  it('describes outcomes', () => {
    expect(describeBatch({ total: 3, done: 3, failed: 0, cancelled: 0 }).body).toBe('3 files converted.')
    expect(describeBatch({ total: 1, done: 0, failed: 1, cancelled: 0 }).title).toBe('Conversion failed')
    expect(describeBatch({ total: 2, done: 1, failed: 1, cancelled: 0 }).body).toBe('1 converted, 1 failed.')
  })
})

describe('Explorer registry commands', () => {
  it('registers a per-user verb that passes the clicked file', () => {
    const cmds = registerCommands('C:\\Apps\\Convert\\Convert.exe')
    const all = cmds.map((c) => c.args.join(' '))
    expect(all.every((line) => line.includes('HKCU\\'))).toBe(true)
    const command = cmds.find((c) => c.args[1].endsWith('\\command'))!
    expect(command.args).toContain('"C:\\Apps\\Convert\\Convert.exe" "%1"')
  })

  it('unregisters by deleting the verb key', () => {
    expect(unregisterCommands()).toEqual([{ args: ['delete', VERB_KEY, '/f'] }])
  })
})

describe('SettingsStore', () => {
  it('persists patches and ignores unknown keys', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'convert-settings-')), 's.json')
    const store = new SettingsStore(file)
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    store.update({ alwaysOnTop: true, globalShortcut: 'Control+Shift+K', bogus: 1 } as never)
    const reloaded = new SettingsStore(file).get()
    expect(reloaded.alwaysOnTop).toBe(true)
    expect(reloaded.globalShortcut).toBe('Control+Shift+K')
    expect(JSON.parse(readFileSync(file, 'utf8'))).not.toHaveProperty('bogus')
    writeFileSync(file, '{ broken')
    expect(new SettingsStore(file).get()).toEqual(DEFAULT_SETTINGS)
  })
})
