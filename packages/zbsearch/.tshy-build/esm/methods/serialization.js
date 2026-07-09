export function load(zbsearch, raw) {
    zbsearch.internalDocumentIDStore.load(zbsearch, raw.internalDocumentIDStore);
    zbsearch.data.index = zbsearch.index.load(zbsearch.internalDocumentIDStore, raw.index);
    zbsearch.data.docs = zbsearch.documentsStore.load(zbsearch.internalDocumentIDStore, raw.docs);
    zbsearch.data.sorting = zbsearch.sorter.load(zbsearch.internalDocumentIDStore, raw.sorting);
    zbsearch.data.pinning = zbsearch.pinning.load(zbsearch.internalDocumentIDStore, raw.pinning);
    zbsearch.tokenizer.language = raw.language;
}
export function save(zbsearch) {
    return {
        internalDocumentIDStore: zbsearch.internalDocumentIDStore.save(zbsearch.internalDocumentIDStore),
        index: zbsearch.index.save(zbsearch.data.index),
        docs: zbsearch.documentsStore.save(zbsearch.data.docs),
        sorting: zbsearch.sorter.save(zbsearch.data.sorting),
        pinning: zbsearch.pinning.save(zbsearch.data.pinning),
        language: zbsearch.tokenizer.language
    };
}
//# sourceMappingURL=serialization.js.map