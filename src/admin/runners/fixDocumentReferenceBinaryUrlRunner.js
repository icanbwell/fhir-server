const { compare } = require('fast-json-patch');
const deepEqual = require('fast-deep-equal');
const moment = require('moment-timezone');

const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { ReferenceParser } = require('../../utils/referenceParser');
const { isUuid } = require('../../utils/uid.util');
const { escapeRegExp } = require('../../utils/regexEscaper');
const { MongoJsonPatchHelper } = require('../../utils/mongoJsonPatchHelper');
const { RethrownError } = require('../../utils/rethrownError');

/**
 * @classdesc Backfill for DocumentReferences merged before the upstream Binary-id-to-uuid fixer existed
 * (helix.pipelines commit ffb1c88972, 2024-10-11). Legacy content[].attachment.url values still hold the
 * original vendor/source Binary id (e.g. "Binary/euecvYvs0J6ri.3vS9lrUJ1J9G8O4oFALTdDrsBkGWtg3") instead of
 * the id the matching Binary resource is actually saved under. $merge never revisits array entries that
 * were already persisted before that fixer was deployed, so this can't self-heal without a one-time rewrite.
 *
 * This does NOT generate a new uuid - it looks up the actual Binary_4_0_0 document whose meta.source (the
 * full url the Binary was originally fetched from) ends with the legacy vendor id, and links to that
 * Binary's real id. If no matching Binary is found, the entry is left untouched rather than guessed at.
 *
 * Only content[].attachment.url is touched - no other field on the resource is read or modified.
 */
class FixDocumentReferenceBinaryUrlRunner extends BaseBulkOperationRunner {
    /**
     * @param {number} batchSize
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {number|undefined} [limit]
     * @param {number|undefined} [skip]
     * @param {boolean|undefined} [useTransaction]
     */
    constructor (
        {
            batchSize,
            adminLogger,
            mongoDatabaseManager,
            limit,
            skip,
            useTransaction
        }) {
        super({
            batchSize,
            adminLogger,
            mongoDatabaseManager
        });

        /**
         * @type {number|undefined}
         */
        this.limit = limit;

        /**
         * @type {number|undefined}
         */
        this.skip = skip;

        /**
         * @type {boolean|undefined}
         */
        this.useTransaction = useTransaction;

        /**
         * @type {number}
         */
        this.numberOfUrlsFixed = 0;

        /**
         * @type {number}
         */
        this.numberOfUnresolvedBinaryReferences = 0;

        /**
         * caches vendor Binary id -> matching Binary_4_0_0 id (or null if no match found),
         * so the same vendor id isn't looked up once per DocumentReference that references it
         * @type {Map<string, string|null>}
         */
        this.binaryIdCache = new Map();

        /**
         * set by processAsync before the main loop starts
         * @type {import('mongodb').Collection<import('mongodb').Document>|undefined}
         */
        this.binaryCollection = undefined;
    }

    /**
     * finds the Binary_4_0_0 document whose meta.source (the full url the Binary was originally
     * fetched from) ends with this legacy vendor id, and returns its real `id` field
     * @param {string} vendorBinaryId
     * @returns {Promise<string|null>}
     */
    async resolveBinaryUuidAsync (vendorBinaryId) {
        if (this.binaryIdCache.has(vendorBinaryId)) {
            return this.binaryIdCache.get(vendorBinaryId);
        }
        const binaryDoc = await this.binaryCollection.findOne(
            {
                'meta.source': { $regex: `/${escapeRegExp(vendorBinaryId)}$` }
            },
            {
                projection: { _id: 0, id: 1 }
            }
        );
        const resolvedId = (binaryDoc && binaryDoc.id) || null;
        this.binaryIdCache.set(vendorBinaryId, resolvedId);
        return resolvedId;
    }

    /**
     * returns the bulk operation for this doc, or an empty array if nothing needs fixing
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync (doc) {
        try {
            /**
             * @type {Resource}
             */
            const resource = FhirResourceCreator.create(doc);
            const currentResourceJson = resource.toJSONInternal();

            let anyContentFixed = false;
            for (const content of resource.content || []) {
                const url = content.attachment && content.attachment.url;
                if (!url) {
                    continue;
                }
                const { resourceType, id } = ReferenceParser.parseReference(url);
                if (resourceType !== 'Binary' || !id || isUuid(id)) {
                    // not a Binary reference, unparseable, or already converted - nothing to do
                    continue;
                }
                const resolvedId = await this.resolveBinaryUuidAsync(id);
                if (!resolvedId) {
                    // no matching Binary found by meta.source - don't guess, leave as-is
                    this.numberOfUnresolvedBinaryReferences += 1;
                    continue;
                }
                content.attachment.url = `Binary/${resolvedId}`;
                anyContentFixed = true;
            }

            if (!anyContentFixed) {
                return [];
            }

            const updatedResourceJson = resource.toJSONInternal();
            if (deepEqual(updatedResourceJson, currentResourceJson)) {
                return [];
            }

            resource.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
            const finalResourceJson = resource.toJSONInternal();

            const patches = compare(currentResourceJson, finalResourceJson);
            const update = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({ patches });
            if (Object.keys(update).length === 0) {
                return [];
            }

            this.numberOfUrlsFixed += 1;
            return [{ updateOne: { filter: { _id: doc._id }, update } }];
        } catch (e) {
            throw new RethrownError(
                {
                    message: 'Error fixing DocumentReference Binary attachment url',
                    error: e,
                    args: { doc },
                    source: 'FixDocumentReferenceBinaryUrlRunner.processRecordAsync'
                }
            );
        }
    }

    /**
     * Runs a loop to process all matching DocumentReference documents
     * @returns {Promise<void>}
     */
    async processAsync () {
        await this.init();

        /**
         * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
         */
        const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

        const { collection: binaryCollection, client: binaryClient } = await this.createSingeConnectionAsync(
            {
                mongoConfig,
                collectionName: 'Binary_4_0_0'
            }
        );
        this.binaryCollection = binaryCollection;

        // Broad prefilter: any DocumentReference with a Binary content attachment. isUuid() inside
        // processRecordAsync is the source of truth for whether a given entry actually needs fixing -
        // this regex just keeps us from scanning DocumentReferences with no Binary content at all.
        const query = {
            'content.attachment.url': { $regex: '^Binary/' }
        };

        console.log(`query: ${JSON.stringify(query)}`);

        try {
            await this.runForQueryBatchesAsync(
                {
                    config: mongoConfig,
                    sourceCollectionName: 'DocumentReference_4_0_0',
                    destinationCollectionName: 'DocumentReference_4_0_0',
                    query,
                    startFromIdContainer: this.startFromIdContainer,
                    fnCreateBulkOperationAsync: async (doc) => await this.processRecordAsync(doc),
                    ordered: false,
                    batchSize: this.batchSize,
                    skipExistingIds: false,
                    limit: this.limit,
                    useTransaction: this.useTransaction,
                    skip: this.skip
                }
            );
        } finally {
            await this.mongoDatabaseManager.disconnectClientAsync(binaryClient);
        }

        console.log(`Resources with a Binary attachment url fixed: ${this.numberOfUrlsFixed.toLocaleString('en-US')}`);
        console.log(
            'Content entries left unresolved (no matching Binary found by meta.source): ' +
            `${this.numberOfUnresolvedBinaryReferences.toLocaleString('en-US')}`
        );

        await this.shutdown();
    }
}

module.exports = {
    FixDocumentReferenceBinaryUrlRunner
};
