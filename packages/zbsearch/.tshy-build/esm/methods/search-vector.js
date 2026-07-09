import { getNanosecondsTime, formatNanoseconds, sortTokenScorePredicate } from '../utils.js';
import { getFacets } from '../components/facets.js';
import { createError } from '../errors.js';
import { getGroups } from '../components/groups.js';
import { getDocumentIdFromInternalId } from '../components/internal-document-id-store.js';
import { runBeforeSearch, runAfterSearch } from '../components/hooks.js';
import { DEFAULT_SIMILARITY } from '../trees/vector.js';
import { applyPinningRules } from '../components/pinning-manager.js';
export function innerVectorSearch(zbsearch, params, language) {
    const vector = params.vector;
    if (vector && (!('value' in vector) || !('property' in vector))) {
        throw createError('INVALID_VECTOR_INPUT', Object.keys(vector).join(', '));
    }
    const vectorIndex = zbsearch.data.index.vectorIndexes[vector.property];
    if (!vectorIndex) {
        throw createError('UNKNOWN_VECTOR_PROPERTY', vector.property);
    }
    const vectorSize = vectorIndex.node.size;
    if (vector?.value.length !== vectorSize) {
        if (vector?.property === undefined || vector?.value.length === undefined) {
            throw createError('INVALID_INPUT_VECTOR', 'undefined', vectorSize, 'undefined');
        }
        throw createError('INVALID_INPUT_VECTOR', vector.property, vectorSize, vector.value.length);
    }
    const index = zbsearch.data.index;
    let whereFiltersIDs;
    const hasFilters = Object.keys(params.where ?? {}).length > 0;
    if (hasFilters) {
        whereFiltersIDs = zbsearch.index.searchByWhereClause(index, zbsearch.tokenizer, params.where, language);
    }
    return vectorIndex.node.find(vector.value, params.similarity ?? DEFAULT_SIMILARITY, whereFiltersIDs);
}
export function searchVector(zbsearch, params, language = 'english') {
    const timeStart = getNanosecondsTime();
    function performSearchLogic() {
        let results = innerVectorSearch(zbsearch, params, language).sort(sortTokenScorePredicate);
        // Apply pinning rules after sorting but before pagination
        results = applyPinningRules(zbsearch, zbsearch.data.pinning, results, undefined);
        let facetsResults = [];
        const shouldCalculateFacets = params.facets && Object.keys(params.facets).length > 0;
        if (shouldCalculateFacets) {
            const facets = getFacets(zbsearch, results, params.facets);
            facetsResults = facets;
        }
        const vectorProperty = params.vector.property;
        const includeVectors = params.includeVectors ?? false;
        const limit = params.limit ?? 10;
        const offset = params.offset ?? 0;
        const docs = Array.from({ length: limit });
        for (let i = 0; i < limit; i++) {
            const result = results[i + offset];
            if (!result) {
                break;
            }
            const doc = zbsearch.data.docs.docs[result[0]];
            if (doc) {
                if (!includeVectors) {
                    doc[vectorProperty] = null;
                }
                const newDoc = {
                    id: getDocumentIdFromInternalId(zbsearch.internalDocumentIDStore, result[0]),
                    score: result[1],
                    document: doc
                };
                docs[i] = newDoc;
            }
        }
        let groups = [];
        if (params.groupBy) {
            groups = getGroups(zbsearch, results, params.groupBy);
        }
        const timeEnd = getNanosecondsTime();
        const elapsedTime = timeEnd - timeStart;
        return {
            count: results.length,
            hits: docs.filter(Boolean),
            elapsed: {
                raw: Number(elapsedTime),
                formatted: formatNanoseconds(elapsedTime)
            },
            ...(facetsResults ? { facets: facetsResults } : {}),
            ...(groups ? { groups } : {})
        };
    }
    async function executeSearchAsync() {
        if (zbsearch.beforeSearch) {
            await runBeforeSearch(zbsearch.beforeSearch, zbsearch, params, language);
        }
        const results = performSearchLogic();
        if (zbsearch.afterSearch) {
            await runAfterSearch(zbsearch.afterSearch, zbsearch, params, language, results);
        }
        return results;
    }
    const asyncNeeded = zbsearch.beforeSearch?.length || zbsearch.afterSearch?.length;
    if (asyncNeeded) {
        return executeSearchAsync();
    }
    // Sync path
    return performSearchLogic();
}
//# sourceMappingURL=search-vector.js.map