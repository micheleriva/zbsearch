import type { AnyZBSearch, ZBSearchPlugin } from '../types.js'
import { createError } from '../errors.js'

export type AvailablePluginHooks = (typeof AVAILABLE_PLUGIN_HOOKS)[number]

export const AVAILABLE_PLUGIN_HOOKS = [
  'beforeInsert',
  'afterInsert',
  'beforeRemove',
  'afterRemove',
  'beforeUpdate',
  'afterUpdate',
  'beforeUpsert',
  'afterUpsert',
  'beforeSearch',
  'afterSearch',
  'beforeInsertMultiple',
  'afterInsertMultiple',
  'beforeRemoveMultiple',
  'afterRemoveMultiple',
  'beforeUpdateMultiple',
  'afterUpdateMultiple',
  'beforeUpsertMultiple',
  'afterUpsertMultiple',
  'beforeLoad',
  'afterLoad',
  'afterCreate'
] as const

export function getAllPluginsByHook<T extends AnyZBSearch>(zbsearch: T, hook: AvailablePluginHooks): ZBSearchPlugin[] {
  const pluginsToRun: ZBSearchPlugin[] = []
  const pluginsLength = zbsearch.plugins?.length

  if (!pluginsLength) {
    return pluginsToRun
  }

  for (let i = 0; i < pluginsLength; i++) {
    try {
      const plugin = zbsearch.plugins[i]
      if (typeof plugin[hook] === 'function') {
        pluginsToRun.push(plugin[hook] as ZBSearchPlugin)
      }
    } catch (error) {
      console.error('Caught error in getAllPluginsByHook:', error)
      throw createError('PLUGIN_CRASHED')
    }
  }

  return pluginsToRun
}
