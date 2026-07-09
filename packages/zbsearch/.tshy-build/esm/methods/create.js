import { formatElapsedTime, getDocumentIndexId, getDocumentProperties, validateSchema } from '../components/defaults.js';
import { createDocumentsStore } from '../components/documents-store.js';
import { AVAILABLE_PLUGIN_HOOKS, getAllPluginsByHook } from '../components/plugins.js';
import { FUNCTION_COMPONENTS, OBJECT_COMPONENTS, runAfterCreate } from '../components/hooks.js';
import { createIndex } from '../components/index.js';
import { createInternalDocumentIDStore } from '../components/internal-document-id-store.js';
import { createSorter } from '../components/sorter.js';
import { createTokenizer } from '../components/tokenizer/index.js';
import { createPinning } from '../components/pinning.js';
import { createError } from '../errors.js';
import { uniqueId } from '../utils.js';
function validateComponents(components) {
    const defaultComponents = {
        formatElapsedTime,
        getDocumentIndexId,
        getDocumentProperties,
        validateSchema
    };
    for (const rawKey of FUNCTION_COMPONENTS) {
        const key = rawKey;
        if (components[key]) {
            if (typeof components[key] !== 'function') {
                throw createError('COMPONENT_MUST_BE_FUNCTION', key);
            }
        }
        else {
            components[key] = defaultComponents[key];
        }
    }
    for (const rawKey of Object.keys(components)) {
        if (!OBJECT_COMPONENTS.includes(rawKey) && !FUNCTION_COMPONENTS.includes(rawKey)) {
            throw createError('UNSUPPORTED_COMPONENT', rawKey);
        }
    }
}
export function create({ schema, sort, language, components, id, plugins }) {
    if (!components) {
        components = {};
    }
    for (const plugin of plugins ?? []) {
        if (!('getComponents' in plugin)) {
            continue;
        }
        if (typeof plugin.getComponents !== 'function') {
            continue;
        }
        const pluginComponents = plugin.getComponents(schema);
        const keys = Object.keys(pluginComponents);
        for (const key of keys) {
            if (components[key]) {
                throw createError('PLUGIN_COMPONENT_CONFLICT', key, plugin.name);
            }
        }
        components = {
            ...components,
            ...pluginComponents
        };
    }
    if (!id) {
        id = uniqueId();
    }
    let tokenizer = components.tokenizer;
    let index = components.index;
    let documentsStore = components.documentsStore;
    let sorter = components.sorter;
    let pinning = components.pinning;
    if (!tokenizer) {
        // Use the default tokenizer
        tokenizer = createTokenizer({ language: language ?? 'english' });
    }
    else if (!tokenizer.tokenize) {
        // If there is no tokenizer function, we assume this is a TokenizerConfig
        tokenizer = createTokenizer(tokenizer);
    }
    else {
        const customTokenizer = tokenizer;
        tokenizer = customTokenizer;
    }
    if (components.tokenizer && language) {
        // Accept language only if a tokenizer is not provided
        throw createError('NO_LANGUAGE_WITH_CUSTOM_TOKENIZER');
    }
    const internalDocumentStore = createInternalDocumentIDStore();
    index ||= createIndex();
    sorter ||= createSorter();
    documentsStore ||= createDocumentsStore();
    pinning ||= createPinning();
    // Validate all other components
    validateComponents(components);
    // Assign only recognized components and hooks
    const { getDocumentProperties, getDocumentIndexId, validateSchema, formatElapsedTime } = components;
    const zbsearch = {
        data: {},
        caches: {},
        schema,
        tokenizer,
        index,
        sorter,
        documentsStore,
        pinning,
        internalDocumentIDStore: internalDocumentStore,
        getDocumentProperties,
        getDocumentIndexId,
        validateSchema,
        beforeInsert: [],
        afterInsert: [],
        beforeRemove: [],
        afterRemove: [],
        beforeUpdate: [],
        afterUpdate: [],
        beforeUpsert: [],
        afterUpsert: [],
        beforeSearch: [],
        afterSearch: [],
        beforeInsertMultiple: [],
        afterInsertMultiple: [],
        beforeRemoveMultiple: [],
        afterRemoveMultiple: [],
        beforeUpdateMultiple: [],
        afterUpdateMultiple: [],
        beforeUpsertMultiple: [],
        afterUpsertMultiple: [],
        afterCreate: [],
        formatElapsedTime,
        id,
        plugins,
        version: getVersion()
    };
    zbsearch.data = {
        index: zbsearch.index.create(zbsearch, internalDocumentStore, schema),
        docs: zbsearch.documentsStore.create(zbsearch, internalDocumentStore),
        sorting: zbsearch.sorter.create(zbsearch, internalDocumentStore, schema, sort),
        pinning: zbsearch.pinning.create(internalDocumentStore)
    };
    for (const hook of AVAILABLE_PLUGIN_HOOKS) {
        zbsearch[hook] = (zbsearch[hook] ?? []).concat(getAllPluginsByHook(zbsearch, hook));
    }
    const afterCreate = zbsearch['afterCreate'];
    if (afterCreate) {
        runAfterCreate(afterCreate, zbsearch);
    }
    return zbsearch;
}
function getVersion() {
    return '{{VERSION}}';
}
//# sourceMappingURL=create.js.map