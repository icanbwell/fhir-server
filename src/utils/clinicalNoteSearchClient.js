const { ExternalTimeoutError, BadRequestError } = require('./httpErrors');
const { SecurityTagSystem } = require('./securityTagSystem');
const { generateUUIDv5, isUuid } = require('./uid.util');

/**
 * Cap on how many chunk documents a single `_content` search pulls back from the vector store's
 * `$search` stage. Atlas Search has no implicit result cap in an aggregation pipeline, so without
 * this a broad/common query term could materialize the entire collection into fhir-server's heap
 * and send an enormous `_id $in [...]` to the primary cluster. `meta.resource_type` is not a
 * mapped field in the vector store's text-search index (only `text`, `patient_id`, and `key` are),
 * so it cannot be pushed into `$search.compound.filter` -- the resourceType scoping below is a
 * `$match` stage instead, which runs after this limit. That means a broad query dominated by
 * other resourceTypes could under-return true matches for the requested resourceType; that's an
 * accepted trade-off against unbounded memory/network use, not a correctness guarantee.
 */
const MAX_CANDIDATE_CHUNKS = 1000;

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
     * Returns candidate `_uuid`s (fhir-server's own globally-unique internal id), not raw source
     * ids. The vector store's `debug.resource_reference` is built from the resource's raw
     * `_sourceId`, which is only unique per (resourceType, sourceAssigningAuthority) -- returning
     * it directly would let `FilterById` route it into a bare `{_sourceId: {$in: [...]}}` filter
     * with no tenant discriminator in the join condition itself (review.md §E), letting one
     * tenant's `_content` search pick up an unrelated same-sourceId resource belonging to another
     * tenant/SAA as a false-positive candidate. Resolving to `_uuid` here (the same
     * `generateUUIDv5(\`${id}|${sourceAssigningAuthority}\`)` scheme `uuidColumnHandler.js` uses to
     * populate `_uuid` in the first place) closes that: a candidate whose chunk has no
     * `sourceAssigningAuthority` tag is dropped rather than guessed at.
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {string} params.contentQuery Lucene-syntax query string (the raw `_content` value)
     * @param {string[]|undefined} [params.patientIds] The caller's already-resolved patient-scope
     *   id list, if any (never derived from a raw request param -- see
     *   `SearchManager.buildContentSearchIdFilterAsync`). Pushed into `$search.compound.filter`
     *   as a defense-in-depth pre-filter, narrowing the scan before results are re-authorized;
     *   never a substitute for that re-authorization. `patient_id`/`patient_uuid` are both mapped
     *   `token` fields on the real index (unlike `meta.resource_type`), so this is a real
     *   `$search`-level filter, not a post-`$search` `$match`. Ids are split by shape and matched
     *   against whichever field they're shaped for (`patient_id` for raw source ids,
     *   `patient_uuid` for fhir-server `_uuid`s) since the caller's resolved scope can contain
     *   either -- see fhir-notes-vector-store's `patient_uuid` field. **Caveat**: chunks indexed
     *   before that field existed won't have it until reindexed, so a uuid-shaped patientId will
     *   silently miss not-yet-reindexed content; this is a temporary, disclosed limitation, not a
     *   permanent one.
     * @returns {Promise<string[]>} deduped candidate `_uuid`s
     */
    async findMatchingResourceIdsAsync ({ resourceType, contentQuery, patientIds }) {
        if (typeof contentQuery !== 'string' || contentQuery.trim().length === 0) {
            throw new BadRequestError(new Error(
                `_content must be a single non-empty string value: ${JSON.stringify(contentQuery)}`
            ));
        }
        try {
            const db = await this.mongoDatabaseManager.getFhirNotesDbAsync();
            if (!db) {
                throw new Error('fhir-notes-vector-store connection is not available');
            }
            const collection = db.collection(this.configManager.fhirNotesMongoCollectionName);
            const searchBody = patientIds && patientIds.length > 0
                ? {
                    compound: {
                        must: [{ queryString: { defaultPath: 'text', query: contentQuery } }],
                        filter: [{
                            compound: {
                                should: [
                                    ...(patientIds.some(id => !isUuid(id))
                                        ? [{ in: { path: 'patient_id', value: patientIds.filter(id => !isUuid(id)) } }]
                                        : []),
                                    ...(patientIds.some(id => isUuid(id))
                                        ? [{ in: { path: 'patient_uuid', value: patientIds.filter(id => isUuid(id)) } }]
                                        : [])
                                ],
                                minimumShouldMatch: 1
                            }
                        }]
                    }
                }
                : { queryString: { defaultPath: 'text', query: contentQuery } };
            const pipeline = [
                { $search: { index: this.configManager.fhirNotesTextSearchIndexName, ...searchBody } },
                { $limit: MAX_CANDIDATE_CHUNKS },
                { $match: { 'meta.resource_type': resourceType } },
                {
                    $project: {
                        'debug.resource_reference': 1,
                        'debug.resource.meta.security': 1
                    }
                }
            ];
            const docs = await collection.aggregate(pipeline).toArray();
            const uuids = new Set();
            for (const doc of docs) {
                const reference = doc.debug && doc.debug.resource_reference;
                if (!reference || !reference.includes('/')) {
                    continue;
                }
                const sourceId = reference.split('/')[1];
                const securityTags = (doc.debug.resource && doc.debug.resource.meta && doc.debug.resource.meta.security) || [];
                const sourceAssigningAuthority = securityTags
                    .filter(tag => tag.system === SecurityTagSystem.sourceAssigningAuthority)
                    .map(tag => tag.code)[0];
                if (!sourceAssigningAuthority) {
                    // Fail closed: without a tenant discriminator we cannot safely resolve this
                    // candidate to a globally-unique _uuid, and returning its raw sourceId would
                    // reintroduce the cross-tenant join risk this method exists to close.
                    continue;
                }
                uuids.add(generateUUIDv5(`${sourceId}|${sourceAssigningAuthority}`));
            }
            return Array.from(uuids);
        } catch (e) {
            // Never `instanceof BadRequestError` -- ServerError's constructor calls
            // Object.setPrototypeOf(this, ServerError.prototype) unconditionally, which breaks
            // `instanceof` for every httpErrors.js subclass. Check statusCode instead, matching
            // this codebase's established convention (see httpErrors.test.js).
            if (e.statusCode === 400) {
                throw e;
            }
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
