<script setup lang="ts">
import {
  addRecentSearch,
  DEFAULT_RECENT_SEARCHES_KEY,
  flattenGroups,
  groupHits,
  type RecentSearch,
  readRecentSearches,
  removeRecentSearch,
  resolveLabels,
  type SearchBoxLabels,
  type SearchHit,
  type Searcher,
  wrapIndex
} from '@zbsearch/searchbox-core'
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useIsMounted, useScrollLock } from '../composables/useHotkeys.js'
import { useSearch } from '../composables/useSearch.js'
import Highlighted from './Highlighted.vue'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CloseIcon,
  EnterIcon,
  ErrorIcon,
  HistoryIcon,
  PageIcon,
  SearchIcon,
  SectionIcon
} from './icons.js'
import { ZBSearchWordmark } from './ZBSearchWordmark.js'

const ZBSEARCH_URL = 'https://zbsearch.dev'
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

const props = withDefaults(
  defineProps<{
    open: boolean
    searcher: Searcher
    onNavigate?: (url: string, hit: SearchHit) => void
    labels?: Partial<SearchBoxLabels>
    debounceMs?: number
    recentSearches?: boolean
    recentSearchesKey?: string
  }>(),
  {
    debounceMs: 0,
    recentSearches: true,
    recentSearchesKey: DEFAULT_RECENT_SEARCHES_KEY
  }
)

const emit = defineEmits<{ close: [] }>()

const labels = computed(() => resolveLabels(props.labels))
const mounted = useIsMounted()
const { term, hits, status, reset } = useSearch(() => props.searcher, props.debounceMs)

const recents = ref<RecentSearch[]>([])
const selected = ref(0)

const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
let restoreFocus: Element | null = null
let backdropMouseDown = false

const baseId = useId()
const listboxId = `zbs-searchbox-list-${baseId}`
const optionId = (index: number) => `zbs-searchbox-option-${baseId}-${index}`

const isOpen = computed(() => props.open)

useScrollLock(isOpen)

const groups = computed(() => groupHits(hits.value))

type BodyState = 'recent' | 'empty-start' | 'loading' | 'error' | 'no-results' | 'results'

const bodyState = computed<BodyState>(() => {
  if (term.value.trim() === '') {
    return props.recentSearches && recents.value.length > 0 ? 'recent' : 'empty-start'
  }

  if (status.value === 'error') {
    return 'error'
  }

  if (hits.value.length > 0) {
    return 'results'
  }

  return status.value === 'loading' ? 'loading' : 'no-results'
})

function recentToHit(recent: RecentSearch): SearchHit {
  return { ...recent, snippet: undefined, category: undefined }
}

const navigable = computed<SearchHit[]>(() => {
  if (bodyState.value === 'results') {
    return flattenGroups(groups.value)
  }

  return bodyState.value === 'recent' ? recents.value.map(recentToHit) : []
})

const flatIndex = computed(() => new Map(navigable.value.map((hit, index) => [hit.id, index])))

watch(navigable, () => {
  selected.value = 0
})

watch(
  () => props.open,
  async (open) => {
    if (open) {
      restoreFocus = document.activeElement
      recents.value = props.recentSearches ? readRecentSearches(window.localStorage, props.recentSearchesKey) : []
      selected.value = 0

      await nextTick()
      inputRef.value?.focus()
      return
    }

    reset()

    if (restoreFocus instanceof HTMLElement && restoreFocus.isConnected) {
      restoreFocus.focus()
    }

    restoreFocus = null
  }
)

watch([selected, navigable], async () => {
  if (navigable.value.length === 0) {
    return
  }

  await nextTick()
  listRef.value?.querySelector(`#${CSS.escape(optionId(selected.value))}`)?.scrollIntoView({ block: 'nearest' })
})

function navigate(hit: SearchHit): void {
  if (props.recentSearches) {
    addRecentSearch(window.localStorage, hit, props.recentSearchesKey)
  }

  emit('close')

  if (props.onNavigate) {
    props.onNavigate(hit.url, hit)
    return
  }

  window.location.assign(hit.url)
}

function trapTab(event: KeyboardEvent): void {
  const panel = panelRef.value

  if (!panel) {
    return
  }

  const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)

  if (focusable.length === 0) {
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement

  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
    return
  }

  if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

function onKeyDown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'Tab':
      trapTab(event)
      return
    case 'Escape':
      event.preventDefault()
      emit('close')
      return
    case 'ArrowDown':
      event.preventDefault()
      selected.value = wrapIndex(selected.value, 1, navigable.value.length)
      return
    case 'ArrowUp':
      event.preventDefault()
      selected.value = wrapIndex(selected.value, -1, navigable.value.length)
      return
    case 'Home':
      if (navigable.value.length > 0) {
        event.preventDefault()
        selected.value = 0
      }
      return
    case 'End':
      if (navigable.value.length > 0) {
        event.preventDefault()
        selected.value = navigable.value.length - 1
      }
      return
    case 'Enter': {
      const hit = navigable.value[selected.value]

      if (!hit) {
        return
      }

      event.preventDefault()
      navigate(hit)
    }
  }
}

function onBackdropMouseDown(event: MouseEvent): void {
  backdropMouseDown = event.target === event.currentTarget
}

function onBackdropClick(event: MouseEvent): void {
  if (backdropMouseDown && event.target === event.currentTarget) {
    emit('close')
  }

  backdropMouseDown = false
}

function onRowClick(event: MouseEvent, hit: SearchHit): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
    return
  }

  event.preventDefault()
  navigate(hit)
}

function clear(): void {
  reset()
  inputRef.value?.focus()
}

function dropRecent(url: string): void {
  recents.value = removeRecentSearch(window.localStorage, url, props.recentSearchesKey)
  inputRef.value?.focus()
}
</script>

<template>
  <Teleport v-if="open && mounted" to="body">
    <div
      class="zbs-searchbox-backdrop"
      data-testid="zbs-searchbox-backdrop"
      @mousedown="onBackdropMouseDown"
      @click="onBackdropClick"
    >
      <div
        ref="panelRef"
        class="zbs-searchbox"
        role="dialog"
        aria-modal="true"
        :aria-label="labels.dialogLabel"
        data-testid="zbs-searchbox"
        @keydown="onKeyDown"
      >
        <div class="zbs-searchbox__header">
          <span class="zbs-searchbox__input-icon" aria-hidden="true">
            <SearchIcon />
          </span>

          <input
            ref="inputRef"
            v-model="term"
            class="zbs-searchbox__input"
            data-testid="zbs-searchbox-input"
            type="search"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            enterkeyhint="go"
            :placeholder="labels.placeholder"
            :aria-label="labels.inputLabel"
            role="combobox"
            :aria-expanded="navigable.length > 0"
            :aria-controls="listboxId"
            :aria-activedescendant="navigable.length > 0 ? optionId(selected) : undefined"
          />

          <button
            v-if="term"
            type="button"
            class="zbs-searchbox__clear"
            :aria-label="labels.clearLabel"
            @click="clear"
          >
            <CloseIcon />
          </button>

          <button
            type="button"
            class="zbs-searchbox__close"
            :aria-label="labels.closeLabel"
            data-testid="zbs-searchbox-close"
            @click="emit('close')"
          >
            <kbd class="zbs-searchbox__kbd">esc</kbd>
          </button>
        </div>

        <div ref="listRef" class="zbs-searchbox__body">
          <div :id="listboxId" role="listbox" :aria-label="labels.dialogLabel" class="zbs-searchbox__list" :data-state="bodyState">
            <template v-if="bodyState === 'results'">
              <section v-for="group in groups" :key="group.id" class="zbs-searchbox__group">
                <header class="zbs-searchbox__group-title">
                  <span class="zbs-searchbox__group-name">{{ group.title }}</span>
                  <span v-if="group.category" class="zbs-searchbox__group-tag">{{ group.category }}</span>
                </header>

                <div
                  v-for="hit in group.hits"
                  :key="hit.id"
                  :id="optionId(flatIndex.get(hit.id) ?? -1)"
                  class="zbs-searchbox__hit"
                  role="option"
                  :aria-selected="flatIndex.get(hit.id) === selected"
                  :data-selected="flatIndex.get(hit.id) === selected ? 'true' : undefined"
                  data-testid="zbs-hit"
                  @mousemove="selected = flatIndex.get(hit.id) ?? 0"
                  @click="onRowClick($event, hit)"
                >
                  <a class="zbs-searchbox__hit-link" :href="hit.url" tabindex="-1">
                    <span class="zbs-searchbox__hit-icon" aria-hidden="true">
                      <SectionIcon v-if="hit.section" />
                      <PageIcon v-else />
                    </span>

                    <span class="zbs-searchbox__hit-body">
                      <span class="zbs-searchbox__hit-title">
                        <Highlighted :text="hit.section || hit.title" :query="term" />
                      </span>

                      <span v-if="hit.breadcrumb && hit.breadcrumb.length" class="zbs-searchbox__hit-breadcrumb">
                        <span v-for="(crumb, i) in hit.breadcrumb" :key="`${hit.id}-${i}`" class="zbs-searchbox__crumb">
                          {{ crumb }}
                        </span>
                      </span>

                      <span v-if="hit.snippet" class="zbs-searchbox__hit-snippet">
                        <Highlighted :text="hit.snippet" :query="term" />
                      </span>
                    </span>
                  </a>

                  <span class="zbs-searchbox__hit-enter" aria-hidden="true">
                    <EnterIcon />
                  </span>
                </div>
              </section>
            </template>

            <section v-else-if="bodyState === 'recent'" class="zbs-searchbox__group">
              <header class="zbs-searchbox__group-title">
                <span class="zbs-searchbox__group-name">{{ labels.recentSearches }}</span>
              </header>

              <div
                v-for="hit in navigable"
                :key="hit.id"
                :id="optionId(flatIndex.get(hit.id) ?? -1)"
                class="zbs-searchbox__hit"
                role="option"
                :aria-selected="flatIndex.get(hit.id) === selected"
                :data-selected="flatIndex.get(hit.id) === selected ? 'true' : undefined"
                data-testid="zbs-hit"
                @mousemove="selected = flatIndex.get(hit.id) ?? 0"
                @click="onRowClick($event, hit)"
              >
                <a class="zbs-searchbox__hit-link" :href="hit.url" tabindex="-1">
                  <span class="zbs-searchbox__hit-icon" aria-hidden="true">
                    <HistoryIcon />
                  </span>

                  <span class="zbs-searchbox__hit-body">
                    <span class="zbs-searchbox__hit-title">
                      <Highlighted :text="hit.section || hit.title" :query="term" />
                    </span>

                    <span v-if="hit.breadcrumb && hit.breadcrumb.length" class="zbs-searchbox__hit-breadcrumb">
                      <span v-for="(crumb, i) in hit.breadcrumb" :key="`${hit.id}-${i}`" class="zbs-searchbox__crumb">
                        {{ crumb }}
                      </span>
                    </span>
                  </span>
                </a>

                <button
                  type="button"
                  class="zbs-searchbox__hit-action"
                  :aria-label="labels.removeRecentSearch"
                  @click.stop="dropRecent(hit.url)"
                >
                  <CloseIcon />
                </button>
              </div>
            </section>
          </div>

          <p v-if="bodyState === 'loading'" class="zbs-searchbox__state" data-testid="zbs-searchbox-loading">
            <span class="zbs-searchbox__spinner" aria-hidden="true" />
            {{ labels.searching }}
          </p>

          <p v-else-if="bodyState === 'empty-start'" class="zbs-searchbox__state zbs-searchbox__state--muted">
            {{ labels.startTyping }}
          </p>

          <p
            v-else-if="bodyState === 'error'"
            class="zbs-searchbox__state zbs-searchbox__state--error"
            data-testid="zbs-searchbox-error"
          >
            <ErrorIcon class="zbs-searchbox__state-icon" />
            {{ labels.errored }}
          </p>

          <div
            v-else-if="bodyState === 'no-results'"
            class="zbs-searchbox__state zbs-searchbox__state--empty"
            data-testid="zbs-searchbox-no-results"
          >
            <SearchIcon class="zbs-searchbox__state-icon" />
            <p class="zbs-searchbox__state-title">{{ labels.noResults(term.trim()) }}</p>
            <p class="zbs-searchbox__state-hint">{{ labels.noResultsHint }}</p>
          </div>
        </div>

        <footer class="zbs-searchbox__footer">
          <ul class="zbs-searchbox__legend">
            <li class="zbs-searchbox__legend-item">
              <kbd class="zbs-searchbox__kbd"><EnterIcon /></kbd>
              {{ labels.selectHint }}
            </li>
            <li class="zbs-searchbox__legend-item">
              <kbd class="zbs-searchbox__kbd"><ArrowUpIcon /></kbd>
              <kbd class="zbs-searchbox__kbd"><ArrowDownIcon /></kbd>
              {{ labels.navigateHint }}
            </li>
            <li class="zbs-searchbox__legend-item">
              <kbd class="zbs-searchbox__kbd">esc</kbd>
              {{ labels.closeHint }}
            </li>
          </ul>

          <a
            class="zbs-searchbox__branding"
            data-testid="zbs-searchbox-branding"
            :href="ZBSEARCH_URL"
            target="_blank"
            rel="noreferrer noopener"
          >
            <span class="zbs-searchbox__branding-text">{{ labels.poweredBy }}</span>
            <ZBSearchWordmark class="zbs-searchbox__branding-logo" :size="19" />
          </a>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
