<script setup lang="ts">
import { highlight } from '@zbsearch/searchbox-core'
import { computed } from 'vue'

const props = defineProps<{ text: string; query: string }>()

const segments = computed(() => highlight(props.text, props.query))
</script>

<template>
  <span>
    <template v-for="(segment, index) in segments" :key="index">
      <mark v-if="segment.match" class="zbs-searchbox__mark zbsearch-highlight">{{ segment.text }}</mark>
      <template v-else>{{ segment.text }}</template>
    </template>
  </span>
</template>
