import { createError } from '../errors.js';
import { AVLTree } from '../trees/avl.js';
import { FlatTree } from '../trees/flat.js';
import { RadixTree } from '../trees/radix.js';
import { BKDTree } from '../trees/bkd.js';
import { BoolNode } from '../trees/bool.js';
import { convertDistanceToMeters, setIntersection, setUnion, setDifference } from '../utils.js';
import { BM25 } from './algorithms.js';
import { getInnerType, getVectorSize, isArrayType, isVectorType } from './defaults.js';
import { getInternalDocumentId } from './internal-document-id-store.js';
import { VectorIndex } from '../trees/vector.js';
export function insertDocumentScoreParameters(index, prop, id, tokens, docsCount) {
    const internalId = getInternalDocumentId(index.sharedInternalDocumentStore, id);
    index.avgFieldLength[prop] = ((index.avgFieldLength[prop] ?? 0) * (docsCount - 1) + tokens.length) / docsCount;
    index.fieldLengths[prop][internalId] = tokens.length;
    index.frequencies[prop][internalId] = {};
}
export function insertTokenScoreParameters(index, prop, id, tokens, token) {
    let tokenFrequency = 0;
    for (const t of tokens) {
        if (t === token) {
            tokenFrequency++;
        }
    }
    const internalId = getInternalDocumentId(index.sharedInternalDocumentStore, id);
    const tf = tokenFrequency / tokens.length;
    index.frequencies[prop][internalId][token] = tf;
    if (!(token in index.tokenOccurrences[prop])) {
        index.tokenOccurrences[prop][token] = 0;
    }
    // increase a token counter that may not yet exist
    index.tokenOccurrences[prop][token] = (index.tokenOccurrences[prop][token] ?? 0) + 1;
}
export function removeDocumentScoreParameters(index, prop, id, docsCount) {
    const internalId = getInternalDocumentId(index.sharedInternalDocumentStore, id);
    if (docsCount > 1) {
        index.avgFieldLength[prop] =
            (index.avgFieldLength[prop] * docsCount - index.fieldLengths[prop][internalId]) / (docsCount - 1);
    }
    else {
        index.avgFieldLength[prop] = undefined;
    }
    index.fieldLengths[prop][internalId] = undefined;
    index.frequencies[prop][internalId] = undefined;
}
export function removeTokenScoreParameters(index, prop, token) {
    index.tokenOccurrences[prop][token]--;
}
export function create(zbsearch, sharedInternalDocumentStore, schema, index, prefix = '') {
    if (!index) {
        index = {
            sharedInternalDocumentStore,
            indexes: {},
            vectorIndexes: {},
            searchableProperties: [],
            searchablePropertiesWithTypes: {},
            frequencies: {},
            tokenOccurrences: {},
            avgFieldLength: {},
            fieldLengths: {}
        };
    }
    for (const [prop, type] of Object.entries(schema)) {
        const path = `${prefix}${prefix ? '.' : ''}${prop}`;
        if (typeof type === 'object' && !Array.isArray(type)) {
            // Nested
            create(zbsearch, sharedInternalDocumentStore, type, index, path);
            continue;
        }
        if (isVectorType(type)) {
            index.searchableProperties.push(path);
            index.searchablePropertiesWithTypes[path] = type;
            index.vectorIndexes[path] = {
                type: 'Vector',
                node: new VectorIndex(getVectorSize(type)),
                isArray: false
            };
        }
        else {
            const isArray = /\[/.test(type);
            switch (type) {
                case 'boolean':
                case 'boolean[]':
                    index.indexes[path] = { type: 'Bool', node: new BoolNode(), isArray };
                    break;
                case 'number':
                case 'number[]':
                    index.indexes[path] = { type: 'AVL', node: new AVLTree(0, []), isArray };
                    break;
                case 'string':
                case 'string[]':
                    index.indexes[path] = { type: 'Radix', node: new RadixTree(), isArray };
                    index.avgFieldLength[path] = 0;
                    index.frequencies[path] = {};
                    index.tokenOccurrences[path] = {};
                    index.fieldLengths[path] = {};
                    break;
                case 'enum':
                case 'enum[]':
                    index.indexes[path] = { type: 'Flat', node: new FlatTree(), isArray };
                    break;
                case 'geopoint':
                    index.indexes[path] = { type: 'BKD', node: new BKDTree(), isArray };
                    break;
                default:
                    throw createError('INVALID_SCHEMA_TYPE', Array.isArray(type) ? 'array' : type, path);
            }
            index.searchableProperties.push(path);
            index.searchablePropertiesWithTypes[path] = type;
        }
    }
    return index;
}
function insertScalarBuilder(implementation, index, prop, internalId, language, tokenizer, docsCount, options) {
    return (value) => {
        const { type, node } = index.indexes[prop];
        switch (type) {
            case 'Bool': {
                node[value ? 'true' : 'false'].add(internalId);
                break;
            }
            case 'AVL': {
                const avlRebalanceThreshold = options?.avlRebalanceThreshold ?? 1;
                node.insert(value, internalId, avlRebalanceThreshold);
                break;
            }
            case 'Radix': {
                const tokens = tokenizer.tokenize(value, language, prop, false);
                implementation.insertDocumentScoreParameters(index, prop, internalId, tokens, docsCount);
                for (const token of tokens) {
                    implementation.insertTokenScoreParameters(index, prop, internalId, tokens, token);
                    node.insert(token, internalId);
                }
                break;
            }
            case 'Flat': {
                node.insert(value, internalId);
                break;
            }
            case 'BKD': {
                node.insert(value, [internalId]);
                break;
            }
        }
    };
}
export function insert(implementation, index, prop, id, internalId, value, schemaType, language, tokenizer, docsCount, options) {
    if (isVectorType(schemaType)) {
        return insertVector(index, prop, value, id, internalId);
    }
    const insertScalar = insertScalarBuilder(implementation, index, prop, internalId, language, tokenizer, docsCount, options);
    if (!isArrayType(schemaType)) {
        return insertScalar(value);
    }
    const elements = value;
    const elementsLength = elements.length;
    for (let i = 0; i < elementsLength; i++) {
        insertScalar(elements[i]);
    }
}
export function insertVector(index, prop, value, id, internalDocumentId) {
    index.vectorIndexes[prop].node.add(internalDocumentId, value);
}
function removeScalar(implementation, index, prop, id, internalId, value, schemaType, language, tokenizer, docsCount) {
    if (isVectorType(schemaType)) {
        index.vectorIndexes[prop].node.remove(internalId);
        return true;
    }
    const { type, node } = index.indexes[prop];
    switch (type) {
        case 'AVL': {
            node.removeDocument(value, internalId);
            return true;
        }
        case 'Bool': {
            node[value ? 'true' : 'false'].delete(internalId);
            return true;
        }
        case 'Radix': {
            const tokens = tokenizer.tokenize(value, language, prop);
            implementation.removeDocumentScoreParameters(index, prop, id, docsCount);
            for (const token of tokens) {
                implementation.removeTokenScoreParameters(index, prop, token);
                node.removeDocumentByWord(token, internalId);
            }
            return true;
        }
        case 'Flat': {
            node.removeDocument(internalId, value);
            return true;
        }
        case 'BKD': {
            node.removeDocByID(value, internalId);
            return false;
        }
    }
}
export function remove(implementation, index, prop, id, internalId, value, schemaType, language, tokenizer, docsCount) {
    if (!isArrayType(schemaType)) {
        return removeScalar(implementation, index, prop, id, internalId, value, schemaType, language, tokenizer, docsCount);
    }
    const innerSchemaType = getInnerType(schemaType);
    const elements = value;
    const elementsLength = elements.length;
    for (let i = 0; i < elementsLength; i++) {
        removeScalar(implementation, index, prop, id, internalId, elements[i], innerSchemaType, language, tokenizer, docsCount);
    }
    return true;
}
export function calculateResultScores(index, prop, term, ids, docsCount, bm25Relevance, resultsMap, boostPerProperty, whereFiltersIDs, keywordMatchesMap) {
    const documentIDs = Array.from(ids);
    const avgFieldLength = index.avgFieldLength[prop];
    const fieldLengths = index.fieldLengths[prop];
    const zbsearchOccurrences = index.tokenOccurrences[prop];
    const zbsearchFrequencies = index.frequencies[prop];
    // zbsearchOccurrences[term] can be undefined, 0, string, or { [k: string]: number }
    const termOccurrences = typeof zbsearchOccurrences[term] === 'number' ? (zbsearchOccurrences[term] ?? 0) : 0;
    // Calculate TF-IDF value for each term, in each document, for each index.
    const documentIDsLength = documentIDs.length;
    for (let k = 0; k < documentIDsLength; k++) {
        const internalId = documentIDs[k];
        if (whereFiltersIDs && !whereFiltersIDs.has(internalId)) {
            continue;
        }
        // Track keyword matches per property
        if (!keywordMatchesMap.has(internalId)) {
            keywordMatchesMap.set(internalId, new Map());
        }
        const propertyMatches = keywordMatchesMap.get(internalId);
        propertyMatches.set(prop, (propertyMatches.get(prop) || 0) + 1);
        const tf = zbsearchFrequencies?.[internalId]?.[term] ?? 0;
        const bm25 = BM25(tf, termOccurrences, docsCount, fieldLengths[internalId], avgFieldLength, bm25Relevance);
        if (resultsMap.has(internalId)) {
            resultsMap.set(internalId, resultsMap.get(internalId) + bm25 * boostPerProperty);
        }
        else {
            resultsMap.set(internalId, bm25 * boostPerProperty);
        }
    }
}
export function search(index, term, tokenizer, language, propertiesToSearch, exact, tolerance, boost, relevance, docsCount, whereFiltersIDs, threshold = 0) {
    const tokens = tokenizer.tokenize(term, language);
    const keywordsCount = tokens.length || 1;
    // Track keyword matches per document and property
    const keywordMatchesMap = new Map();
    // Track which tokens were found in the search
    const tokenFoundMap = new Map();
    const resultsMap = new Map();
    for (const prop of propertiesToSearch) {
        if (!(prop in index.indexes)) {
            continue;
        }
        const tree = index.indexes[prop];
        const { type } = tree;
        if (type !== 'Radix') {
            throw createError('WRONG_SEARCH_PROPERTY_TYPE', prop);
        }
        const boostPerProperty = boost[prop] ?? 1;
        if (boostPerProperty <= 0) {
            throw createError('INVALID_BOOST_VALUE', boostPerProperty);
        }
        // if the tokenizer returns an empty array, we returns all the documents
        if (tokens.length === 0 && !term) {
            tokens.push('');
        }
        // Process each token in the search term
        const tokenLength = tokens.length;
        for (let i = 0; i < tokenLength; i++) {
            const token = tokens[i];
            const searchResult = tree.node.find({ term: token, exact, tolerance });
            // See if this token was found (for threshold=0 filtering)
            const termsFound = Object.keys(searchResult);
            if (termsFound.length > 0) {
                tokenFoundMap.set(token, true);
            }
            // Process each matching term
            const termsFoundLength = termsFound.length;
            for (let j = 0; j < termsFoundLength; j++) {
                const word = termsFound[j];
                const ids = searchResult[word];
                calculateResultScores(index, prop, word, ids, docsCount, relevance, resultsMap, boostPerProperty, whereFiltersIDs, keywordMatchesMap);
            }
        }
    }
    // Convert to array and sort by score
    const results = Array.from(resultsMap.entries())
        .map(([id, score]) => [id, score])
        .sort((a, b) => b[1] - a[1]);
    if (results.length === 0) {
        return [];
    }
    // If threshold is 1, return all results
    if (threshold === 1) {
        return results;
    }
    // For threshold=0, check if all tokens were found
    if (threshold === 0) {
        // Quick return for single tokens - already validated
        if (keywordsCount === 1) {
            return results;
        }
        // For multiple tokens, verify that ALL tokens were found
        // If any token wasn't found, return an empty result
        for (const token of tokens) {
            if (!tokenFoundMap.get(token)) {
                return [];
            }
        }
        // Find documents that have all keywords in at least one property
        const fullMatches = results.filter(([id]) => {
            const propertyMatches = keywordMatchesMap.get(id);
            if (!propertyMatches)
                return false;
            // Check if any property has all keywords
            return Array.from(propertyMatches.values()).some((matches) => matches === keywordsCount);
        });
        return fullMatches;
    }
    // Find documents that have all keywords in at least one property
    const fullMatches = results.filter(([id]) => {
        const propertyMatches = keywordMatchesMap.get(id);
        if (!propertyMatches)
            return false;
        // Check if any property has all keywords
        return Array.from(propertyMatches.values()).some((matches) => matches === keywordsCount);
    });
    // If we have full matches and threshold < 1, return full matches plus a percentage of partial matches
    if (fullMatches.length > 0) {
        const remainingResults = results.filter(([id]) => !fullMatches.some(([fid]) => fid === id));
        const additionalResults = Math.ceil(remainingResults.length * threshold);
        return [...fullMatches, ...remainingResults.slice(0, additionalResults)];
    }
    // If no full matches, return all results
    return results;
}
export function searchByWhereClause(index, tokenizer, filters, language) {
    // Handle logical operators
    if ('and' in filters && filters.and && Array.isArray(filters.and)) {
        const andFilters = filters.and;
        if (andFilters.length === 0) {
            return new Set();
        }
        const results = andFilters.map((filter) => searchByWhereClause(index, tokenizer, filter, language));
        return setIntersection(...results);
    }
    if ('or' in filters && filters.or && Array.isArray(filters.or)) {
        const orFilters = filters.or;
        if (orFilters.length === 0) {
            return new Set();
        }
        const results = orFilters.map((filter) => searchByWhereClause(index, tokenizer, filter, language));
        // Use reduce to union all sets
        return results.reduce((acc, set) => setUnion(acc, set), new Set());
    }
    if ('not' in filters && filters.not) {
        const notFilter = filters.not;
        // Get all document IDs from the internal document store
        const allDocs = new Set();
        // Get all document IDs from the internal document store
        const docsStore = index.sharedInternalDocumentStore;
        for (let i = 1; i <= docsStore.internalIdToId.length; i++) {
            allDocs.add(i);
        }
        const notResult = searchByWhereClause(index, tokenizer, notFilter, language);
        return setDifference(allDocs, notResult);
    }
    // Handle regular property filters (existing logic)
    const filterKeys = Object.keys(filters);
    const filtersMap = filterKeys.reduce((acc, key) => ({
        [key]: new Set(),
        ...acc
    }), {});
    for (const param of filterKeys) {
        const operation = filters[param];
        if (typeof index.indexes[param] === 'undefined') {
            throw createError('UNKNOWN_FILTER_PROPERTY', param);
        }
        const { node, type, isArray } = index.indexes[param];
        if (type === 'Bool') {
            const idx = node;
            const filteredIDs = operation ? idx.true : idx.false;
            filtersMap[param] = setUnion(filtersMap[param], filteredIDs);
            continue;
        }
        if (type === 'BKD') {
            let reqOperation;
            if ('radius' in operation) {
                reqOperation = 'radius';
            }
            else if ('polygon' in operation) {
                reqOperation = 'polygon';
            }
            else {
                throw new Error(`Invalid operation ${operation}`);
            }
            if (reqOperation === 'radius') {
                const { value, coordinates, unit = 'm', inside = true, highPrecision = false } = operation[reqOperation];
                const distanceInMeters = convertDistanceToMeters(value, unit);
                const ids = node.searchByRadius(coordinates, distanceInMeters, inside, undefined, highPrecision);
                filtersMap[param] = addGeoResult(filtersMap[param], ids);
            }
            else {
                const { coordinates, inside = true, highPrecision = false } = operation[reqOperation];
                const ids = node.searchByPolygon(coordinates, inside, undefined, highPrecision);
                filtersMap[param] = addGeoResult(filtersMap[param], ids);
            }
            continue;
        }
        if (type === 'Radix' && (typeof operation === 'string' || Array.isArray(operation))) {
            for (const raw of [operation].flat()) {
                const term = tokenizer.tokenize(raw, language, param);
                for (const t of term) {
                    const filteredIDsResults = node.find({ term: t, exact: true });
                    filtersMap[param] = addFindResult(filtersMap[param], filteredIDsResults);
                }
            }
            continue;
        }
        const operationKeys = Object.keys(operation);
        if (operationKeys.length > 1) {
            throw createError('INVALID_FILTER_OPERATION', operationKeys.length);
        }
        if (type === 'Flat') {
            const results = new Set(isArray
                ? node.filterArr(operation)
                : node.filter(operation));
            filtersMap[param] = setUnion(filtersMap[param], results);
            continue;
        }
        if (type === 'AVL') {
            const operationOpt = operationKeys[0];
            const operationValue = operation[operationOpt];
            let filteredIDs;
            switch (operationOpt) {
                case 'gt': {
                    filteredIDs = node.greaterThan(operationValue, false);
                    break;
                }
                case 'gte': {
                    filteredIDs = node.greaterThan(operationValue, true);
                    break;
                }
                case 'lt': {
                    filteredIDs = node.lessThan(operationValue, false);
                    break;
                }
                case 'lte': {
                    filteredIDs = node.lessThan(operationValue, true);
                    break;
                }
                case 'eq': {
                    const ret = node.find(operationValue);
                    filteredIDs = ret ?? new Set();
                    break;
                }
                case 'between': {
                    const [min, max] = operationValue;
                    filteredIDs = node.rangeSearch(min, max);
                    break;
                }
                default:
                    throw createError('INVALID_FILTER_OPERATION', operationOpt);
            }
            filtersMap[param] = setUnion(filtersMap[param], filteredIDs);
        }
    }
    // AND operation: calculate the intersection between all the IDs in filterMap
    return setIntersection(...Object.values(filtersMap));
}
export function getSearchableProperties(index) {
    return index.searchableProperties;
}
export function getSearchablePropertiesWithTypes(index) {
    return index.searchablePropertiesWithTypes;
}
export function load(sharedInternalDocumentStore, raw) {
    const { indexes: rawIndexes, vectorIndexes: rawVectorIndexes, searchableProperties, searchablePropertiesWithTypes, frequencies, tokenOccurrences, avgFieldLength, fieldLengths } = raw;
    const indexes = {};
    const vectorIndexes = {};
    for (const prop of Object.keys(rawIndexes)) {
        const { node, type, isArray } = rawIndexes[prop];
        switch (type) {
            case 'Radix':
                indexes[prop] = {
                    type: 'Radix',
                    node: RadixTree.fromJSON(node),
                    isArray
                };
                break;
            case 'Flat':
                indexes[prop] = {
                    type: 'Flat',
                    node: FlatTree.fromJSON(node),
                    isArray
                };
                break;
            case 'AVL':
                indexes[prop] = {
                    type: 'AVL',
                    node: AVLTree.fromJSON(node),
                    isArray
                };
                break;
            case 'BKD':
                indexes[prop] = {
                    type: 'BKD',
                    node: BKDTree.fromJSON(node),
                    isArray
                };
                break;
            case 'Bool':
                indexes[prop] = {
                    type: 'Bool',
                    node: BoolNode.fromJSON(node),
                    isArray
                };
                break;
            default:
                indexes[prop] = rawIndexes[prop];
        }
    }
    for (const idx of Object.keys(rawVectorIndexes)) {
        vectorIndexes[idx] = {
            type: 'Vector',
            isArray: false,
            node: VectorIndex.fromJSON(rawVectorIndexes[idx])
        };
    }
    return {
        sharedInternalDocumentStore,
        indexes,
        vectorIndexes,
        searchableProperties,
        searchablePropertiesWithTypes,
        frequencies,
        tokenOccurrences,
        avgFieldLength,
        fieldLengths
    };
}
export function save(index) {
    const { indexes, vectorIndexes, searchableProperties, searchablePropertiesWithTypes, frequencies, tokenOccurrences, avgFieldLength, fieldLengths } = index;
    const dumpVectorIndexes = {};
    for (const idx of Object.keys(vectorIndexes)) {
        dumpVectorIndexes[idx] = vectorIndexes[idx].node.toJSON();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const savedIndexes = {};
    for (const name of Object.keys(indexes)) {
        const { type, node, isArray } = indexes[name];
        if (type === 'Flat' || type === 'Radix' || type === 'AVL' || type === 'BKD' || type === 'Bool') {
            savedIndexes[name] = {
                type,
                node: node.toJSON(),
                isArray
            };
        }
        else {
            savedIndexes[name] = indexes[name];
            savedIndexes[name].node = savedIndexes[name].node.toJSON();
        }
    }
    return {
        indexes: savedIndexes,
        vectorIndexes: dumpVectorIndexes,
        searchableProperties,
        searchablePropertiesWithTypes,
        frequencies,
        tokenOccurrences,
        avgFieldLength,
        fieldLengths
    };
}
export function createIndex() {
    return {
        create,
        insert,
        remove,
        insertDocumentScoreParameters,
        insertTokenScoreParameters,
        removeDocumentScoreParameters,
        removeTokenScoreParameters,
        calculateResultScores,
        search,
        searchByWhereClause,
        getSearchableProperties,
        getSearchablePropertiesWithTypes,
        load,
        save
    };
}
function addGeoResult(set, ids) {
    if (!set) {
        set = new Set();
    }
    const idsLength = ids.length;
    for (let i = 0; i < idsLength; i++) {
        const entry = ids[i].docIDs;
        const idsLength = entry.length;
        for (let j = 0; j < idsLength; j++) {
            set.add(entry[j]);
        }
    }
    return set;
}
function createGeoTokenScores(ids, centerPoint, highPrecision = false) {
    const distanceFn = highPrecision ? BKDTree.vincentyDistance : BKDTree.haversineDistance;
    const results = [];
    // Calculate distances for all results to find the maximum
    const distances = [];
    for (const { point } of ids) {
        distances.push(distanceFn(centerPoint, point));
    }
    const maxDistance = Math.max(...distances);
    // Create results with inverse distance scores (higher score = closer)
    let index = 0;
    for (const { docIDs } of ids) {
        const distance = distances[index];
        // Use inverse score: closer points get higher scores
        // Add 1 to avoid division by zero for points at exact center
        const score = maxDistance - distance + 1;
        for (const docID of docIDs) {
            results.push([docID, score]);
        }
        index++;
    }
    // Sort by score (higher first - closer points)
    results.sort((a, b) => b[1] - a[1]);
    return results;
}
function isGeosearchOnlyQuery(filters, index) {
    const filterKeys = Object.keys(filters);
    if (filterKeys.length !== 1) {
        return { isGeoOnly: false };
    }
    const param = filterKeys[0];
    const operation = filters[param];
    if (typeof index.indexes[param] === 'undefined') {
        return { isGeoOnly: false };
    }
    const { type } = index.indexes[param];
    if (type === 'BKD' && operation && ('radius' in operation || 'polygon' in operation)) {
        return { isGeoOnly: true, geoProperty: param, geoOperation: operation };
    }
    return { isGeoOnly: false };
}
export function searchByGeoWhereClause(index, filters) {
    const indexTyped = index;
    const geoInfo = isGeosearchOnlyQuery(filters, indexTyped);
    if (!geoInfo.isGeoOnly || !geoInfo.geoProperty || !geoInfo.geoOperation) {
        return null;
    }
    const { node } = indexTyped.indexes[geoInfo.geoProperty];
    const operation = geoInfo.geoOperation;
    // Cast node to BKDTree since we already verified it's type 'BKD'
    const bkdNode = node;
    let results;
    if ('radius' in operation) {
        const { value, coordinates, unit = 'm', inside = true, highPrecision = false } = operation.radius;
        const centerPoint = coordinates;
        const distanceInMeters = convertDistanceToMeters(value, unit);
        results = bkdNode.searchByRadius(centerPoint, distanceInMeters, inside, 'asc', highPrecision);
        return createGeoTokenScores(results, centerPoint, highPrecision);
    }
    else if ('polygon' in operation) {
        const { coordinates, inside = true, highPrecision = false } = operation.polygon;
        results = bkdNode.searchByPolygon(coordinates, inside, 'asc', highPrecision);
        const centroid = BKDTree.calculatePolygonCentroid(coordinates);
        return createGeoTokenScores(results, centroid, highPrecision);
    }
    return null;
}
function addFindResult(set, filteredIDsResults) {
    if (!set) {
        set = new Set();
    }
    const keys = Object.keys(filteredIDsResults);
    const keysLength = keys.length;
    for (let i = 0; i < keysLength; i++) {
        const ids = filteredIDsResults[keys[i]];
        const idsLength = ids.length;
        for (let j = 0; j < idsLength; j++) {
            set.add(ids[j]);
        }
    }
    return set;
}
//# sourceMappingURL=index.js.map