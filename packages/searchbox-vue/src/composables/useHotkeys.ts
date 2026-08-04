import { onMounted, onScopeDispose, type Ref, ref, watch } from 'vue'

export function useIsMounted(): Ref<boolean> {
  const mounted = ref(false)

  onMounted(() => {
    mounted.value = true
  })

  return mounted
}

export function useIsApplePlatform(): Ref<boolean> {
  const isApple = ref(false)

  onMounted(() => {
    isApple.value = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent)
  })

  return isApple
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function useSearchHotkeys(onTrigger: () => void, enabled: Ref<boolean> | boolean = true): void {
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
    onTrigger()
  }

  const bind = (active: boolean) => {
    window.removeEventListener('keydown', onKeyDown)

    if (active) {
      window.addEventListener('keydown', onKeyDown)
    }
  }

  onMounted(() => {
    if (typeof enabled === 'boolean') {
      bind(enabled)
      return
    }

    watch(enabled, bind, { immediate: true })
  })

  onScopeDispose(() => window.removeEventListener('keydown', onKeyDown))
}

export function useScrollLock(active: Ref<boolean>): void {
  let restore: (() => void) | undefined

  const release = () => {
    restore?.()
    restore = undefined
  }

  watch(active, (locked) => {
    release()

    if (!locked) {
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

    restore = () => {
      body.style.overflow = previousOverflow
      body.style.paddingRight = previousPadding
    }
  })

  onScopeDispose(release)
}
