interface IconProps {
  className?: string
}

const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const

export function SearchIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true" {...strokeProps}>
      <circle cx="9" cy="9" r="5.25" />
      <path d="m13 13 3.5 3.5" />
    </svg>
  )
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true" {...strokeProps}>
      <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
    </svg>
  )
}

export function PageIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true" {...strokeProps}>
      <path d="M11.5 2.75H6a1.75 1.75 0 0 0-1.75 1.75v11A1.75 1.75 0 0 0 6 17.25h8a1.75 1.75 0 0 0 1.75-1.75V7z" />
      <path d="M11.5 2.75V7h4.25" />
    </svg>
  )
}

export function SectionIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true" {...strokeProps}>
      <path d="M7.75 3.5 6 16.5M14 3.5l-1.75 13M3.75 7.25h12.5M3 12.75h12.5" />
    </svg>
  )
}

export function EnterIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true" {...strokeProps}>
      <path d="M16 5v4.25a2.25 2.25 0 0 1-2.25 2.25H5" />
      <path d="m8 8.25-3 3.25 3 3.25" />
    </svg>
  )
}

export function ArrowUpIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true" {...strokeProps}>
      <path d="M10 15.5v-11M5.75 8.75 10 4.5l4.25 4.25" />
    </svg>
  )
}

export function ArrowDownIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true" {...strokeProps}>
      <path d="M10 4.5v11M5.75 11.25 10 15.5l4.25-4.25" />
    </svg>
  )
}

export function HistoryIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true" {...strokeProps}>
      <path d="M3.75 10a6.25 6.25 0 1 0 1.9-4.48" />
      <path d="M3.25 3.5v3.25H6.5" />
      <path d="M10 6.75V10l2.25 1.5" />
    </svg>
  )
}

export function ErrorIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true" {...strokeProps}>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 6.5v4M10 13.4v.1" />
    </svg>
  )
}
