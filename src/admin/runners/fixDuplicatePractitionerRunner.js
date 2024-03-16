const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { RethrownError } = require('../../utils/rethrownError');
const { isValidMongoObjectId } = require('../../utils/mongoIdValidator');
const { ObjectId } = require('mongodb');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');

/**
 * @classdesc Finds _uuid of resources where count is greater than 1 and fix them
 */
class FixDuplicatePractitionerRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {string[]} collections
     * @param {number} batchSize
     * @param {string} deleteData
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
        deleteData,
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
         * @type {string|undefined}
         */
        this.deleteData = deleteData;

        /**
         * @type {Array}
         */
        this.dupUuids = [];

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
         * stores substitution values for Practitioners by sourceid
         * @type {Map<string, Object>}
         */
        this.practitionerSubstitutionsBySourceId = new Map();

        /**
         * stores substitution values for Practitioners by uuid
         * @type {Map<string, Object>}
         */
        this.practitionerSubstitutionsByUuid = new Map();
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
     * Gets query for resource to fix duplicate Practitioner resources
     * @returns {import('mongodb').Filter<import('mongodb').Document>}
     */
    getQueryForFixCollection () {
        /**
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        let query = {};

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
            query = {
                       $and: [query, { _id: { $gte: startId } }]
            };
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
     * @return {Promise<any>}
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
 //           this.practitionerSubstitutionsBySourceId.set(dup._id, subs);
            this.practitionerSubstitutionsByUuid.set(subs.badUuid, subs);
            this.dupUuids.push(subs.badUuid);
        });
    }

    /**
     * Perform substitutions in one reference field
     * @param {any} ref
     * @returns {Promise <Object>}
     */
    async substituteOneReference ({ ref }) {
        this.adminLogger.logInfo(`In Subref, ref = ${JSON.stringify(ref)}`);
        const subs = this.practitionerSubstitutionsByUuid.get(ref._uuid);
        if (subs) {
            // do simple fields
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
                    if (ext.id === 'sourceId') {
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
        }
        return ref;
    }

    /**
     * update duplicated Practitioner references for the collection
     * @param {import('mongodb').DefaultSchema} doc
     * @param {string} collectionName
     * @param {string} field
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processResourceAsync ({ doc, collectionName, field }) {
        this.adminLogger.logInfo(`[processRecordsAsync] Processing doc _id: ${doc._id}}`);
        const operations = [];
        try {
            this.adminLogger.logInfo('***************Inside processResourceAsync');
            /**
             * @type {Resource}
             */
            const resource = FhirResourceCreator.create(doc);
            this.adminLogger.logInfo(`Updating ${collectionName} uuid ${resource._uuid}`);
            const fields = field.split('.');
            if (fields.length === 1) {
                let f0 = resource[fields[0]];
                this.adminLogger.logInfo(`One level field ${f0}`);
                if (f0) {
                    if (!Array.isArray(f0)) {
                        f0 = [f0];
                    }
                    for (let i = 0; i < f0.length; i++) {
                        const ref = f0[i];
                        if (this.dupUuids.includes(ref._uuid)) {
                            const newRef = this.substituteOneReference({ ref });
                            this.adminLogger.logInfo(`New reference ${JSON.stringify(newRef)}`);
                            resource[fields[0]][i] = newRef;
                         }
                    }
                }
            } else if (fields.length === 2) {
                let f0 = resource[fields[0]];
                this.adminLogger.logInfo(`two level fields ${JSON.stringify(f0)}`);
                if (f0) {
                    if (!Array.isArray(f0)) {
                        f0 = [f0];
                    }
                     for (let i = 0; i < f0.length; i++) {
                         let subf = f0[i];
                         this.adminLogger.logInfo(`subf ${i}  ${JSON.stringify(subf)}`);
                         if (!Array.isArray(subf)) {
                            subf = [subf];
                         }
                         for (let j = 0; j < subf.length; j++) {
                             this.adminLogger.logInfo(` 2nd level field ${fields[1]}`);
                             const subObj = subf[j];
                             this.adminLogger.logInfo(`subObj ${j} ${JSON.stringify(subObj)}`);
                             // eslint-disable-next-line dot-notation
                             const ref = subObj[fields[1]];
                             this.adminLogger.logInfo(`2-level, pre-update reference ${JSON.stringify(ref)}`);
                             if (this.dupUuids.includes(ref._uuid)) {
                                 const newRef = this.substituteOneReference({ ref });
                                 this.adminLogger.logInfo(`New reference ${JSON.stringify(newRef)}`);
                                 resource[fields[0]][i][fields[1]][j] = newRef;
                             }
                         }
                     }
                }
            }

            const updatedResourceJsonInternal = resource.toJSONInternal();
            operations.push({
                replaceOne: {
                    filter: {
                        _id: doc._id
                    },
                    replacement: updatedResourceJsonInternal
                }
            });

            return operations;
        } catch (e) {
            throw new RethrownError(
                {
                    message: `Error processing record ${e.message}`,
                    error: e,
                    args: {
                        resource: doc
                    },
                    source: 'FixWalgreenConsentRunner.processRecordAsync'
                }
            );
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
                for (const key of this.fieldsToUpdate.keys()) {
                    this.collections.push(key);
                }
                this.collections = this.collections.sort();
                if (this.startFromCollection) {
                    this.collections = this.collections.filter(
                        (c) => c >= this.startFromCollection
                    );
                }
            }

            /**
             * @type {import('mongodb').Filter<import('mongodb').Document>}
             */
            const query = this.getQueryForFixCollection();

            /**
             * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
             */
            const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

            const { db, client, session } = await this.createSingeConnectionAsync({
                mongoConfig, collectionName: 'collection'
            });
            const practitionerCollection = db.collection('Practitioner_4_0_0');
            const duplicatePractitionerArray = await this.getDuplicatePractitionerArrayAsync({
                collection: practitionerCollection
            });
            const strCollections = JSON.stringify(this.collections);
            this.adminLogger.logInfo(`Collections ${strCollections}`);
            if (duplicatePractitionerArray.length > 0) {
                await this.createPractitionerSubstitutions(duplicatePractitionerArray);
                try {
                    for (const collectionName of this.collections) {
                        const startFromIdContainer = this.createStartFromIdContainer();
                        this.adminLogger.logInfo(
                            `Fixing duplicate practitioners for the collection: ${collectionName}`
                        );
                       if (!this.fieldsToUpdate.has(collectionName)) {
                            this.adminLogger.logInfo(`Collection ${collectionName} doesn't have any fields needing updating`);
                            continue;
                        }
                        const fields = this.fieldsToUpdate.get(collectionName);
                        for (const field of fields) {
                            // const collection = db.collection(collectionName);

                            this.adminLogger.logInfo(
                                `Fixing duplicate practitioners for the collection: ${collectionName} and field ${field}`
                            );
                            try {
                                const strQuery = JSON.stringify(query);
                                this.adminLogger.logInfo(`query ${strQuery}`);
                                let newQuery = {};
                                const fieldQuery = `${field}._uuid`;
                               if (query.$and) {
                                    newQuery = query.$and.push({ [fieldQuery]: { $in: this.dupUuids } });
                                    this.adminLogger.logInfo(`new query = ${JSON.stringify(newQuery)}`);
                                } else {
                                    this.adminLogger.logInfo(`Field query = ${fieldQuery}`);
                                    this.adminLogger.logInfo(`dup fields count ${this.dupUuids.length}`);
                                    newQuery[fieldQuery] = { $in: this.dupUuids };
                                    // const strNewQuery = JSON.stringify(newQuery);
                                    // this.adminLogger.logInfo(`new query = ${strNewQuery}`);
                                }

                                await this.runForQueryBatchesAsync({
                                    config: mongoConfig,
                                    sourceCollectionName: collectionName,
                                    destinationCollectionName: collectionName,
                                    query: newQuery,
                                    startFromIdContainer,
                                    projection: this.properties ? this.getProjection() : undefined,
                                    fnCreateBulkOperationAsync: async (doc) =>
                                        await this.processResourceAsync({
                                            doc,
                                            collectionName,
                                            field
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
                        }
                        this.adminLogger.logInfo(`Finished processing references for ${collectionName}`);
                    }
                } catch (e) {
                    this.adminLogger.logError(`Error ${e}`);
                } finally {
                    await session.endSession();
                    await client.close();
                }
            }
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e}`);
        }
        this.adminLogger.logInfo('Finished script');
        this.adminLogger.logInfo('Shutting down');
        await this.shutdown();
        this.adminLogger.logInfo('Shutdown finished');
    }
}

module.exports = {
    FixDuplicatePractitionerRunner
};
