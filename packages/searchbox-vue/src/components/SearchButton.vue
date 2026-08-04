<script setup lang="ts">
import { useIsApplePlatform } from '../composables/useHotkeys.js'
import { SearchIcon } from './icons.js'

withDefaults(
  defineProps<{
    label?: string
    ariaLabel?: string
    shortcut?: boolean
  }>(),
  {
    label: 'Search',
    ariaLabel: 'Search (Command+K)',
    shortcut: true
  }
)

const emit = defineEmits<{ click: [] }>()

const isApple = useIsApplePlatform()
</script>

<template>
  <button
    type="button"
    class="zbs-search-button"
    :aria-label="ariaLabel"
    data-testid="zbs-search-button"
    @click="emit('click')"
  >
    <span class="zbs-search-button__icon" aria-hidden="true">
      <SearchIcon />
    </span>

    <span class="zbs-search-button__label">{{ label }}</span>

    <span v-if="shortcut" class="zbs-search-button__keys" aria-hidden="true">
      <kbd class="zbs-search-button__kbd">{{ isApple ? '⌘' : 'Ctrl' }}</kbd>
      <kbd class="zbs-search-button__kbd">K</kbd>
    </span>
  </button>
</template>
