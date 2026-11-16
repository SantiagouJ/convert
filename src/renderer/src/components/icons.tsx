import type { ReactNode } from 'react'

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export const CloseIcon = () => (
  <Icon>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
)

export const SlidersIcon = () => (
  <Icon>
    <path d="M2.5 5h5M11.5 5h2M2.5 11h2M8.5 11h5" />
    <circle cx="9.5" cy="5" r="1.8" />
    <circle cx="6.5" cy="11" r="1.8" />
  </Icon>
)

export const FolderIcon = () => (
  <Icon>
    <path d="M2 4.5a1 1 0 011-1h3l1.5 1.5H13a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1z" />
  </Icon>
)

export const CheckIcon = () => (
  <Icon>
    <path d="M3.5 8.5l3 3 6-7" />
  </Icon>
)

export const AlertIcon = () => (
  <Icon>
    <path d="M8 2.5l6 10.5H2z" />
    <path d="M8 6.5v3M8 11.4v.1" />
  </Icon>
)

export const ChevronIcon = () => (
  <Icon>
    <path d="M4 10l4-4 4 4" />
  </Icon>
)

export const BackIcon = () => (
  <Icon>
    <path d="M9.5 3.5L5 8l4.5 4.5" />
  </Icon>
)

/** The product mark: a ring of three petals, one swung open. */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <g fill="none" strokeWidth="3.4" strokeLinecap="round">
        <path d="M10 3.2a6.8 6.8 0 015.9 3.4" stroke="var(--cat-image)" />
        <path d="M16.6 11.6a6.8 6.8 0 01-5.2 5" stroke="var(--cat-document)" />
        <path d="M6.4 15.8A6.8 6.8 0 014.1 6.6" stroke="var(--cat-audio)" />
      </g>
    </svg>
  )
}
