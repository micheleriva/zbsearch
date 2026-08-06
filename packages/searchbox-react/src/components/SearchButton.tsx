import { useIsApplePlatform } from '../hooks/useHotkeys.js'
import { SearchIcon } from './icons.js'

export interface SearchButtonProps {
  onClick: () => void
  label?: string
  ariaLabel?: string
  shortcut?: boolean
  className?: string
}

export function SearchButton({
  onClick,
  label = 'Search',
  ariaLabel = 'Search (Command+K)',
  shortcut = true,
  className
}: SearchButtonProps) {
  const isApple = useIsApplePlatform()

  return (
    <button
      type="button"
      className={className ? `zbs-search-button ${className}` : 'zbs-search-button'}
      aria-label={ariaLabel}
      data-testid="zbs-search-button"
      onClick={onClick}
    >
      <span className="zbs-search-button__icon" aria-hidden="true">
        <SearchIcon />
      </span>
      <span className="zbs-search-button__label">{label}</span>
      {shortcut ? (
        <span className="zbs-search-button__keys" aria-hidden="true">
          <kbd className="zbs-search-button__kbd">{isApple ? '⌘' : 'Ctrl'}</kbd>
          <kbd className="zbs-search-button__kbd">K</kbd>
        </span>
      ) : null}
    </button>
  )
}
