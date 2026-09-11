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
            if (!db) {
                logWarn(`Refusing derived-text lookup for chunkGroupId=${chunkGroupId}, resourceType=${resourceType}: fhir-notes-vector-store connection is not available`);
                return null;
            }
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
                }, {
                    projection: { text: 1, 'meta.chunk_index': 1, 'meta.total_chunks': 1 }
                })
                .sort({ 'meta.chunk_index': 1 })
                .toArray();
            if (chunks.length === 0) {
                return null;
            }
            const expectedTotalChunks = chunks[0].meta && chunks[0].meta.total_chunks;
            if (typeof expectedTotalChunks === 'number' && chunks.length !== expectedTotalChunks) {
                // The vector store may be mid-reindex (some chunks written, others not yet), or a
                // chunk may have been deleted independently. Returning a partial note silently
                // stitched together, with no indication a gap exists, is worse for clinical text
                // than returning nothing -- fail closed rather than serve a truncated document.
                logWarn(`Refusing to return reassembled text for chunkGroupId=${chunkGroupId}, resourceType=${resourceType}: found ${chunks.length} chunks, expected ${expectedTotalChunks}`);
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
     *
     * `debug.resource` (the full owning source resource) is replicated identically across *every*
     * chunk belonging to that resource, including chunks from attachments other than the one
     * being looked up. So a raw `debug.resource.content.attachment.url`/`debug.resource
     * .presentedForm.url` match only proves "this resource has *some* attachment referencing this
     * Binary somewhere" -- it does NOT identify which specific chunk_group_id (i.e. which
     * attachment index) the requested Binary actually belongs to. Taking an arbitrary match's
     * `chunk_group_id` (as this method used to) could therefore return a *different* attachment's
     * derived text on a resource with 2+ attachments. This method instead inspects the matched
     * resource's own `content`/`presentedForm` array to find the exact index whose `.url` equals
     * the requested `Binary/{id}` reference, derives `chunkGroupId = "{resource.id}-{index}"` from
     * that, and only then filters to chunks with that exact `chunk_group_id` AND the resolved
     * owning resource's own `debug.resource_reference` -- the same reassembly
     * getReassembledTextAsync does when handed a chunkGroupId directly, plus the extra
     * resource-identity check.
     *
     * `chunk_group_id` alone is `"{rawId}-{index}"` -- if two *different* resources under the same
     * sourceAssigningAuthority happen to share both a raw id and an attachment index (e.g.
     * `DocumentReference/rec1` and `DiagnosticReport/rec1`, each with an attachment at index 0),
     * their chunks would collide on that string. The `debug.resource_reference` check closes that.
     * Separately, if the same Binary URL is matched by *more than one distinct* owning resource
     * (each independently referencing it at some index) there's no way to know which one the
     * caller's `Binary/{id}` read actually corresponds to -- this fails closed (returns null)
     * rather than guessing, since guessing could surface a resource under a different `access` tag
     * than the Binary the caller was authorized to read.
     *
     * Only `Binary/{id}` is matched (a bare, non-fragment reference) -- a `#{id}` URL is a FHIR
     * *contained*-resource reference, scoped to whichever resource contains it. Contained
     * resources are never independently addressable as a top-level `GET Binary/{id}`, so matching
     * `#{id}` here would be structurally wrong (not just imprecise) and could serve a completely
     * unrelated resource's contained attachment.
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
            const targetUrl = `Binary/${binaryId}`;
            const db = await this.mongoDatabaseManager.getFhirNotesDbAsync();
            if (!db) {
                logWarn(`Refusing derived-text reverse-lookup for binaryReference=${binaryReference}: fhir-notes-vector-store connection is not available`);
                return null;
            }
            const collection = db.collection(this.configManager.fhirNotesMongoCollectionName);
            const matches = await collection.find({
                $and: [
                    {
                        $or: [
                            { 'debug.resource.content.attachment.url': targetUrl },
                            { 'debug.resource.presentedForm.url': targetUrl }
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
            }, {
                projection: {
                    embedding: 0,
                    fhir_meta: 0,
                    'debug.resource.content.attachment.data': 0
                }
            }).toArray();
            if (matches.length === 0) {
                return null;
            }
            // debug.resource is replicated on every chunk of the resource it belongs to, so
            // `matches` can contain chunks from more than one distinct resource (e.g. two
            // different resources that happen to both reference targetUrl). Resolve the exact
            // owning resource + attachment index per distinct resource identity (derived from the
            // resource's own resourceType/id, not a separate replicated field that could drift out
            // of sync with it), rather than trusting matches[0] -- an arbitrary Mongo result-set
            // order must not decide which resource's (and which access tag's) text gets returned
            // for this Binary.
            const byResourceReference = new Map();
            for (const match of matches) {
                const owningResource = match.debug && match.debug.resource;
                if (!owningResource || !owningResource.resourceType || !owningResource.id) {
                    continue;
                }
                const resourceReference = `${owningResource.resourceType}/${owningResource.id}`;
                if (!byResourceReference.has(resourceReference)) {
                    byResourceReference.set(resourceReference, owningResource);
                }
            }
            const owningCandidates = [];
            for (const [resourceReference, owningResource] of byResourceReference) {
                const attachments = owningResource.resourceType === 'DocumentReference'
                    ? (owningResource.content || []).map(entry => entry.attachment)
                    : (owningResource.presentedForm || []);
                const matchedIndex = attachments.findIndex(attachment => attachment && attachment.url === targetUrl);
                if (matchedIndex !== -1) {
                    owningCandidates.push({ resourceReference, owningResource, matchedIndex });
                }
            }
            if (owningCandidates.length === 0) {
                return null;
            }
            if (owningCandidates.length > 1) {
                // Two distinct resources both genuinely reference this exact Binary URL at some
                // attachment index -- there is no way to know which one's text corresponds to
                // this specific Binary read, and guessing could surface a resource under a
                // different access tag than the Binary the caller was authorized to read. Fail
                // closed rather than pick one arbitrarily.
                logWarn(`Refusing derived-text reverse-lookup for binaryReference=${binaryReference}: ambiguous, matched ${owningCandidates.length} distinct resources`);
                return null;
            }
            const { resourceReference, owningResource, matchedIndex } = owningCandidates[0];
            const chunkGroupId = `${owningResource.id}-${matchedIndex}`;
            const chunks = matches
                .filter(m => {
                    const r = m.debug && m.debug.resource;
                    return m.meta.chunk_group_id === chunkGroupId &&
                        r && `${r.resourceType}/${r.id}` === resourceReference;
                })
                .sort((a, b) => a.meta.chunk_index - b.meta.chunk_index);
            if (chunks.length === 0) {
                return null;
            }
            return chunks.map(c => c.text || '').join('');
        } catch (e) {
            logWarn(`Failed to reverse-lookup clinical note text for binaryReference=${binaryReference}`, { error: e });
            return null;
        }
    }
}

module.exports = { ClinicalNoteTextRetriever };
