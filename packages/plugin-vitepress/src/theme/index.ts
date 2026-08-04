import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import type { Theme } from 'vitepress'
import SearchBox from './SearchBox.vue'

/**
 * The default VitePress theme with ZBSearch wired into the navbar.
 *
 * Re-export this from `.vitepress/theme/index.ts`, or compose it yourself with
 * `nav-bar-content-before` if you already extend the theme.
 */
const theme: Theme = {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'nav-bar-content-before': () => h(SearchBox)
    })
  }
}

export default theme
export { default as ZBSearchBox } from './SearchBox.vue'
