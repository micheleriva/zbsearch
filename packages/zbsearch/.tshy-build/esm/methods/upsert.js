import { runMultipleHook, runSingleHook } from '../components/hooks.js';
import { createError } from '../errors.js';
import { insert, innerInsertMultiple } from './insert.js';
import { update, updateMultiple } from './update.js';
import { isAsyncFunction } from '../utils.js';
export function upsert(zbsearch, doc, language, skipHooks, options) {
    const asyncNeeded = isAsyncFunction(zbsearch.afterInsert) ||
        isAsyncFunction(zbsearch.beforeInsert) ||
        isAsyncFunction(zbsearch.afterRemove) ||
        isAsyncFunction(zbsearch.beforeRemove) ||
        isAsyncFunction(zbsearch.beforeUpdate) ||
        isAsyncFunction(zbsearch.afterUpdate) ||
        isAsyncFunction(zbsearch.beforeUpsert) ||
        isAsyncFunction(zbsearch.afterUpsert) ||
        isAsyncFunction(zbsearch.index.beforeInsert) ||
        isAsyncFunction(zbsearch.index.insert) ||
        isAsyncFunction(zbsearch.index.afterInsert);
    if (asyncNeeded) {
        return upsertAsync(zbsearch, doc, language, skipHooks, options);
    }
    return upsertSync(zbsearch, doc, language, skipHooks, options);
}
async function upsertAsync(zbsearch, doc, language, skipHooks, options) {
    const id = zbsearch.getDocumentIndexId(doc);
    if (typeof id !== 'string') {
        throw createError('DOCUMENT_ID_MUST_BE_STRING', typeof id);
    }
    if (!skipHooks && zbsearch.beforeUpsert) {
        await runSingleHook(zbsearch.beforeUpsert, zbsearch, id, doc);
    }
    // Check if document exists
    const existingDoc = zbsearch.documentsStore.get(zbsearch.data.docs, id);
    let resultId;
    if (existingDoc) {
        // Document exists, update it
        resultId = await update(zbsearch, id, doc, language, skipHooks);
    }
    else {
        // Document doesn't exist, insert it
        resultId = await insert(zbsearch, doc, language, skipHooks, options);
    }
    if (!skipHooks && zbsearch.afterUpsert) {
        await runSingleHook(zbsearch.afterUpsert, zbsearch, resultId, doc);
    }
    return resultId;
}
function upsertSync(zbsearch, doc, language, skipHooks, options) {
    const id = zbsearch.getDocumentIndexId(doc);
    if (typeof id !== 'string') {
        throw createError('DOCUMENT_ID_MUST_BE_STRING', typeof id);
    }
    if (!skipHooks && zbsearch.beforeUpsert) {
        runSingleHook(zbsearch.beforeUpsert, zbsearch, id, doc);
    }
    // Check if document exists
    const existingDoc = zbsearch.documentsStore.get(zbsearch.data.docs, id);
    let resultId;
    if (existingDoc) {
        // Document exists, update it
        resultId = update(zbsearch, id, doc, language, skipHooks);
    }
    else {
        // Document doesn't exist, insert it
        resultId = insert(zbsearch, doc, language, skipHooks, options);
    }
    if (!skipHooks && zbsearch.afterUpsert) {
        runSingleHook(zbsearch.afterUpsert, zbsearch, resultId, doc);
    }
    return resultId;
}
export function upsertMultiple(zbsearch, docs, batchSize, language, skipHooks) {
    const asyncNeeded = isAsyncFunction(zbsearch.afterInsert) ||
        isAsyncFunction(zbsearch.beforeInsert) ||
        isAsyncFunction(zbsearch.afterRemove) ||
        isAsyncFunction(zbsearch.beforeRemove) ||
        isAsyncFunction(zbsearch.beforeUpdate) ||
        isAsyncFunction(zbsearch.afterUpdate) ||
        isAsyncFunction(zbsearch.beforeUpsert) ||
        isAsyncFunction(zbsearch.afterUpsert) ||
        isAsyncFunction(zbsearch.beforeUpsertMultiple) ||
        isAsyncFunction(zbsearch.afterUpsertMultiple) ||
        isAsyncFunction(zbsearch.beforeInsertMultiple) ||
        isAsyncFunction(zbsearch.afterInsertMultiple) ||
        isAsyncFunction(zbsearch.beforeUpdateMultiple) ||
        isAsyncFunction(zbsearch.afterUpdateMultiple) ||
        isAsyncFunction(zbsearch.beforeRemoveMultiple) ||
        isAsyncFunction(zbsearch.afterRemoveMultiple) ||
        isAsyncFunction(zbsearch.index.beforeInsert) ||
        isAsyncFunction(zbsearch.index.insert) ||
        isAsyncFunction(zbsearch.index.afterInsert);
    if (asyncNeeded) {
        return upsertMultipleAsync(zbsearch, docs, batchSize, language, skipHooks);
    }
    return upsertMultipleSync(zbsearch, docs, batchSize, language, skipHooks);
}
async function upsertMultipleAsync(zbsearch, docs, batchSize, language, skipHooks) {
    if (!skipHooks && zbsearch.beforeUpsertMultiple) {
        await runMultipleHook(zbsearch.beforeUpsertMultiple, zbsearch, docs);
    }
    // Validate all documents first
    const docsLength = docs.length;
    for (let i = 0; i < docsLength; i++) {
        const errorProperty = zbsearch.validateSchema(docs[i], zbsearch.schema);
        if (errorProperty) {
            throw createError('SCHEMA_VALIDATION_FAILURE', errorProperty);
        }
    }
    // Separate documents into insert and update arrays
    const docsToInsert = [];
    const docsToUpdate = [];
    const idsToUpdate = [];
    for (const doc of docs) {
        const id = zbsearch.getDocumentIndexId(doc);
        if (typeof id !== 'string') {
            throw createError('DOCUMENT_ID_MUST_BE_STRING', typeof id);
        }
        const existingDoc = zbsearch.documentsStore.get(zbsearch.data.docs, id);
        if (existingDoc) {
            docsToUpdate.push(doc);
            idsToUpdate.push(id);
        }
        else {
            docsToInsert.push(doc);
        }
    }
    // Perform bulk operations
    const results = [];
    if (docsToUpdate.length > 0) {
        const updateResults = await updateMultiple(zbsearch, idsToUpdate, docsToUpdate, batchSize, language, skipHooks);
        results.push(...updateResults);
    }
    if (docsToInsert.length > 0) {
        const insertResults = await innerInsertMultiple(zbsearch, docsToInsert, batchSize, language, skipHooks);
        results.push(...insertResults);
    }
    if (!skipHooks && zbsearch.afterUpsertMultiple) {
        await runMultipleHook(zbsearch.afterUpsertMultiple, zbsearch, results);
    }
    return results;
}
function upsertMultipleSync(zbsearch, docs, batchSize, language, skipHooks) {
    if (!skipHooks && zbsearch.beforeUpsertMultiple) {
        runMultipleHook(zbsearch.beforeUpsertMultiple, zbsearch, docs);
    }
    // Validate all documents first
    const docsLength = docs.length;
    for (let i = 0; i < docsLength; i++) {
        const errorProperty = zbsearch.validateSchema(docs[i], zbsearch.schema);
        if (errorProperty) {
            throw createError('SCHEMA_VALIDATION_FAILURE', errorProperty);
        }
    }
    // Separate documents into insert and update arrays
    const docsToInsert = [];
    const docsToUpdate = [];
    const idsToUpdate = [];
    for (const doc of docs) {
        const id = zbsearch.getDocumentIndexId(doc);
        if (typeof id !== 'string') {
            throw createError('DOCUMENT_ID_MUST_BE_STRING', typeof id);
        }
        const existingDoc = zbsearch.documentsStore.get(zbsearch.data.docs, id);
        if (existingDoc) {
            docsToUpdate.push(doc);
            idsToUpdate.push(id);
        }
        else {
            docsToInsert.push(doc);
        }
    }
    // Perform bulk operations
    const results = [];
    if (docsToUpdate.length > 0) {
        const updateResults = updateMultiple(zbsearch, idsToUpdate, docsToUpdate, batchSize, language, skipHooks);
        results.push(...updateResults);
    }
    if (docsToInsert.length > 0) {
        const insertResults = innerInsertMultiple(zbsearch, docsToInsert, batchSize, language, skipHooks);
        results.push(...insertResults);
    }
    if (!skipHooks && zbsearch.afterUpsertMultiple) {
        runMultipleHook(zbsearch.afterUpsertMultiple, zbsearch, results);
    }
    return results;
}
//# sourceMappingURL=upsert.js.map