import type { AnyZBSearch, ZBSearchPlugin } from '../types.js';
export type AvailablePluginHooks = (typeof AVAILABLE_PLUGIN_HOOKS)[number];
export declare const AVAILABLE_PLUGIN_HOOKS: readonly ["beforeInsert", "afterInsert", "beforeRemove", "afterRemove", "beforeUpdate", "afterUpdate", "beforeUpsert", "afterUpsert", "beforeSearch", "afterSearch", "beforeInsertMultiple", "afterInsertMultiple", "beforeRemoveMultiple", "afterRemoveMultiple", "beforeUpdateMultiple", "afterUpdateMultiple", "beforeUpsertMultiple", "afterUpsertMultiple", "beforeLoad", "afterLoad", "afterCreate"];
export declare function getAllPluginsByHook<T extends AnyZBSearch>(zbsearch: T, hook: AvailablePluginHooks): ZBSearchPlugin[];
