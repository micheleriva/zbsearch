import { defineComponent, h } from 'vue'

const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.7,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round'
} as const

function icon(name: string, paths: () => ReturnType<typeof h>[]) {
  return defineComponent({
    name,
    setup() {
      return () => h('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true', ...strokeProps }, paths())
    }
  })
}

export const SearchIcon = icon('SearchIcon', () => [
  h('circle', { cx: 9, cy: 9, r: 5.25 }),
  h('path', { d: 'm13 13 3.5 3.5' })
])

export const CloseIcon = icon('CloseIcon', () => [h('path', { d: 'm5.5 5.5 9 9M14.5 5.5l-9 9' })])

export const PageIcon = icon('PageIcon', () => [
  h('path', { d: 'M11.5 2.75H6a1.75 1.75 0 0 0-1.75 1.75v11A1.75 1.75 0 0 0 6 17.25h8a1.75 1.75 0 0 0 1.75-1.75V7z' }),
  h('path', { d: 'M11.5 2.75V7h4.25' })
])

export const SectionIcon = icon('SectionIcon', () => [
  h('path', { d: 'M7.75 3.5 6 16.5M14 3.5l-1.75 13M3.75 7.25h12.5M3 12.75h12.5' })
])

export const EnterIcon = icon('EnterIcon', () => [
  h('path', { d: 'M16 5v4.25a2.25 2.25 0 0 1-2.25 2.25H5' }),
  h('path', { d: 'm8 8.25-3 3.25 3 3.25' })
])

export const ArrowUpIcon = icon('ArrowUpIcon', () => [h('path', { d: 'M10 15.5v-11M5.75 8.75 10 4.5l4.25 4.25' })])

export const ArrowDownIcon = icon('ArrowDownIcon', () => [h('path', { d: 'M10 4.5v11M5.75 11.25 10 15.5l4.25-4.25' })])

export const HistoryIcon = icon('HistoryIcon', () => [
  h('path', { d: 'M3.75 10a6.25 6.25 0 1 0 1.9-4.48' }),
  h('path', { d: 'M3.25 3.5v3.25H6.5' }),
  h('path', { d: 'M10 6.75V10l2.25 1.5' })
])

export const ErrorIcon = icon('ErrorIcon', () => [
  h('circle', { cx: 10, cy: 10, r: 7.25 }),
  h('path', { d: 'M10 6.5v4M10 13.4v.1' })
])
