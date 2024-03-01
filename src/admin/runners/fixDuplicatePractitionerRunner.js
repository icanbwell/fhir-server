const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { RethrownError } = require('../../utils/rethrownError');
const { isValidMongoObjectId } = require('../../utils/mongoIdValidator');
const { ObjectId } = require('mongodb');

/**
 * @classdesc Finds _uuid of resources where count is greater than 1 and fix them
 */
class FixDuplicatePractitionerRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {string[]} collections
     * @param {number} batchSize
     * @param {AdminLogger} adminLogger
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {string|undefined} startFromCollection
     * @param {number|undefined} limit
     * @param {string|undefined} skip
     * @param {string|undefined} startFromId
     * @param {boolean|undefined} useTransaction
     * @param {string[]|undefined} properties
     * @param {string|undefined} afterLastUpdatedDate
     * @param {string|undefined} beforeLastUpdatedDate
     */
    constructor ({
        mongoCollectionManager,
        collections,
        batchSize,
        adminLogger,
        mongoDatabaseManager,
        startFromCollection,
        limit,
        skip,
        startFromId,
        useTransaction,
        properties,
        afterLastUpdatedDate,
        beforeLastUpdatedDate
    }) {
        super({
            mongoCollectionManager,
            batchSize,
            adminLogger,
            mongoDatabaseManager
        });
        /**
         * @type {string[]}
         */
        this.collections = collections;

        /**
         * @type {string|undefined}
         */
        this.startFromCollection = startFromCollection;

        /**
         * @type {number|undefined}
         */
        this.limit = limit;

        /**
         * @type {string|undefined}
         */
        this.skip = skip;

        /**
         * @type {string|undefined}
         */
        this.startFromId = startFromId;

        /**
         * @type {boolean|undefined}
         */
        this.useTransaction = useTransaction;

        /**
         * @type {string[]|undefined}
         */
        this.properties = properties;

        /**
         * @type {string|undefined}
         */
        this.afterLastUpdatedDate = afterLastUpdatedDate;

        /**
         * @type {string|undefined}
         */
        this.beforeLastUpdatedDate = beforeLastUpdatedDate;

        /**
         * stores resources and fields to be updated
         * @type {Map<string, string[]>}
         */
        this.fieldsToUpdate = new Map([
            ['Appointment_4_0_0', ['participant.actor', 'agent.who']],
            ['CarePlan_4_0_0', ['careTeam.member']],
            ['CareTeam_4_0_0', ['participant.member']],
            ['Communication_4_0_0', ['sender', 'recipient']],
            ['CommunicationRequest_4_0_0', ['requester', 'recipient']],
            ['Condition_4_0_0', ['asserter']],
            ['Consent_4_0_0', ['performer']],
            ['DeviceRequest_4_0_0', ['requester']],
            ['DiagnosticReport_4_0_0', ['performer']],
            ['Encounter_4_0_0', ['participant.individual']],
            ['EpisodeOfCare_4_0_0', ['careManager', 'team.member']],
            ['Immunization_4_0_0', ['performer.actor']],
            ['MedicationAdministration_4_0_0', ['performer.actor']],
            ['MedicationRequest_4_0_0', ['requester']],
            ['Observation_4_0_0', ['performer']],
            ['Procedure_4_0_0', ['performer.actor']],
            ['Provenance_4_0_0', ['agent.who']],
            ['ServiceRequest_4_0_0', ['requester']],
            ['SupplyRequest_4_0_0', ['requester']],
            ['Task_4_0_0', ['requester', 'owner']]
        ]);

        /**
         * stores substitution values for Practitioners
         * @type {Map<string, Object>}
         */
        this.practitionerSubstitutions = new Map();

        /**
         * stores meta and _id information for each _sourceId
         * @type {Map<string, {meta: Object, _id: string}[]>}
         */
        this.metaIdCache = new Map();
    }

    /**
     * converts list of properties to a projection
     * @return {import('mongodb').Document}
     */
    getProjection () {
        /**
         * @type {import('mongodb').Document}
         */
        const projection = {};
        for (const property of this.properties) {
            projection[`${property}`] = 1;
        }
        // always add projection for needed properties
        const neededProperties = [
            'resourceType',
            'meta',
            'identifier',
            '_uuid',
            '_sourceId',
            '_sourceAssigningAuthority'
        ];
        for (const property of neededProperties) {
            projection[`${property}`] = 1;
        }
        return projection;
    }

    /**
     * Gets query for duplicate Practitioner resources
     * @param {string[]} DuplicatePractitionerArray
     * @returns {import('mongodb').Filter<import('mongodb').Document>}
     */
    getQueryForDuplicatePractitionerResources ({ DuplicatePractitionerArray }) {
        /**
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        let query = { _sourceId: { $in: DuplicatePractitionerArray } };
        if (DuplicatePractitionerArray.length === 1) {
            query = { _sourceId: DuplicatePractitionerArray[0] };
        }

        if (this.afterLastUpdatedDate && this.beforeLastUpdatedDate) {
            query = {
                $and: [
                    query,
                    { 'meta.lastUpdated': { $gt: this.afterLastUpdatedDate } },
                    { 'meta.lastUpdated': { $lt: this.beforeLastUpdatedDate } }
                ]
            };
        } else if (this.afterLastUpdatedDate) {
            query = {
                $and: [query, { 'meta.lastUpdated': { $gt: this.afterLastUpdatedDate } }]
            };
        } else if (this.beforeLastUpdatedDate) {
            query = {
                $and: [query, { 'meta.lastUpdated': { $lt: this.beforeLastUpdatedDate } }]
            };
        }

        if (this.startFromId) {
            const startId = isValidMongoObjectId(this.startFromId) ? new ObjectId(this.startFromId)
                : this.startFromId;
            query.$and.push({
                _id: {
                    $gte: startId
                }
            });
        }

        return query;
    }

    /**
     * Gets duplicate practitioners with NPI _sourceIds
     * @param {require('mongodb').collection} collection
     * @returns {Promise<string[]>}
     */
    async getDuplicatePractitionerArrayAsync ({ collection }) {
        const result = (
            await collection
                .aggregate(
                    [
                        {
                            $match: {
                              _sourceId: {
                                $regex: '^[0-9]{10}$'
                              }
                            }
                        },
                        {
                            $group: {
                                _id: '$_sourceId',
                                count: { $count: {} },
                                meta: { $push: '$meta' },
                                id: { $push: '$_id' },
                                uuid: { $push: '$_uuid' },
                                sourceAssigningAuthority: { $push: '$_sourceAssigningAuthority' }
                            }
                        },
                        {
                            $match: {
                                count: {
                                    $gte: 2
                                }
                            }
                        }
                    ],
                    { allowDiskUse: true }
                )
                .toArray()
        );

        return result;
    }

    /**
     * Creates map of substitutions for old/new Practitioner values
     * @param {array} dups
     */
    async createPractitionerSubstitutions (dups) {
        // loop thru array and create substitution object fields
        dups.forEach(dup => {
            let correctIndex = 0;
            let inCorrectIndex = 0;
            const subs = {};
            if (dup.sourceAssigningAuthority[0] === 'nppes') {
                correctIndex = 0;
                inCorrectIndex = 1;
            } else {
                correctIndex = 1;
                inCorrectIndex = 0;
            }
            subs.goodReference = `Practitioner/${dup._id}|nppes`;
            subs.badReference = `Practitioner/${dup._id}`;
            subs.goodUuid = `Practitioner/${dup.uuid[correctIndex]}`;
            subs.badUuid = `Practitioner/${dup.uuid[inCorrectIndex]}`;
            this.practitionerSubstitutions.set(dup._id, subs);
        });
    }

    /**
     * Perform substitutions in one reference field
     * @param {Object} ref
     * @param {string} sourceId
     * @returns {Promise <Object>}
     */
    async substituteOneReference ({ ref, sourceId }) {
        // do simple fields
        const subs = this.practitionerSubstitutions.get(sourceId);
        ref._uuid = subs.goodUuid;
        if (ref.reference.startsWith(subs.badReference)) {
            ref.reference = subs.goodReference;
        } else {
            ref.reference = subs.goodUuid;
        }
        ref._sourceId = subs.goodReference;
        ref._sourceAssigningAuthority = 'nppes';
        // do the extension fields
        if (ref.extension && Array.isArray(ref.extension)) {
            ref.extension.forEach(ext => {
                if (ext.id === 'sourceid') {
                    ext.valueString = subs.goodReference;
                }
                if (ext.id === 'sourceAssigningAuthority') {
                    ext.valueString = 'nppes';
                }
                if (ext.id === 'uuid') {
                    ext.valueString = subs.goodUuid;
                }
            });
        }

        return ref;
    }

    /**
     * update duplicated Practitioner references for the collection
     * @param {string} collectionName
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processResourceAsync ({ collectionName }) {
        try {
            // if (
            //     this.processedUuids.has(collectionName) &&
            //     this.processedUuids.get(collectionName).has(uuid)
            // ) {
            //     return [];
            // }
            //
            // if (!this.metaIdCache.has(uuid)) {
            //     // safety check
            //     this.adminLogger.logInfo(`uuid: ${uuid} is missing from cache`);
            //     return [];
            // }
            //
            // const resources = this.metaIdCache.get(uuid);

            // const resourceWithoutMetaVersionId = resources.filter(res => !res.meta?.versionId);
            // if (resourceWithoutMetaVersionId.length > 0) {
            //     this.adminLogger.logInfo(
            //         `Resources without versionId for uuid: ${uuid} and _id: ${resourceWithoutMetaVersionId.map(res => res._id).join()}`
            //     );
            //     return [];
            // }
            //
            // /**
            //  * @type {number}
            //  */
            // const versionIdToKeep = resources.reduce(
            //     (versionId, res) => Math.max(versionId, Number(res.meta.versionId)),
            //     0
            // );
            //
            // /**
            //  * @type {Object}
            //  */
            // const resourcesWithMaxVersionId = resources.filter(
            //     (res) => Number(res.meta.versionId) === versionIdToKeep
            // );
            //
            // if (resourcesWithMaxVersionId.length > 1) {
            //     resourcesWithMaxVersionId.sort((res1, res2) => (new Date(res2.meta.lastUpdated)).getTime() - (new Date(res1.meta.lastUpdated)).getTime());
            // }
            //
            // const resourcesToDelete = resources.reduce((toDelete, res) => {
            //     if (res._id !== resourcesWithMaxVersionId[0]._id) {
            //         toDelete.push(res._id);
            //     }
            //     return toDelete;
            // }, []);
            //
            // if (!this.processedUuids.has(collectionName)) {
            //     this.processedUuids.set(collectionName, new Set());
            // }
            // this.processedUuids.get(collectionName).add(uuid);
            //
            const resourcesToDelete = [];
            return [
                {
                    deleteMany: {
                        filter: {
                            _id: { $in: resourcesToDelete }
                        }
                    }
                }
            ];
        } catch (e) {
            throw new RethrownError({
                message: `Error processing record ${e.message}`,
                error: e,
                args: {
                    collectionName
                },
                source: 'FixDuplicatePractitionerRunner.processRecordAsync'
            });
        }
    }

    /**
     * Runs a loop on all the documents
     * @returns {Promise<void>}
     */
    async processAsync () {
        // noinspection JSValidateTypes
        try {
            if (this.collections.length > 0 && this.collections[0] === 'all') {
                /**
                 * @type {string[]}
                 */
                this.collections = await this.getAllCollectionNamesAsync({
                    useAuditDatabase: false,
                    includeHistoryCollections: false
                });
                this.collections = this.collections.sort();
                if (this.startFromCollection) {
                    this.collections = this.collections.filter(
                        (c) => c >= this.startFromCollection
                    );
                }
            }

            /**
             * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
             */
            const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

            // const { db, client, session } = await this.createSingeConnectionAsync({
            //     mongoConfig, collectionName: 'collection'
            // });
            const duplicatePractitionerArray = await this.getDuplicatePractitionerArrayAsync({
                collection: 'Practitioner_4_0_0'
            });
            await this.createPractitionerSubstitutions(duplicatePractitionerArray);
            try {
                for (const collectionName of this.collections) {
                    // const collection = db.collection(collectionName);
                    /**
                     * @type {string[]}
                     */

                    // const startFromIdContainer = this.createStartFromIdContainer();

                    /**
                     * @type {import('mongodb').Filter<import('mongodb').Document>}
                     */
                    const query = this.getQueryForDuplicatePractitionerResources({
                        duplicatePractitionerArray
                    });

                    if (duplicatePractitionerArray.length > 0) {
                        this.adminLogger.logInfo(`Started processing uuids for ${collectionName}`);
                        this.adminLogger.logInfo(
                            `duplicate uuids for the collection: ${duplicatePractitionerArray.join()}`
                        );
                        try {
                            await this.runForQueryBatchesAsync({
                                config: mongoConfig,
                                sourceCollectionName: collectionName,
                                destinationCollectionName: collectionName,
                                query,
                                projection: this.properties ? this.getProjection() : undefined,
                                fnCreateBulkOperationAsync: async (doc) =>
                                    await this.processResourceAsync({
                                        uuid: doc._uuid,
                                        collectionName
                                    }),
                                ordered: false,
                                batchSize: this.batchSize,
                                skipExistingIds: false,
                                limit: this.limit,
                                useTransaction: this.useTransaction,
                                skip: this.skip
                            });
                        } catch (e) {
                            console.log(e.message);
                            this.adminLogger.logError(
                                `Got error ${e}. `
                            );
                            throw new RethrownError({
                                message: `Error processing references of collection ${collectionName} ${e.message}`,
                                error: e,
                                args: {
                                    query
                                },
                                source: 'FixDuplicatePractitionerRunner.processAsync'
                            });
                        }

                        this.adminLogger.logInfo(`Finished processing uuids for ${collectionName}`);
                    } else {
                        this.adminLogger.logInfo(
                            `${collectionName} does not contain duplicate _uuid resource`
                        );
                    }
                }
            } finally {
                // await session.endSession();
                // await client.close();
            }

            this.adminLogger.logInfo('Finished script');
            this.adminLogger.logInfo('Shutting down');
            await this.shutdown();
            this.adminLogger.logInfo('Shutdown finished');
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e}`);
        }
    }
}

module.exports = {
    FixDuplicatePractitionerRunner
};
