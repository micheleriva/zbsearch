<script setup lang="ts">
import { createIndexLoader, createSearcher, type SearchIndexPayload } from '@zbsearch/docs-index'
import { SearchBox, SearchButton, useSearchHotkeys } from '@zbsearch/searchbox-vue'
import { useData, useRouter } from 'vitepress'
import options from 'virtual:zbsearch-vitepress/options'
import { computed, ref, watch } from 'vue'

import '@zbsearch/searchbox-vue/styles.css'
import './search.css'

const router = useRouter()
const { isDark } = useData()
const open = ref(false)

/**
 * VitePress signals dark mode with a `dark` class, while the search box reads
 * `data-theme`. Mirroring the one onto the other keeps the dialog in step with
 * the site's own toggle, and with the appearance VitePress restored at boot.
 *
 * `data-theme` is not used by VitePress itself, so nothing else is disturbed.
 */
watch(
  isDark,
  (dark) => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
  },
  { immediate: true }
)

const { runtime, indexUrl } = options

const loadIndex = createIndexLoader(async () => {
  const response = await fetch(indexUrl)

  if (!response.ok) {
    throw new Error(`[zbsearch] could not load ${indexUrl}: ${response.status}`)
  }

  return (await response.json()) as SearchIndexPayload
})

const searcher = computed(() =>
  createSearcher(loadIndex, {
    boost: runtime.boost,
    maxResults: runtime.maxResults,
    tolerance: runtime.tolerance,
    threshold: runtime.threshold,
    snippetLength: runtime.snippetLength
  })
)

function prefetch(): void {
  void loadIndex().catch(() => undefined)
}

useSearchHotkeys(() => {
  open.value = true
}, runtime.hotkeys)

function navigate(url: string): void {
  router.go(url)
}
</script>

<template>
  <div class="zbs-vitepress-search" @mouseenter="prefetch" @focusin="prefetch">
    <SearchButton :label="runtime.searchButtonLabel" @click="open = true" />

    <SearchBox
      :open="open"
      :searcher="searcher"
      :labels="runtime.labels"
      :recent-searches="runtime.recentSearches"
      :on-navigate="navigate"
      @close="open = false"
    />
  </div>
</template>
