import { describe, expect, it } from 'vitest'
import type { Job, JobStatus, OptionSpec } from '@shared/types'
import {
  batchHeadline,
  initialQueue,
  latestBatch,
  orderedJobs,
  queueReducer,
  summarize,
  type QueueAction,
  type QueueState
} from '../../src/renderer/src/lib/jobs'
import { predictExts } from '../../src/renderer/src/lib/mime'
import { changedValues, defaultValues, snapNumber } from '../../src/renderer/src/lib/options'
import { summarizeSelection } from '../../src/renderer/src/lib/selection'
import { acceleratorCaps, acceleratorFromEvent, type KeyLike } from '../../src/renderer/src/lib/shortcut'

const job = (id: string, status: JobStatus = 'queued', progress = 0): Job => ({
  id,
  inputPath: `C:\\in\\${id}.srt`,
  outputPath: `C:\\in\\${id}.vtt`,
  from: 'srt',
  to: 'vtt',
  status,
  progress
})

const run = (actions: QueueAction[], state: QueueState = initialQueue()): QueueState =>
  actions.reduce(queueReducer, state)

describe('queueReducer', () => {
  it('adds new jobs and replaces known ones', () => {
    const state = run([
      { type: 'update', job: job('a') },
      { type: 'update', job: job('b') },
      { type: 'update', job: job('a', 'running', 0.5) }
    ])
    expect(state.jobs.map((item) => [item.id, item.status])).toEqual([
      ['a', 'running'],
      ['b', 'queued']
    ])
  })

  it('files updates that arrive before startJobs resolves under the same batch', () => {
    const state = run([
      { type: 'update', job: job('a') },
      { type: 'update', job: job('b') },
      { type: 'batch', ids: ['a', 'b'] },
      { type: 'snapshot', jobs: [job('a'), job('b')] }
    ])
    expect(state.batches).toBe(1)
    expect(state.batchOf).toEqual({ a: 1, b: 1 })
    expect(state.jobs).toHaveLength(2)
  })

  it('does not let a stale snapshot overwrite a newer update', () => {
    const state = run([
      { type: 'update', job: job('a', 'done', 1) },
      { type: 'snapshot', jobs: [job('a', 'queued')] }
    ])
    expect(state.jobs[0].status).toBe('done')
  })

  it('shows the newest batch first and keeps order inside a batch', () => {
    const state = run([
      { type: 'snapshot', jobs: [job('old')] },
      { type: 'update', job: job('a') },
      { type: 'update', job: job('b') },
      { type: 'batch', ids: ['a', 'b'] },
      { type: 'update', job: job('c') },
      { type: 'batch', ids: ['c'] }
    ])
    expect(orderedJobs(state).map((item) => item.id)).toEqual(['c', 'a', 'b', 'old'])
    expect(latestBatch(state).map((item) => item.id)).toEqual(['c'])
  })

  it('clears finished jobs for good, but keeps active ones', () => {
    let state = run([
      { type: 'update', job: job('a', 'done', 1) },
      { type: 'update', job: job('b', 'running', 0.2) },
      { type: 'update', job: job('c', 'error') },
      { type: 'clear-finished' }
    ])
    expect(state.jobs.map((item) => item.id)).toEqual(['b'])
    expect(state.hidden).toEqual(['a', 'c'])

    state = run(
      [
        { type: 'snapshot', jobs: [job('a', 'done', 1), job('b', 'running', 0.3)] },
        { type: 'update', job: job('c', 'error') }
      ],
      state
    )
    expect(state.jobs.map((item) => item.id)).toEqual(['b'])
    expect(queueReducer(state, { type: 'clear-finished' })).toBe(state)
  })

  it('falls back to the previous batch when the latest was cleared', () => {
    const state = run([
      { type: 'update', job: job('a', 'running', 0.1) },
      { type: 'batch', ids: ['a'] },
      { type: 'update', job: job('b', 'done', 1) },
      { type: 'batch', ids: ['b'] },
      { type: 'clear-finished' }
    ])
    expect(latestBatch(state).map((item) => item.id)).toEqual(['a'])
    expect(latestBatch(initialQueue())).toEqual([])
  })
})

describe('summarize', () => {
  it('counts statuses and averages progress without cancelled jobs', () => {
    const summary = summarize([job('a', 'done', 1), job('b', 'running', 0.5), job('c'), job('d', 'cancelled'), job('e', 'error', 0.3)])
    expect(summary).toMatchObject({ total: 5, done: 1, running: 1, queued: 1, cancelled: 1, error: 1, active: 2 })
    expect(summary.progress).toBeCloseTo(2.5 / 4)
  })

  it('treats nothing-to-do as complete', () => {
    expect(summarize([]).progress).toBe(1)
    expect(summarize([job('a', 'cancelled')]).progress).toBe(1)
  })
})

describe('batchHeadline', () => {
  const headline = (...jobs: Job[]): string => batchHeadline(summarize(jobs))

  it('describes work in progress', () => {
    expect(headline(job('a', 'running', 0.2))).toBe('Converting 1 file')
    expect(headline(job('a', 'done', 1), job('b', 'running', 0.2), job('c'))).toBe('Converting 2 of 3')
    expect(headline(job('a', 'done', 1), job('b', 'error'), job('c', 'cancelled'), job('d'))).toBe('Converting 3 of 3')
  })

  it('describes the outcome', () => {
    expect(headline(job('a', 'done', 1))).toBe('1 file converted')
    expect(headline(job('a', 'done', 1), job('b', 'done', 1), job('c', 'error'))).toBe('2 files converted · 1 failed')
    expect(headline(job('a', 'cancelled'))).toBe('1 cancelled')
    expect(headline()).toBe('Nothing in the queue')
  })
})

describe('summarizeSelection', () => {
  it('describes one kind of file', () => {
    const one = summarizeSelection(['C:\\a\\clip.SRT'])
    expect(one).toMatchObject({ count: 1, mixed: false, badge: 'SRT', headline: '1 SRT file', names: ['clip.SRT'] })
    const many = summarizeSelection(['/x/a.jpeg', '/x/b.jpg', '/x/c.JPG'])
    expect(many).toMatchObject({ badge: '3 JPG', headline: '3 JPG files', mixed: false })
    expect(many.groups).toEqual([{ ext: 'jpg', label: 'JPG', category: 'image', count: 3 }])
  })

  it('describes mixed and unknown files', () => {
    const mixed = summarizeSelection(['a.png', 'b.docx', 'c.png', 'd.mp3', 'e.zip', 'f'])
    expect(mixed.mixed).toBe(true)
    expect(mixed.badge).toBe('6 mixed')
    expect(mixed.headline).toBe('6 files · PNG, Word, MP3 +2')
    expect(summarizeSelection(['save.dat']).groups[0]).toEqual({ ext: 'dat', label: 'DAT', category: null, count: 1 })
    expect(summarizeSelection(['Makefile']).groups[0].label).toBe('Unknown')
  })

  it('is empty for no files', () => {
    expect(summarizeSelection([])).toMatchObject({ count: 0, badge: '', headline: '', mixed: false })
  })
})

describe('shortcut', () => {
  const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike => ({
    key: '',
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods
  })

  it('builds Electron accelerators in a stable modifier order', () => {
    expect(acceleratorFromEvent(key('KeyC', { ctrlKey: true, altKey: true }))).toBe('Control+Alt+C')
    expect(acceleratorFromEvent(key('Digit1', { metaKey: true, shiftKey: true, ctrlKey: true }))).toBe('Control+Shift+Super+1')
    expect(acceleratorFromEvent(key('ArrowUp', { altKey: true }))).toBe('Alt+Up')
    expect(acceleratorFromEvent(key('Equal', { ctrlKey: true }))).toBe('Control+=')
    expect(acceleratorFromEvent(key('F9'))).toBe('F9')
  })

  it('waits while only modifiers are held and refuses plain typing keys', () => {
    expect(acceleratorFromEvent(key('ControlLeft', { ctrlKey: true }))).toBeNull()
    expect(acceleratorFromEvent(key('KeyC'))).toBeNull()
    expect(acceleratorFromEvent(key('KeyC', { shiftKey: true }))).toBeNull()
    expect(acceleratorFromEvent(key('IntlBackslash', { ctrlKey: true }))).toBeNull()
  })

  it('formats accelerators as key caps', () => {
    expect(acceleratorCaps('Control+Alt+C')).toEqual(['Ctrl', 'Alt', 'C'])
    expect(acceleratorCaps('Super+Shift+Up')).toEqual(['Win', 'Shift', '↑'])
    expect(acceleratorCaps('Control++')).toEqual(['Ctrl', '+'])
    expect(acceleratorCaps('')).toEqual([])
  })
})

describe('options', () => {
  const specs: OptionSpec[] = [
    { key: 'quality', label: 'Quality', type: 'number', min: 1, max: 100, default: 82 },
    { key: 'width', label: 'Width', type: 'number', min: 120, max: 1280, step: 20, default: 480 },
    { key: 'page', label: 'Page', type: 'select', default: 'a4', choices: [{ value: 'a4', label: 'A4' }] },
    { key: 'strip', label: 'Strip', type: 'boolean', default: false }
  ]

  it('starts from the defaults', () => {
    expect(defaultValues(specs)).toEqual({ quality: 82, width: 480, page: 'a4', strip: false })
    expect(changedValues(specs, defaultValues(specs))).toBeUndefined()
  })

  it('sends only what the user changed', () => {
    expect(changedValues(specs, { ...defaultValues(specs), quality: 60, strip: true })).toEqual({ quality: 60, strip: true })
  })

  it('clamps and snaps numbers', () => {
    const [quality, width] = specs as Extract<OptionSpec, { type: 'number' }>[]
    expect(snapNumber(quality, 250)).toBe(100)
    expect(snapNumber(quality, -4)).toBe(1)
    expect(snapNumber(quality, Number.NaN)).toBe(82)
    expect(snapNumber(width, 493)).toBe(500)
    expect(snapNumber({ ...quality, min: 0, max: 1, step: 0.1 }, 0.34)).toBe(0.3)
  })
})

describe('predictExts', () => {
  it('maps the MIME types of dragged files to extensions', () => {
    expect(predictExts(['image/png', 'image/jpeg'])).toEqual(['png', 'jpg'])
    expect(predictExts(['Text/Plain; charset=utf-8'])).toEqual(['txt'])
  })

  it('gives up when any file is unknown', () => {
    expect(predictExts(['image/png', ''])).toBeNull()
    expect(predictExts(['application/x-unknown'])).toBeNull()
    expect(predictExts([])).toBeNull()
  })
})
