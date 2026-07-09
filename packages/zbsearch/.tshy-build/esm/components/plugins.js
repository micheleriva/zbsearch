import { createError } from '../errors.js';
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
];
export function getAllPluginsByHook(zbsearch, hook) {
    const pluginsToRun = [];
    const pluginsLength = zbsearch.plugins?.length;
    if (!pluginsLength) {
        return pluginsToRun;
    }
    for (let i = 0; i < pluginsLength; i++) {
        try {
            const plugin = zbsearch.plugins[i];
            if (typeof plugin[hook] === 'function') {
                pluginsToRun.push(plugin[hook]);
            }
        }
        catch (error) {
            console.error('Caught error in getAllPluginsByHook:', error);
            throw createError('PLUGIN_CRASHED');
        }
    }
    return pluginsToRun;
}
//# sourceMappingURL=plugins.js.map