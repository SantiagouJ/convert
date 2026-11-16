import {
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type Ref
} from 'react'
import type { TargetOption } from '@shared/types'
import { CATEGORY_LABEL, categoryColor } from '../lib/categories'
import {
  clampCenter,
  findByLetter,
  groupStable,
  hitTest,
  paginate,
  polar,
  sectorPath,
  slotAngles,
  wheelMetrics,
  wheelNav,
  type Point,
  type WheelNav,
  type WheelNavAction,
  type Zone
} from '../lib/wheel'

export interface WheelHandle {
  /** The target under a viewport point, for resolving a file drop. */
  hitAt: (clientX: number, clientY: number) => { target: TargetOption; withOptions: boolean } | null
}

interface WheelProps {
  ref?: Ref<WheelHandle>
  targets: TargetOption[]
  /** Size of the area the wheel may use. */
  width: number
  height: number
  /** Where the wheel should bloom (area coordinates). Centered when null. */
  origin: Point | null
  /** Short description of the source files, shown in the hub. */
  sourceLabel: string
  /** Files are being dragged over the window right now. */
  dragging?: boolean
  onPick: (target: TargetOption, withOptions: boolean) => void
  onCancel: () => void
}

type Slot = { kind: 'target'; target: TargetOption; index: number } | { kind: 'more' }

// Slice bodies are stroked 4px in their own colour to round the corners, which eats into the gap.
const GAP = 8
const RIM_GAP = 4
const DROP_SLACK = 18
const MORE_DWELL_MS = 700

const short = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export function Wheel({ ref, targets, width, height, origin, sourceLabel, dragging = false, onPick, onCancel }: WheelProps) {
  const uid = useId()
  const svgRef = useRef<SVGSVGElement>(null)
  const [rawNav, setNav] = useState<WheelNav>({ page: 0, slot: -1 })
  const [zone, setZone] = useState<Zone>('body')
  const [overHub, setOverHub] = useState(false)

  const ordered = useMemo(() => groupStable(targets, (target) => target.format.category), [targets])
  const metrics = wheelMetrics(width, height)
  const center = origin
    ? clampCenter(origin, metrics.outer + 4, width, height)
    : { x: width / 2, y: height / 2 }
  const pages = useMemo(() => paginate(ordered.length, metrics.capacity), [ordered.length, metrics.capacity])

  // A resize can change how many pages exist; never point past the end.
  const page = Math.min(rawNav.page, Math.max(0, pages.length - 1))
  const slots: Slot[] = (pages[page] ?? []).map((index) => ({ kind: 'target', target: ordered[index], index }))
  if (pages.length > 1) slots.push({ kind: 'more' })
  const nav: WheelNav = { page, slot: rawNav.slot < slots.length ? rawNav.slot : -1 }
  const active = nav.slot >= 0 ? slots[nav.slot] : null

  const dispatch = (action: WheelNavAction): void => setNav((state) => wheelNav({ ...state, page }, action, pages))

  const locate = (clientX: number, clientY: number, slack = 0) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { hit: null, inHub: false }
    const point = { x: clientX - rect.left - center.x, y: clientY - rect.top - center.y }
    return {
      hit: hitTest(point, slots.length, metrics, slack),
      inHub: Math.hypot(point.x, point.y) < metrics.inner
    }
  }

  const hasOptions = (slot: Slot | undefined): boolean => slot?.kind === 'target' && slot.target.options.length > 0

  const point = (clientX: number, clientY: number, slack = 0): void => {
    const { hit, inHub } = locate(clientX, clientY, slack)
    setOverHub(inHub)
    dispatch({ type: 'slot', slot: hit ? hit.slot : -1 })
    setZone(hit && hit.zone === 'rim' && hasOptions(slots[hit.slot]) ? 'rim' : 'body')
  }

  const activate = (slotIndex: number, withOptions: boolean): void => {
    const slot = slots[slotIndex]
    if (!slot) return
    if (slot.kind === 'more') dispatch({ type: 'more' })
    else onPick(slot.target, withOptions && slot.target.options.length > 0)
  }

  useImperativeHandle(ref, () => ({
    hitAt: (clientX, clientY) => {
      const { hit } = locate(clientX, clientY, DROP_SLACK)
      const slot = hit ? slots[hit.slot] : undefined
      if (!hit || slot?.kind !== 'target') return null
      return { target: slot.target, withOptions: hit.zone === 'rim' && slot.target.options.length > 0 }
    }
  }))

  // Keyboard users land on the wheel as soon as it appears.
  useEffect(() => {
    if (!dragging) svgRef.current?.focus({ preventScroll: true })
  }, [dragging])

  // A drag cannot click "more", so hovering it for a moment turns the page.
  const dwelling = dragging && active?.kind === 'more'
  useEffect(() => {
    if (!dwelling) return
    const timer = window.setTimeout(() => {
      setNav((state) => ({ ...wheelNav({ ...state, page }, { type: 'more' }, pages), slot: -1 }))
    }, MORE_DWELL_MS)
    return () => window.clearTimeout(timer)
  }, [dwelling, page, pages])

  const onKeyDown = (event: KeyboardEvent | globalThis.KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey) return
    const moves: Record<string, WheelNavAction> = {
      ArrowRight: { type: 'next' },
      ArrowDown: { type: 'next' },
      ArrowLeft: { type: 'prev' },
      ArrowUp: { type: 'prev' },
      Home: { type: 'first' },
      End: { type: 'last' },
      PageDown: { type: 'more' },
      PageUp: { type: 'more' }
    }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      setZone('body')
      dispatch(move)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (nav.slot >= 0) activate(nav.slot, event.shiftKey || event.altKey)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    } else if (event.key.length === 1 && !event.altKey && /\S/.test(event.key)) {
      const from = active?.kind === 'target' ? active.index : -1
      const names = ordered.map((target) => [target.format.label, target.format.ext])
      const index = findByLetter(names, from, event.key)
      if (index !== -1) {
        event.preventDefault()
        setZone('body')
        dispatch({ type: 'jump', index })
      }
    }
  }

  // Focus can fall back to the page (a focused button was removed, the user
  // clicked empty space). The wheel still answers the keyboard then.
  const keyHandler = useRef(onKeyDown)
  useEffect(() => {
    keyHandler.current = onKeyDown
  })
  useEffect(() => {
    if (dragging) return
    const onWindowKey = (event: globalThis.KeyboardEvent): void => {
      if (document.activeElement !== document.body) return
      svgRef.current?.focus({ preventScroll: true })
      keyHandler.current(event)
    }
    window.addEventListener('keydown', onWindowKey)
    return () => window.removeEventListener('keydown', onWindowKey)
  }, [dragging])

  const bodyOuter = metrics.outer - metrics.rim - 5
  const labelRadius = (metrics.inner + bodyOuter) / 2
  const rimRadius = metrics.outer - metrics.rim / 2
  const step = (Math.PI * 2) / Math.max(1, slots.length)
  const arcRoom = step * labelRadius - GAP - 10
  const slotId = (index: number): string => `${uid}-slot-${index}`

  let hubMain = dragging ? 'Drop' : 'Convert'
  let hubSub = dragging ? 'on a format' : 'to…'
  if (active?.kind === 'target') {
    hubMain = active.target.format.label
    hubSub = zone === 'rim' ? 'with options…' : CATEGORY_LABEL[active.target.format.category]
  } else if (active?.kind === 'more') {
    hubMain = 'More'
    hubSub = `page ${page + 1} of ${pages.length}`
  } else if (overHub && !dragging) {
    hubMain = 'Cancel'
    hubSub = 'clear selection'
  }

  return (
    <svg
      ref={svgRef}
      className={`wheel${dragging ? ' is-dragging' : ''}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="listbox"
      tabIndex={0}
      aria-label={`Convert ${sourceLabel} to`}
      aria-activedescendant={nav.slot >= 0 ? slotId(nav.slot) : undefined}
      onKeyDown={onKeyDown}
      onPointerMove={(event) => point(event.clientX, event.clientY)}
      onPointerLeave={() => {
        setOverHub(false)
        dispatch({ type: 'slot', slot: -1 })
      }}
      onClick={(event) => {
        const { hit, inHub } = locate(event.clientX, event.clientY)
        if (hit) {
          activate(hit.slot, event.shiftKey || event.altKey || (hit.zone === 'rim' && hasOptions(slots[hit.slot])))
          // After turning the page the highlight waits for the pointer to move again.
          if (slots[hit.slot]?.kind === 'more') setNav((state) => ({ ...state, slot: -1 }))
        } else if (inHub) onCancel()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        const { hit } = locate(event.clientX, event.clientY)
        if (hit) activate(hit.slot, true)
      }}
      onDragEnter={(event) => point(event.clientX, event.clientY, DROP_SLACK)}
      onDragOver={(event) => point(event.clientX, event.clientY, DROP_SLACK)}
      onDragLeave={(event) => {
        // dragleave also bubbles up from every slice the pointer crosses; only leaving the wheel counts.
        const next = event.relatedTarget
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) dispatch({ type: 'slot', slot: -1 })
      }}
    >
      <g key={page}>
        {slots.map((slot, index) => {
          const { start, mid, end } = slotAngles(index, slots.length)
          const isActive = index === nav.slot
          const labelAt = polar(labelRadius, mid)
          const style = {
            '--i': index,
            '--cat': slot.kind === 'target' ? categoryColor(slot.target.format.category) : 'var(--muted)',
            transformOrigin: `${center.x}px ${center.y}px`
          } as CSSProperties
          const withOptions = hasOptions(slot)
          let label = 'More'
          let aria = `More formats, page ${page + 1} of ${pages.length}`
          if (slot.kind === 'target') {
            const { format } = slot.target
            label = format.label.length * 7.4 <= arcRoom ? format.label : format.ext.toUpperCase()
            aria = `${format.label}, ${CATEGORY_LABEL[format.category]}${withOptions ? ', has options' : ''}`
          }
          const classes = [
            'slice',
            slot.kind === 'more' ? 'is-more' : '',
            isActive ? 'is-active' : '',
            isActive && zone === 'rim' ? 'is-rim' : '',
            isActive && dwelling ? 'is-dwelling' : '',
            withOptions ? 'has-options' : ''
          ]
          return (
            <g
              key={slot.kind === 'target' ? slot.target.format.ext : 'more'}
              id={slotId(index)}
              role="option"
              aria-selected={isActive}
              aria-label={aria}
              className={classes.filter(Boolean).join(' ')}
              style={style}
            >
              <path className="slice-body" d={sectorPath(center, metrics.inner, bodyOuter, start, end, GAP)} />
              <path
                className="slice-rim"
                d={sectorPath(center, metrics.outer - metrics.rim, metrics.outer, start, end, RIM_GAP)}
              />
              {withOptions &&
                [-1, 0, 1].map((offset) => {
                  const dot = polar(rimRadius, mid + (offset * 7) / rimRadius)
                  return <circle key={offset} className="slice-dot" cx={center.x + dot.x} cy={center.y + dot.y} r={1.6} />
                })}
              <text className="slice-label" x={center.x + labelAt.x} y={center.y + labelAt.y}>
                {label}
              </text>
              {slot.kind === 'more' && (
                <text className="slice-sub" x={center.x + labelAt.x} y={center.y + labelAt.y + 14}>
                  {page + 1}/{pages.length}
                </text>
              )}
            </g>
          )
        })}
      </g>

      <g className={`hub${overHub && !dragging ? ' is-hover' : ''}`} aria-hidden="true">
        <circle cx={center.x} cy={center.y} r={metrics.inner - 7} />
        <text className="hub-source" x={center.x} y={center.y - 20}>
          {short(sourceLabel, 16)}
        </text>
        <text className={`hub-main${hubMain.length > 9 ? ' is-long' : ''}`} x={center.x} y={center.y + 2}>
          {hubMain}
        </text>
        <text className="hub-sub" x={center.x} y={center.y + 22}>
          {hubSub}
        </text>
      </g>
    </svg>
  )
}
