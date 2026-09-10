const { ExternalTimeoutError } = require('./httpErrors');

/**
 * Delegates full-text search candidate lookup to fhir-notes-vector-store's existing Atlas
 * Search index. Returned ids are candidates only -- callers must re-authorize every id through
 * the normal tenant-scoped query path before using them (see review.md, Search / read).
 */
class ClinicalNoteSearchClient {
    /**
     * @param {Object} params
     * @param {import('./mongoDatabaseManager').MongoDatabaseManager} params.mongoDatabaseManager
     * @param {import('./configManager').ConfigManager} params.configManager
     */
    constructor ({ mongoDatabaseManager, configManager }) {
        this.mongoDatabaseManager = mongoDatabaseManager;
        this.configManager = configManager;
    }

    /**
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {string} params.contentQuery Lucene-syntax query string (the raw `_content` value)
     * @returns {Promise<string[]>} deduped FHIR ids (resourceType prefix stripped)
     */
    async findMatchingResourceIdsAsync ({ resourceType, contentQuery }) {
        try {
            const db = await this.mongoDatabaseManager.getFhirNotesDbAsync();
            const collection = db.collection(this.configManager.fhirNotesMongoCollectionName);
            const pipeline = [
                {
                    $search: {
                        index: this.configManager.fhirNotesTextSearchIndexName,
                        compound: {
                            must: [
                                { queryString: { defaultPath: 'text', query: contentQuery } }
                            ],
                            filter: [
                                { equals: { path: 'meta.resource_type', value: resourceType } }
                            ]
                        }
                    }
                },
                { $project: { 'debug.resource_reference': 1 } }
            ];
            const docs = await collection.aggregate(pipeline).toArray();
            const ids = new Set();
            for (const doc of docs) {
                const reference = doc.debug && doc.debug.resource_reference;
                if (reference && reference.includes('/')) {
                    ids.add(reference.split('/')[1]);
                }
            }
            return Array.from(ids);
        } catch (e) {
            // RethrownError does not preserve `instanceof` against the wrapped error (it extends
            // Error directly, not the wrapped error's class), so callers that need to check the
            // error type must receive the ExternalTimeoutError itself.
            throw new ExternalTimeoutError(
                `_content search is temporarily unavailable (resourceType=${resourceType}): ${e.message}`
            );
        }
    }
}

module.exports = { ClinicalNoteSearchClient };
