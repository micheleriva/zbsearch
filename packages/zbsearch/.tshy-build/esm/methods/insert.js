import { isArrayType, isGeoPointType, isVectorType } from '../components.js';
import { isAsyncFunction, sleep } from '../utils.js';
import { runMultipleHook, runSingleHook } from '../components/hooks.js';
import { createError } from '../errors.js';
import { getInternalDocumentId } from '../components/internal-document-id-store.js';
export function insert(zbsearch, doc, language, skipHooks, options) {
    const errorProperty = zbsearch.validateSchema(doc, zbsearch.schema);
    if (errorProperty) {
        throw createError('SCHEMA_VALIDATION_FAILURE', errorProperty);
    }
    const asyncNeeded = isAsyncFunction(zbsearch.beforeInsert) ||
        isAsyncFunction(zbsearch.afterInsert) ||
        isAsyncFunction(zbsearch.index.beforeInsert) ||
        isAsyncFunction(zbsearch.index.insert) ||
        isAsyncFunction(zbsearch.index.afterInsert);
    if (asyncNeeded) {
        return innerInsertAsync(zbsearch, doc, language, skipHooks, options);
    }
    return innerInsertSync(zbsearch, doc, language, skipHooks, options);
}
const ENUM_TYPE = new Set(['enum', 'enum[]']);
const STRING_NUMBER_TYPE = new Set(['string', 'number']);
async function innerInsertAsync(zbsearch, doc, language, skipHooks, options) {
    const { index, docs } = zbsearch.data;
    const id = zbsearch.getDocumentIndexId(doc);
    if (typeof id !== 'string') {
        throw createError('DOCUMENT_ID_MUST_BE_STRING', typeof id);
    }
    const internalId = getInternalDocumentId(zbsearch.internalDocumentIDStore, id);
    if (!skipHooks) {
        await runSingleHook(zbsearch.beforeInsert, zbsearch, id, doc);
    }
    if (!zbsearch.documentsStore.store(docs, id, internalId, doc)) {
        throw createError('DOCUMENT_ALREADY_EXISTS', id);
    }
    const docsCount = zbsearch.documentsStore.count(docs);
    const indexableProperties = zbsearch.index.getSearchableProperties(index);
    const indexablePropertiesWithTypes = zbsearch.index.getSearchablePropertiesWithTypes(index);
    const indexableValues = zbsearch.getDocumentProperties(doc, indexableProperties);
    for (const [key, value] of Object.entries(indexableValues)) {
        if (typeof value === 'undefined')
            continue;
        const actualType = typeof value;
        const expectedType = indexablePropertiesWithTypes[key];
        validateDocumentProperty(actualType, expectedType, key, value);
    }
    await indexAndSortDocument(zbsearch, id, indexableProperties, indexableValues, docsCount, language, doc, options);
    if (!skipHooks) {
        await runSingleHook(zbsearch.afterInsert, zbsearch, id, doc);
    }
    return id;
}
function innerInsertSync(zbsearch, doc, language, skipHooks, options) {
    const { index, docs } = zbsearch.data;
    const id = zbsearch.getDocumentIndexId(doc);
    if (typeof id !== 'string') {
        throw createError('DOCUMENT_ID_MUST_BE_STRING', typeof id);
    }
    const internalId = getInternalDocumentId(zbsearch.internalDocumentIDStore, id);
    if (!skipHooks) {
        runSingleHook(zbsearch.beforeInsert, zbsearch, id, doc);
    }
    if (!zbsearch.documentsStore.store(docs, id, internalId, doc)) {
        throw createError('DOCUMENT_ALREADY_EXISTS', id);
    }
    const docsCount = zbsearch.documentsStore.count(docs);
    const indexableProperties = zbsearch.index.getSearchableProperties(index);
    const indexablePropertiesWithTypes = zbsearch.index.getSearchablePropertiesWithTypes(index);
    const indexableValues = zbsearch.getDocumentProperties(doc, indexableProperties);
    for (const [key, value] of Object.entries(indexableValues)) {
        if (typeof value === 'undefined')
            continue;
        const actualType = typeof value;
        const expectedType = indexablePropertiesWithTypes[key];
        validateDocumentProperty(actualType, expectedType, key, value);
    }
    indexAndSortDocumentSync(zbsearch, id, indexableProperties, indexableValues, docsCount, language, doc, options);
    if (!skipHooks) {
        runSingleHook(zbsearch.afterInsert, zbsearch, id, doc);
    }
    return id;
}
function validateDocumentProperty(actualType, expectedType, key, value) {
    if (isGeoPointType(expectedType) &&
        typeof value === 'object' &&
        typeof value.lon === 'number' &&
        typeof value.lat === 'number') {
        return;
    }
    if (isVectorType(expectedType) && Array.isArray(value))
        return;
    if (isArrayType(expectedType) && Array.isArray(value))
        return;
    if (ENUM_TYPE.has(expectedType) && STRING_NUMBER_TYPE.has(actualType))
        return;
    if (actualType !== expectedType) {
        throw createError('INVALID_DOCUMENT_PROPERTY', key, expectedType, actualType);
    }
}
async function indexAndSortDocument(zbsearch, id, indexableProperties, indexableValues, docsCount, language, doc, options) {
    for (const prop of indexableProperties) {
        const value = indexableValues[prop];
        if (typeof value === 'undefined')
            continue;
        const expectedType = zbsearch.index.getSearchablePropertiesWithTypes(zbsearch.data.index)[prop];
        await zbsearch.index.beforeInsert?.(zbsearch.data.index, prop, id, value, expectedType, language, zbsearch.tokenizer, docsCount);
        const internalId = zbsearch.internalDocumentIDStore.idToInternalId.get(id);
        await zbsearch.index.insert(zbsearch.index, zbsearch.data.index, prop, id, internalId, value, expectedType, language, zbsearch.tokenizer, docsCount, options);
        await zbsearch.index.afterInsert?.(zbsearch.data.index, prop, id, value, expectedType, language, zbsearch.tokenizer, docsCount);
    }
    const sortableProperties = zbsearch.sorter.getSortableProperties(zbsearch.data.sorting);
    const sortableValues = zbsearch.getDocumentProperties(doc, sortableProperties);
    for (const prop of sortableProperties) {
        const value = sortableValues[prop];
        if (typeof value === 'undefined')
            continue;
        const expectedType = zbsearch.sorter.getSortablePropertiesWithTypes(zbsearch.data.sorting)[prop];
        zbsearch.sorter.insert(zbsearch.data.sorting, prop, id, value, expectedType, language);
    }
}
function indexAndSortDocumentSync(zbsearch, id, indexableProperties, indexableValues, docsCount, language, doc, options) {
    for (const prop of indexableProperties) {
        const value = indexableValues[prop];
        if (typeof value === 'undefined')
            continue;
        const expectedType = zbsearch.index.getSearchablePropertiesWithTypes(zbsearch.data.index)[prop];
        const internalDocumentId = getInternalDocumentId(zbsearch.internalDocumentIDStore, id);
        zbsearch.index.beforeInsert?.(zbsearch.data.index, prop, id, value, expectedType, language, zbsearch.tokenizer, docsCount);
        zbsearch.index.insert(zbsearch.index, zbsearch.data.index, prop, id, internalDocumentId, value, expectedType, language, zbsearch.tokenizer, docsCount, options);
        zbsearch.index.afterInsert?.(zbsearch.data.index, prop, id, value, expectedType, language, zbsearch.tokenizer, docsCount);
    }
    const sortableProperties = zbsearch.sorter.getSortableProperties(zbsearch.data.sorting);
    const sortableValues = zbsearch.getDocumentProperties(doc, sortableProperties);
    for (const prop of sortableProperties) {
        const value = sortableValues[prop];
        if (typeof value === 'undefined')
            continue;
        const expectedType = zbsearch.sorter.getSortablePropertiesWithTypes(zbsearch.data.sorting)[prop];
        zbsearch.sorter.insert(zbsearch.data.sorting, prop, id, value, expectedType, language);
    }
}
export function insertMultiple(zbsearch, docs, batchSize, language, skipHooks, timeout) {
    const asyncNeeded = isAsyncFunction(zbsearch.afterInsertMultiple) ||
        isAsyncFunction(zbsearch.beforeInsertMultiple) ||
        isAsyncFunction(zbsearch.index.beforeInsert) ||
        isAsyncFunction(zbsearch.index.insert) ||
        isAsyncFunction(zbsearch.index.afterInsert);
    if (asyncNeeded) {
        return innerInsertMultipleAsync(zbsearch, docs, batchSize, language, skipHooks, timeout);
    }
    return innerInsertMultipleSync(zbsearch, docs, batchSize, language, skipHooks, timeout);
}
async function innerInsertMultipleAsync(zbsearch, docs, batchSize = 1000, language, skipHooks, timeout = 0) {
    const ids = [];
    const processNextBatch = async (startIndex) => {
        const endIndex = Math.min(startIndex + batchSize, docs.length);
        const batch = docs.slice(startIndex, endIndex);
        for (const doc of batch) {
            const options = { avlRebalanceThreshold: batch.length };
            const id = await insert(zbsearch, doc, language, skipHooks, options);
            ids.push(id);
        }
        return endIndex;
    };
    const processAllBatches = async () => {
        let currentIndex = 0;
        while (currentIndex < docs.length) {
            const startTime = Date.now();
            currentIndex = await processNextBatch(currentIndex);
            if (timeout > 0) {
                const elapsedTime = Date.now() - startTime;
                const waitTime = timeout - elapsedTime;
                if (waitTime > 0) {
                    sleep(waitTime);
                }
            }
        }
    };
    await processAllBatches();
    if (!skipHooks) {
        await runMultipleHook(zbsearch.afterInsertMultiple, zbsearch, docs);
    }
    return ids;
}
function innerInsertMultipleSync(zbsearch, docs, batchSize = 1000, language, skipHooks, timeout = 0) {
    const ids = [];
    let i = 0;
    function processNextBatch() {
        const batch = docs.slice(i * batchSize, (i + 1) * batchSize);
        if (batch.length === 0)
            return false;
        for (const doc of batch) {
            const options = { avlRebalanceThreshold: batch.length };
            const id = insert(zbsearch, doc, language, skipHooks, options);
            ids.push(id);
        }
        i++;
        return true;
    }
    function processAllBatches() {
        const startTime = Date.now();
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const hasMoreBatches = processNextBatch();
            if (!hasMoreBatches)
                break;
            if (timeout > 0) {
                const elapsedTime = Date.now() - startTime;
                if (elapsedTime >= timeout) {
                    const remainingTime = timeout - (elapsedTime % timeout);
                    if (remainingTime > 0) {
                        sleep(remainingTime);
                    }
                }
            }
        }
    }
    processAllBatches();
    if (!skipHooks) {
        runMultipleHook(zbsearch.afterInsertMultiple, zbsearch, docs);
    }
    return ids;
}
export function innerInsertMultiple(zbsearch, docs, batchSize, language, skipHooks, timeout) {
    const asyncNeeded = isAsyncFunction(zbsearch.beforeInsert) ||
        isAsyncFunction(zbsearch.afterInsert) ||
        isAsyncFunction(zbsearch.index.beforeInsert) ||
        isAsyncFunction(zbsearch.index.insert) ||
        isAsyncFunction(zbsearch.index.afterInsert);
    if (asyncNeeded) {
        return innerInsertMultipleAsync(zbsearch, docs, batchSize, language, skipHooks, timeout);
    }
    return innerInsertMultipleSync(zbsearch, docs, batchSize, language, skipHooks, timeout);
}
//# sourceMappingURL=insert.js.map