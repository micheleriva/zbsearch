import { useEffect, useRef, useState } from 'react'

export function useIsMounted(): boolean {
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  return mounted
}

export function useIsApplePlatform(): boolean {
  const [isApple, setIsApple] = useState(false)

  useEffect(() => {
    setIsApple(/mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent))
  }, [])

  return isApple
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function useSearchHotkeys(onTrigger: () => void, enabled = true): void {
  const handlerRef = useRef(onTrigger)
  handlerRef.current = onTrigger

  useEffect(() => {
    if (!enabled) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const isPaletteShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
      const isSlashShortcut = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey

      if (!isPaletteShortcut && !isSlashShortcut) {
        return
      }

      if (isSlashShortcut && isEditableTarget(event.target)) {
        return
      }

      event.preventDefault()
      handlerRef.current()
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return
    }
    const { body, documentElement } = document
    const previousOverflow = body.style.overflow
    const previousPadding = body.style.paddingRight
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth

    body.style.overflow = 'hidden'

    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`
    }

    return () => {
      body.style.overflow = previousOverflow
      body.style.paddingRight = previousPadding
    }
  }, [active])
}
