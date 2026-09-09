const { compare } = require('fast-json-patch');
const deepEqual = require('fast-deep-equal');
const moment = require('moment-timezone');

const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { ReferenceParser } = require('../../utils/referenceParser');
const { isUuid, generateUUIDv5 } = require('../../utils/uid.util');
const { MongoJsonPatchHelper } = require('../../utils/mongoJsonPatchHelper');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { RethrownError } = require('../../utils/rethrownError');

/**
 * @classdesc Backfill for DocumentReferences merged before the upstream Binary-id-to-uuid fixer existed
 * (helix.pipelines commit ffb1c88972, 2024-10-11). Legacy content[].attachment.url values still hold the
 * original vendor/source Binary id (e.g. "Binary/euecvYvs0J6ri.3vS9lrUJ1J9G8O4oFALTdDrsBkGWtg3") instead of
 * the uuid5 id we generate for Binary.id ("Binary/<uuid>"). $merge never revisits array entries that were
 * already persisted before that fixer was deployed, so this can't self-heal without a one-time rewrite.
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
        this.numberOfResourcesSkippedForMissingAuthority = 0;
    }

    /**
     * reads sourceAssigningAuthority the same way the upstream fixer does, with a meta.security fallback
     * for documents where the shadow column was never populated
     * @param {import('mongodb').DefaultSchema} doc
     * @return {string|undefined}
     */
    getSourceAssigningAuthority (doc) {
        if (doc._sourceAssigningAuthority) {
            return doc._sourceAssigningAuthority;
        }
        const securityTags = (doc.meta && doc.meta.security) || [];
        const authorityTag = securityTags.find(
            (tag) => tag.system === SecurityTagSystem.sourceAssigningAuthority
        );
        return authorityTag ? authorityTag.code : undefined;
    }

    /**
     * returns the bulk operation for this doc, or an empty array if nothing needs fixing
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync (doc) {
        try {
            const sourceAssigningAuthority = this.getSourceAssigningAuthority(doc);

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
                if (!sourceAssigningAuthority) {
                    // can't compute the same uuid5 the upstream fixer would without this - skip, don't guess
                    this.numberOfResourcesSkippedForMissingAuthority += 1;
                    continue;
                }
                const newId = generateUUIDv5(`${id}|${sourceAssigningAuthority}`);
                content.attachment.url = `Binary/${newId}`;
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

        // Broad prefilter: any DocumentReference with a Binary content attachment. isUuid() inside
        // processRecordAsync is the source of truth for whether a given entry actually needs fixing -
        // this regex just keeps us from scanning DocumentReferences with no Binary content at all.
        const query = {
            'content.attachment.url': { $regex: '^Binary/' }
        };

        console.log(`query: ${JSON.stringify(query)}`);

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

        console.log(`Resources with a Binary attachment url fixed: ${this.numberOfUrlsFixed.toLocaleString('en-US')}`);
        console.log(
            'Content entries skipped due to missing sourceAssigningAuthority: ' +
            `${this.numberOfResourcesSkippedForMissingAuthority.toLocaleString('en-US')}`
        );

        await this.shutdown();
    }
}

module.exports = {
    FixDocumentReferenceBinaryUrlRunner
};
