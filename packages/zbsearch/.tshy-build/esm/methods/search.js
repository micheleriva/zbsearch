import { createError } from '../errors.js';
import { MODE_FULLTEXT_SEARCH, MODE_HYBRID_SEARCH, MODE_VECTOR_SEARCH } from '../constants.js';
import { fullTextSearch } from './search-fulltext.js';
import { searchVector } from './search-vector.js';
import { hybridSearch } from './search-hybrid.js';
export function search(zbsearch, params, language) {
    const mode = params.mode ?? MODE_FULLTEXT_SEARCH;
    if (mode === MODE_FULLTEXT_SEARCH) {
        return fullTextSearch(zbsearch, params, language);
    }
    if (mode === MODE_VECTOR_SEARCH) {
        return searchVector(zbsearch, params);
    }
    if (mode === MODE_HYBRID_SEARCH) {
        return hybridSearch(zbsearch, params);
    }
    throw createError('INVALID_SEARCH_MODE', mode);
}
//# sourceMappingURL=search.js.map