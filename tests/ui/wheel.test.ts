import { describe, expect, it } from 'vitest'
import {
  TAU,
  clampCenter,
  findByLetter,
  groupStable,
  hitTest,
  paginate,
  polar,
  sectorPath,
  slotAngles,
  slotContent,
  slotCount,
  wheelMetrics,
  wheelNav,
  type WheelMetrics
} from '../../src/renderer/src/lib/wheel'

const metrics: WheelMetrics = { outer: 150, inner: 60, rim: 14, capacity: 10 }

describe('wheelMetrics', () => {
  it('fits the default and the minimum window', () => {
    for (const [width, height] of [
      [460, 430],
      [380, 320]
    ]) {
      const m = wheelMetrics(width, height)
      expect(m.outer * 2).toBeLessThanOrEqual(Math.min(width, height))
      expect(m.inner).toBeLessThan(m.outer - m.rim)
      expect(m.capacity).toBeGreaterThanOrEqual(6)
      expect(m.capacity).toBeLessThanOrEqual(12)
    }
  })

  it('never grows without bound or collapses', () => {
    expect(wheelMetrics(2000, 2000).outer).toBe(190)
    expect(wheelMetrics(50, 50).outer).toBe(96)
  })
})

describe('paginate', () => {
  it('keeps small sets on one page', () => {
    expect(paginate(0, 10)).toEqual([])
    expect(paginate(2, 10)).toEqual([[0, 1]])
    expect(paginate(10, 10)).toHaveLength(1)
  })

  it('splits large sets into balanced pages that leave room for "more"', () => {
    const pages = paginate(20, 10)
    expect(pages.map((page) => page.length)).toEqual([7, 7, 6])
    expect(pages.flat()).toEqual(Array.from({ length: 20 }, (_, index) => index))
    for (let page = 0; page < pages.length; page++) {
      expect(slotCount(pages, page)).toBeLessThanOrEqual(10)
    }
    expect(paginate(11, 10).map((page) => page.length)).toEqual([6, 5])
  })

  it('counts the "more" slot only when paged', () => {
    expect(slotCount(paginate(5, 10), 0)).toBe(5)
    expect(slotCount(paginate(11, 10), 1)).toBe(6)
  })
})

describe('hitTest', () => {
  it('ignores the hub and everything outside the ring', () => {
    expect(hitTest({ x: 0, y: -30 }, 4, metrics)).toBeNull()
    expect(hitTest({ x: 0, y: -151 }, 4, metrics)).toBeNull()
    expect(hitTest({ x: 0, y: -100 }, 0, metrics)).toBeNull()
  })

  it('accepts a sloppy drop just past the edge', () => {
    expect(hitTest({ x: 0, y: -160 }, 4, metrics, 18)).toEqual({ slot: 0, zone: 'rim' })
  })

  it('puts slot 0 at the top and goes clockwise', () => {
    expect(hitTest({ x: 0, y: -100 }, 4, metrics)?.slot).toBe(0)
    expect(hitTest({ x: 100, y: 0 }, 4, metrics)?.slot).toBe(1)
    expect(hitTest({ x: 0, y: 100 }, 4, metrics)?.slot).toBe(2)
    expect(hitTest({ x: -100, y: 0 }, 4, metrics)?.slot).toBe(3)
  })

  it('agrees with slotAngles for every slot of every size', () => {
    for (let count = 1; count <= 13; count++) {
      for (let slot = 0; slot < count; slot++) {
        const { start, mid, end } = slotAngles(slot, count)
        expect(end - start).toBeCloseTo(TAU / count)
        expect(hitTest(polar(100, mid), count, metrics)?.slot).toBe(slot)
        expect(hitTest(polar(100, start + 0.01), count, metrics)?.slot).toBe(slot)
        expect(hitTest(polar(100, end - 0.01), count, metrics)?.slot).toBe(slot)
      }
    }
  })

  it('tells the options rim from the body', () => {
    expect(hitTest({ x: 0, y: -120 }, 3, metrics)?.zone).toBe('body')
    expect(hitTest({ x: 0, y: -140 }, 3, metrics)?.zone).toBe('rim')
  })
})

describe('sectorPath', () => {
  it('draws a closed ring segment', () => {
    const { start, end } = slotAngles(0, 4)
    const path = sectorPath({ x: 200, y: 200 }, 60, 150, start, end)
    expect(path).toMatch(/^M [\d.]+ [\d.]+ A 150 150 0 0 1 [\d.]+ [\d.]+ L [\d.]+ [\d.]+ A 60 60 0 0 0 [\d.]+ [\d.]+ Z$/)
    expect(path).not.toContain('NaN')
  })

  it('uses the large arc for slices wider than half a turn', () => {
    const { start, end } = slotAngles(0, 1)
    expect(sectorPath({ x: 0, y: 0 }, 60, 150, start, end, 8)).toContain('A 150 150 0 1 1')
  })

  it('survives a gap wider than the inner radius', () => {
    expect(sectorPath({ x: 0, y: 0 }, 2, 150, 0, 1, 8)).not.toContain('NaN')
  })
})

describe('clampCenter', () => {
  it('keeps the wheel inside the box', () => {
    expect(clampCenter({ x: 5, y: 500 }, 100, 400, 400)).toEqual({ x: 100, y: 300 })
    expect(clampCenter({ x: 200, y: 180 }, 100, 400, 400)).toEqual({ x: 200, y: 180 })
  })

  it('centers when the box is too small', () => {
    expect(clampCenter({ x: 5, y: 5 }, 100, 150, 400)).toEqual({ x: 75, y: 100 })
  })
})

describe('groupStable', () => {
  it('makes equal keys adjacent without reordering groups', () => {
    const items = ['mp4', 'mp3', 'mov', 'gif', 'wav']
    const kind = (ext: string): string => (ext.startsWith('m') && ext !== 'mp3' ? 'video' : ext === 'gif' ? 'image' : 'audio')
    expect(groupStable(items, kind)).toEqual(['mp4', 'mov', 'mp3', 'wav', 'gif'])
  })
})

describe('findByLetter', () => {
  const names = [
    ['JPG', 'jpg'],
    ['PNG', 'png'],
    ['Word', 'docx'],
    ['PDF', 'pdf']
  ]

  it('finds the next match after the current item and wraps', () => {
    expect(findByLetter(names, -1, 'p')).toBe(1)
    expect(findByLetter(names, 1, 'P')).toBe(3)
    expect(findByLetter(names, 3, 'p')).toBe(1)
  })

  it('matches the extension as well as the label', () => {
    expect(findByLetter(names, -1, 'd')).toBe(2)
    expect(findByLetter(names, -1, 'w')).toBe(2)
  })

  it('returns -1 when nothing matches', () => {
    expect(findByLetter(names, 0, 'z')).toBe(-1)
    expect(findByLetter([], 0, 'a')).toBe(-1)
  })
})

describe('wheelNav', () => {
  const single = paginate(4, 10)
  const paged = paginate(20, 10)

  it('starts unfocused and enters from either end', () => {
    expect(wheelNav({ page: 0, slot: -1 }, { type: 'next' }, single)).toEqual({ page: 0, slot: 0 })
    expect(wheelNav({ page: 0, slot: -1 }, { type: 'prev' }, single)).toEqual({ page: 0, slot: 3 })
  })

  it('wraps around the ring, including the "more" slot', () => {
    expect(wheelNav({ page: 0, slot: 3 }, { type: 'next' }, single).slot).toBe(0)
    expect(wheelNav({ page: 0, slot: 0 }, { type: 'prev' }, paged).slot).toBe(7)
    expect(slotContent(paged, { page: 0, slot: 7 })).toBe('more')
  })

  it('turns pages and wraps back to the first', () => {
    let state = { page: 0, slot: 7 }
    state = wheelNav(state, { type: 'more' }, paged)
    expect(state).toEqual({ page: 1, slot: 0 })
    state = wheelNav(wheelNav(state, { type: 'more' }, paged), { type: 'more' }, paged)
    expect(state.page).toBe(0)
    expect(wheelNav({ page: 0, slot: 2 }, { type: 'more' }, single)).toEqual({ page: 0, slot: 2 })
  })

  it('jumps to a target on another page', () => {
    const state = wheelNav({ page: 0, slot: 0 }, { type: 'jump', index: 15 }, paged)
    expect(state).toEqual({ page: 2, slot: 1 })
    expect(slotContent(paged, state)).toBe(15)
  })

  it('rejects slots that do not exist', () => {
    expect(wheelNav({ page: 0, slot: 1 }, { type: 'slot', slot: 9 }, single).slot).toBe(-1)
    expect(slotContent(single, { page: 0, slot: -1 })).toBeNull()
    expect(slotContent(single, { page: 0, slot: 4 })).toBeNull()
    expect(wheelNav({ page: 3, slot: 2 }, { type: 'next' }, [])).toEqual({ page: 0, slot: -1 })
  })
})
