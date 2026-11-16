/**
 * Pure geometry and navigation for the radial format wheel.
 *
 * Angles are in radians, clockwise, with slot 0 centered at 12 o'clock.
 * Points are relative to the wheel center unless stated otherwise.
 */

export const TAU = Math.PI * 2

export interface Point {
  x: number
  y: number
}

export interface WheelMetrics {
  /** Outer radius of the ring. */
  outer: number
  /** Inner radius of the ring (the hub lives inside). */
  inner: number
  /** Width of the outer band that opens the options sheet. */
  rim: number
  /** How many slots fit on one page at this size. */
  capacity: number
}

export type Zone = 'body' | 'rim'

export interface Hit {
  slot: number
  zone: Zone
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/** Sizes the wheel for the area it may occupy. */
export function wheelMetrics(width: number, height: number): WheelMetrics {
  const outer = clamp(Math.min(width, height) / 2 - 10, 96, 190)
  const inner = outer * 0.4
  const rim = 14
  const mid = (inner + outer - rim) / 2
  const capacity = clamp(Math.floor((TAU * mid) / 62), 6, 12)
  return { outer, inner, rim, capacity }
}

/**
 * Splits `count` targets into pages of slot indices. A single page shows
 * everything; several pages each reserve one extra slot for "more", so a page
 * holds at most `capacity - 1` targets. Pages are balanced in size.
 */
export function paginate(count: number, capacity: number): number[][] {
  if (count <= 0) return []
  const all = Array.from({ length: count }, (_, index) => index)
  if (count <= capacity) return [all]
  const perPage = Math.max(1, capacity - 1)
  const pageCount = Math.ceil(count / perPage)
  const size = Math.ceil(count / pageCount)
  const pages: number[][] = []
  for (let start = 0; start < count; start += size) pages.push(all.slice(start, start + size))
  return pages
}

/** Number of slots drawn for a page, including the "more" slot when paged. */
export function slotCount(pages: number[][], page: number): number {
  const items = pages[page]?.length ?? 0
  return pages.length > 1 ? items + 1 : items
}

/** Start, middle and end angle of a slot. */
export function slotAngles(slot: number, count: number): { start: number; mid: number; end: number } {
  const step = TAU / Math.max(1, count)
  const mid = -Math.PI / 2 + slot * step
  return { start: mid - step / 2, mid, end: mid + step / 2 }
}

export function polar(radius: number, angle: number): Point {
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
}

/**
 * Which slot a point falls on. `slack` extends the ring outwards so a sloppy
 * drop just past the edge still counts.
 */
export function hitTest(point: Point, count: number, metrics: WheelMetrics, slack = 0): Hit | null {
  if (count <= 0) return null
  const distance = Math.hypot(point.x, point.y)
  if (distance < metrics.inner || distance > metrics.outer + slack) return null
  const step = TAU / count
  const angle = Math.atan2(point.y, point.x) + Math.PI / 2 + step / 2
  const slot = Math.floor((((angle % TAU) + TAU) % TAU) / step) % count
  return { slot, zone: distance >= metrics.outer - metrics.rim ? 'rim' : 'body' }
}

const fmt = (value: number): string => String(Math.round(value * 100) / 100)

/**
 * SVG path of a ring segment between two radii and two angles, inset on both
 * sides by half of `gap` pixels so neighbours are separated by a constant gap.
 */
export function sectorPath(
  center: Point,
  innerRadius: number,
  outerRadius: number,
  start: number,
  end: number,
  gap = 0
): string {
  const insetOuter = Math.asin(Math.min(1, gap / 2 / outerRadius))
  const insetInner = Math.asin(Math.min(1, gap / 2 / innerRadius))
  const at = (radius: number, angle: number): string => {
    const p = polar(radius, angle)
    return `${fmt(center.x + p.x)} ${fmt(center.y + p.y)}`
  }
  const largeOuter = end - start - 2 * insetOuter > Math.PI ? 1 : 0
  const largeInner = end - start - 2 * insetInner > Math.PI ? 1 : 0
  return [
    `M ${at(outerRadius, start + insetOuter)}`,
    `A ${fmt(outerRadius)} ${fmt(outerRadius)} 0 ${largeOuter} 1 ${at(outerRadius, end - insetOuter)}`,
    `L ${at(innerRadius, end - insetInner)}`,
    `A ${fmt(innerRadius)} ${fmt(innerRadius)} 0 ${largeInner} 0 ${at(innerRadius, start + insetInner)}`,
    'Z'
  ].join(' ')
}

/** Keeps a wheel of the given radius fully inside a box, centering it when the box is too small. */
export function clampCenter(point: Point, radius: number, width: number, height: number): Point {
  const axis = (value: number, size: number): number =>
    size < radius * 2 ? size / 2 : clamp(value, radius, size - radius)
  return { x: axis(point.x, width), y: axis(point.y, height) }
}

/** Stable grouping: items keep their order, but equal keys become adjacent. */
export function groupStable<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  return [...groups.values()].flat()
}

/**
 * Next item after `from` (wrapping) with a name starting with `letter`.
 * Each item may have several names (label and extension). Returns -1 when none match.
 */
export function findByLetter(names: readonly (readonly string[])[], from: number, letter: string): number {
  const needle = letter.toLowerCase()
  if (!needle) return -1
  for (let offset = 1; offset <= names.length; offset++) {
    const index = (((from + offset) % names.length) + names.length) % names.length
    if (names[index].some((name) => name.toLowerCase().startsWith(needle))) return index
  }
  return -1
}

/** Keyboard focus inside the wheel. `slot` is -1 until the user moves. */
export interface WheelNav {
  page: number
  slot: number
}

export type WheelNavAction =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'first' }
  | { type: 'last' }
  | { type: 'slot'; slot: number }
  | { type: 'more' }
  /** Focus a target by its index in the full (unpaged) list. */
  | { type: 'jump'; index: number }

export function wheelNav(state: WheelNav, action: WheelNavAction, pages: number[][]): WheelNav {
  if (pages.length === 0) return { page: 0, slot: -1 }
  const count = slotCount(pages, state.page)
  switch (action.type) {
    case 'next':
      return { ...state, slot: state.slot < 0 ? 0 : (state.slot + 1) % count }
    case 'prev':
      return { ...state, slot: state.slot < 0 ? count - 1 : (state.slot - 1 + count) % count }
    case 'first':
      return { ...state, slot: 0 }
    case 'last':
      return { ...state, slot: count - 1 }
    case 'slot':
      return { ...state, slot: action.slot >= 0 && action.slot < count ? action.slot : -1 }
    case 'more':
      return pages.length > 1 ? { page: (state.page + 1) % pages.length, slot: 0 } : state
    case 'jump': {
      for (let page = 0; page < pages.length; page++) {
        const slot = pages[page].indexOf(action.index)
        if (slot !== -1) return { page, slot }
      }
      return state
    }
  }
}

/** What the focused slot holds: a target index, the "more" slot, or nothing. */
export function slotContent(pages: number[][], nav: WheelNav): number | 'more' | null {
  const items = pages[nav.page]
  if (!items || nav.slot < 0) return null
  if (nav.slot < items.length) return items[nav.slot]
  return pages.length > 1 && nav.slot === items.length ? 'more' : null
}
