import { runMultipleHook, runSingleHook } from '../components/hooks.js';
import { getDocumentIdFromInternalId, getInternalDocumentId } from '../components/internal-document-id-store.js';
import { isAsyncFunction } from '../utils.js';
export function remove(zbsearch, id, language, skipHooks) {
    const asyncNeeded = isAsyncFunction(zbsearch.index.beforeRemove) ||
        isAsyncFunction(zbsearch.index.remove) ||
        isAsyncFunction(zbsearch.index.afterRemove);
    if (asyncNeeded) {
        return removeAsync(zbsearch, id, language, skipHooks);
    }
    return removeSync(zbsearch, id, language, skipHooks);
}
async function removeAsync(zbsearch, id, language, skipHooks) {
    let result = true;
    const { index, docs } = zbsearch.data;
    const doc = zbsearch.documentsStore.get(docs, id);
    if (!doc) {
        return false;
    }
    const internalId = getInternalDocumentId(zbsearch.internalDocumentIDStore, id);
    const docId = getDocumentIdFromInternalId(zbsearch.internalDocumentIDStore, internalId);
    const docsCount = zbsearch.documentsStore.count(docs);
    if (!skipHooks) {
        await runSingleHook(zbsearch.beforeRemove, zbsearch, docId);
    }
    const indexableProperties = zbsearch.index.getSearchableProperties(index);
    const indexablePropertiesWithTypes = zbsearch.index.getSearchablePropertiesWithTypes(index);
    const values = zbsearch.getDocumentProperties(doc, indexableProperties);
    for (const prop of indexableProperties) {
        const value = values[prop];
        if (typeof value === 'undefined') {
            continue;
        }
        const schemaType = indexablePropertiesWithTypes[prop];
        await zbsearch.index.beforeRemove?.(zbsearch.data.index, prop, docId, value, schemaType, language, zbsearch.tokenizer, docsCount);
        if (!(await zbsearch.index.remove(zbsearch.index, zbsearch.data.index, prop, id, internalId, value, schemaType, language, zbsearch.tokenizer, docsCount))) {
            result = false;
        }
        await zbsearch.index.afterRemove?.(zbsearch.data.index, prop, docId, value, schemaType, language, zbsearch.tokenizer, docsCount);
    }
    const sortableProperties = await zbsearch.sorter.getSortableProperties(zbsearch.data.sorting);
    const sortableValues = await zbsearch.getDocumentProperties(doc, sortableProperties);
    for (const prop of sortableProperties) {
        if (typeof sortableValues[prop] === 'undefined') {
            continue;
        }
        zbsearch.sorter.remove(zbsearch.data.sorting, prop, id);
    }
    if (!skipHooks) {
        await runSingleHook(zbsearch.afterRemove, zbsearch, docId);
    }
    zbsearch.documentsStore.remove(zbsearch.data.docs, id, internalId);
    return result;
}
function removeSync(zbsearch, id, language, skipHooks) {
    let result = true;
    const { index, docs } = zbsearch.data;
    const doc = zbsearch.documentsStore.get(docs, id);
    if (!doc) {
        return false;
    }
    const internalId = getInternalDocumentId(zbsearch.internalDocumentIDStore, id);
    const docId = getDocumentIdFromInternalId(zbsearch.internalDocumentIDStore, internalId);
    const docsCount = zbsearch.documentsStore.count(docs);
    if (!skipHooks) {
        runSingleHook(zbsearch.beforeRemove, zbsearch, docId);
    }
    const indexableProperties = zbsearch.index.getSearchableProperties(index);
    const indexablePropertiesWithTypes = zbsearch.index.getSearchablePropertiesWithTypes(index);
    const values = zbsearch.getDocumentProperties(doc, indexableProperties);
    for (const prop of indexableProperties) {
        const value = values[prop];
        if (typeof value === 'undefined') {
            continue;
        }
        const schemaType = indexablePropertiesWithTypes[prop];
        zbsearch.index.beforeRemove?.(zbsearch.data.index, prop, docId, value, schemaType, language, zbsearch.tokenizer, docsCount);
        if (!zbsearch.index.remove(zbsearch.index, zbsearch.data.index, prop, id, internalId, value, schemaType, language, zbsearch.tokenizer, docsCount)) {
            result = false;
        }
        zbsearch.index.afterRemove?.(zbsearch.data.index, prop, docId, value, schemaType, language, zbsearch.tokenizer, docsCount);
    }
    const sortableProperties = zbsearch.sorter.getSortableProperties(zbsearch.data.sorting);
    const sortableValues = zbsearch.getDocumentProperties(doc, sortableProperties);
    for (const prop of sortableProperties) {
        if (typeof sortableValues[prop] === 'undefined') {
            continue;
        }
        zbsearch.sorter.remove(zbsearch.data.sorting, prop, id);
    }
    if (!skipHooks) {
        runSingleHook(zbsearch.afterRemove, zbsearch, docId);
    }
    zbsearch.documentsStore.remove(zbsearch.data.docs, id, internalId);
    return result;
}
export function removeMultiple(zbsearch, ids, batchSize, language, skipHooks) {
    const asyncNeeded = isAsyncFunction(zbsearch.index.beforeRemove) ||
        isAsyncFunction(zbsearch.index.remove) ||
        isAsyncFunction(zbsearch.index.afterRemove) ||
        isAsyncFunction(zbsearch.beforeRemoveMultiple) ||
        isAsyncFunction(zbsearch.afterRemoveMultiple);
    if (asyncNeeded) {
        return removeMultipleAsync(zbsearch, ids, batchSize, language, skipHooks);
    }
    return removeMultipleSync(zbsearch, ids, batchSize, language, skipHooks);
}
async function removeMultipleAsync(zbsearch, ids, batchSize, language, skipHooks) {
    let result = 0;
    if (!batchSize) {
        batchSize = 1000;
    }
    const docIdsForHooks = skipHooks
        ? []
        : ids.map((id) => getDocumentIdFromInternalId(zbsearch.internalDocumentIDStore, getInternalDocumentId(zbsearch.internalDocumentIDStore, id)));
    if (!skipHooks) {
        await runMultipleHook(zbsearch.beforeRemoveMultiple, zbsearch, docIdsForHooks);
    }
    await new Promise((resolve, reject) => {
        let i = 0;
        async function _removeMultiple() {
            const batch = ids.slice(i * batchSize, ++i * batchSize);
            if (!batch.length) {
                return resolve();
            }
            for (const doc of batch) {
                try {
                    if (await remove(zbsearch, doc, language, skipHooks)) {
                        result++;
                    }
                }
                catch (err) {
                    reject(err);
                }
            }
            setTimeout(_removeMultiple, 0);
        }
        setTimeout(_removeMultiple, 0);
    });
    if (!skipHooks) {
        await runMultipleHook(zbsearch.afterRemoveMultiple, zbsearch, docIdsForHooks);
    }
    return result;
}
function removeMultipleSync(zbsearch, ids, batchSize, language, skipHooks) {
    let result = 0;
    if (!batchSize) {
        batchSize = 1000;
    }
    const docIdsForHooks = skipHooks
        ? []
        : ids.map((id) => getDocumentIdFromInternalId(zbsearch.internalDocumentIDStore, getInternalDocumentId(zbsearch.internalDocumentIDStore, id)));
    if (!skipHooks) {
        runMultipleHook(zbsearch.beforeRemoveMultiple, zbsearch, docIdsForHooks);
    }
    let i = 0;
    function _removeMultipleSync() {
        const batch = ids.slice(i * batchSize, ++i * batchSize);
        if (!batch.length)
            return;
        for (const doc of batch) {
            if (remove(zbsearch, doc, language, skipHooks)) {
                result++;
            }
        }
        setTimeout(_removeMultipleSync, 0);
    }
    _removeMultipleSync();
    if (!skipHooks) {
        runMultipleHook(zbsearch.afterRemoveMultiple, zbsearch, docIdsForHooks);
    }
    return result;
}
//# sourceMappingURL=remove.js.map