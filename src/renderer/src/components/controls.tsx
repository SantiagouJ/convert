import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'

interface ModalProps {
  label: string
  className: string
  onClose: () => void
  children: ReactNode
}

/** Dialog shell: traps Tab, closes on Escape or a click on the scrim, restores focus afterwards. */
export function Modal({ label, className, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // The wheel is an SVG element, so HTMLElement alone would miss it.
    const active = document.activeElement
    const previous = active instanceof HTMLElement || active instanceof SVGElement ? active : null
    const node = ref.current
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? node)?.focus()
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !ref.current) return
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={ref} className={className} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>
  )
}

interface SegmentedProps<T extends string> {
  label: string
  value: T
  choices: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}

/** Radio group drawn as one segmented bar. Arrow keys move the choice. */
export function Segmented<T extends string>({ label, value, choices, onChange }: SegmentedProps<T>) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (!delta) return
    event.preventDefault()
    const index = choices.findIndex((choice) => choice.value === value)
    const next = choices[(index + delta + choices.length) % choices.length]
    onChange(next.value)
    const buttons = event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')
    buttons[choices.indexOf(next)]?.focus()
  }

  return (
    <div className="segmented" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          role="radio"
          aria-checked={choice.value === value}
          tabIndex={choice.value === value ? 0 : -1}
          onClick={() => onChange(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  )
}

interface SwitchProps {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}

/** A full-width row whose whole surface toggles the switch. */
export function SwitchRow({ label, hint, checked, onChange }: SwitchProps) {
  return (
    <button type="button" className="row switch-row" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span className="row-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <span className="switch" aria-hidden="true" />
    </button>
  )
}
