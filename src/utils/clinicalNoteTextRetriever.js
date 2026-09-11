const { logWarn } = require('../operations/common/logging');
const { SecurityTagSystem } = require('./securityTagSystem');

/**
 * Reassembles chunked clinical-note text from fhir-notes-vector-store's ClinicalNote
 * collection. Used only for read-time enrichment/reverse-lookup, both of which run after a
 * resource's own authorized fetch has already succeeded -- this class never gates access to
 * anything, it only fetches more data about a resource the caller can already see.
 */
class ClinicalNoteTextRetriever {
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
     * `chunkGroupId` is built from the resource's raw FHIR `id` (`"{resourceId}-{contentIndex}"`),
     * which -- per IdEnrichmentProvider -- is the resource's raw `_sourceId` where present, not
     * its globally-unique internal `_uuid`. Raw source ids are only guaranteed unique per
     * (resourceType, sourceAssigningAuthority), not globally, so two different tenants'
     * same-resourceType resources (or a `DocumentReference`/`DiagnosticReport` pair) could share
     * the same raw id string and collide on `chunk_group_id`.
     *
     * A vector-store hit is a candidate, never authoritative on its own (see review.md §E and
     * task-11-report.md's Finding 4/5 write-ups) -- so this verifies the chunk's own embedded
     * `debug.resource.meta.security` sourceAssigningAuthority tag matches the caller's
     * already-authorized `sourceAssigningAuthority`, as a real discriminator in the query itself,
     * not a later filter step. `resourceType` closes the cross-resourceType collision;
     * `sourceAssigningAuthority` closes the cross-tenant, same-resourceType collision. If the
     * caller can't supply a `sourceAssigningAuthority` (the authorized resource has no such
     * security tag), this fails closed -- no lookup is attempted and `null` is returned, rather
     * than guessing or falling back to an unscoped query.
     * @param {Object} params
     * @param {string} params.chunkGroupId `"{resourceId}-{contentIndex}"`
     * @param {string} params.resourceType e.g. "DocumentReference" -- must match `meta.resource_type`
     * @param {string|undefined} params.sourceAssigningAuthority the tenant tag already verified on
     *   the caller's authorized resource -- required; a falsy value fails closed (no lookup)
     * @returns {Promise<string|null>}
     */
    async getReassembledTextAsync ({ chunkGroupId, resourceType, sourceAssigningAuthority }) {
        if (!this.configManager.fhirNotesFullTextSearchConfigured) {
            return null;
        }
        if (!sourceAssigningAuthority) {
            logWarn(`Refusing derived-text lookup for chunkGroupId=${chunkGroupId}, resourceType=${resourceType}: no sourceAssigningAuthority to scope the query by`);
            return null;
        }
        try {
            const db = await this.mongoDatabaseManager.getFhirNotesDbAsync();
            const collection = db.collection(this.configManager.fhirNotesMongoCollectionName);
            const chunks = await collection
                .find({
                    'meta.chunk_group_id': chunkGroupId,
                    'meta.resource_type': resourceType,
                    'debug.resource.meta.security': {
                        $elemMatch: {
                            system: SecurityTagSystem.sourceAssigningAuthority,
                            code: sourceAssigningAuthority
                        }
                    }
                })
                .sort({ 'meta.chunk_index': 1 })
                .toArray();
            if (chunks.length === 0) {
                return null;
            }
            return chunks.map(c => c.text || '').join('');
        } catch (e) {
            logWarn(`Failed to reassemble clinical note text for chunkGroupId=${chunkGroupId}, resourceType=${resourceType}`, { error: e });
            return null;
        }
    }

    /**
     * Same tenant-scoping principle as getReassembledTextAsync -- see that method's doc comment.
     * `sourceAssigningAuthority` here comes from the `Binary` resource's own `meta.security` (the
     * resource the caller is already authorized to read), and is required in the same way.
     * @param {Object} params
     * @param {string} params.binaryReference e.g. "Binary/abc123"
     * @param {string|undefined} params.sourceAssigningAuthority the tenant tag already verified on
     *   the caller's authorized Binary resource -- required; a falsy value fails closed (no lookup)
     * @returns {Promise<string|null>}
     */
    async getReassembledTextForBinaryAsync ({ binaryReference, sourceAssigningAuthority }) {
        if (!this.configManager.fhirNotesFullTextSearchConfigured) {
            return null;
        }
        if (!sourceAssigningAuthority) {
            logWarn(`Refusing derived-text reverse-lookup for binaryReference=${binaryReference}: no sourceAssigningAuthority to scope the query by`);
            return null;
        }
        try {
            const binaryId = binaryReference.split('/')[1];
            const db = await this.mongoDatabaseManager.getFhirNotesDbAsync();
            const collection = db.collection(this.configManager.fhirNotesMongoCollectionName);
            const urlVariants = [`Binary/${binaryId}`, `#${binaryId}`];
            const matches = await collection.find({
                $and: [
                    {
                        $or: [
                            { 'debug.resource.content.attachment.url': { $in: urlVariants } },
                            { 'debug.resource.presentedForm.url': { $in: urlVariants } }
                        ]
                    },
                    {
                        'debug.resource.meta.security': {
                            $elemMatch: {
                                system: SecurityTagSystem.sourceAssigningAuthority,
                                code: sourceAssigningAuthority
                            }
                        }
                    }
                ]
            }).toArray();
            if (matches.length === 0) {
                return null;
            }
            const chunkGroupId = matches[0].meta.chunk_group_id;
            const chunks = matches
                .filter(m => m.meta.chunk_group_id === chunkGroupId)
                .sort((a, b) => a.meta.chunk_index - b.meta.chunk_index);
            return chunks.map(c => c.text || '').join('');
        } catch (e) {
            logWarn(`Failed to reverse-lookup clinical note text for binaryReference=${binaryReference}`, { error: e });
            return null;
        }
    }
}

module.exports = { ClinicalNoteTextRetriever };
