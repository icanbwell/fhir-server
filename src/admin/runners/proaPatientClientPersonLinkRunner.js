const fs = require('fs');
const { RethrownError } = require('../../utils/rethrownError');
const { ReferenceParser } = require('../../utils/referenceParser');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { compare } = require('fast-json-patch');
const { MongoJsonPatchHelper } = require('../../utils/mongoJsonPatchHelper');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { PersonMatchManager } = require('../personMatchManager');
const { assertTypeEquals } = require('../../utils/assertType');

/**
 * @classdesc Linking of Proa Patient with Client Person
 */
class ProaPatientClientPersonLinkRunner extends BaseBulkOperationRunner {
    /**
     * @typedef {Object} constructorProps
     * @property {Object} args
     * @property {PersonMatchManager} personMatchManager
     * @property {boolean} linkClientPersonToProaPatient
     *
     * @param {constructorProps}
     */
    constructor({ personMatchManager, linkClientPersonToProaPatient, ...args }) {
        super(args);
        /**
         * @type {PersonMatchManager}
         */
        this.personMatchManager = personMatchManager;
        assertTypeEquals(personMatchManager, PersonMatchManager);

        this.writeStream = fs.createWriteStream('proa_patient_client_person_link_report.csv');
        this.writeStreamError = fs.createWriteStream('proa_patient_client_person_link_report_errors.csv');

        /**
         * @type {boolean}
         */
        this.linkClientPersonToProaPatient = linkClientPersonToProaPatient;

        /**
         * @type {Map<string, { id: string, sourceAssigningAuthority: string }[]>}
         */
        this.proaPersonToProaPatientMap = new Map();

        /**
         * @type {Map<string, string[]>}
         */
        this.proaPatientToClientPersonMap = new Map();

        /**
         * @type {Set<string>}
         */
        this.personsUuidLinkedToProaPatient = new Set();

        /**
         * @type {Map<string, { id: string, owner: string }>}
         */
        this.proaPatientUUIDToIdOwnerMap = new Map();
    }

    /**
     * Fetch proa patient uuid to id & owner map
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}} mongoConfig
     */
    async getProaPatientsIdMap({ mongoConfig }) {
        this.adminLogger.logInfo('Fetching Proa patients from db');
        const collectionName = 'Patient_4_0_0';
        /**
         * @type {Object}
         */
        let projection = { id: 1, _uuid: 1, meta: 1 };
        /**
         * @type {require('mongodb').collection}
         */
        const { collection, session, client } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName,
        });

        try {
            /**
             * @type {import('mongodb').Filter<import('mongodb').Document>}
             */
            const query = {
                'meta.security': {
                    $elemMatch: {
                        system: SecurityTagSystem.connectionType,
                        code: {
                            $in: ['proa'],
                        },
                    },
                },
            };
            /**
             * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').Document>>}
             */
            const cursor = collection.find(query, { projection });
            while (await cursor.hasNext()) {
                const doc = await cursor.next();
                if (doc && doc.id) {
                    this.proaPatientUUIDToIdOwnerMap.set(doc._uuid, {
                        id: doc.id,
                        owner:
                            doc.meta?.security?.find(
                                (item) => item.system === SecurityTagSystem.owner
                            )?.code || '',
                    });
                }
            }
            this.adminLogger.logInfo('Successfully fetched Proa patients from db');
        } catch (e) {
            throw new RethrownError({
                message: `Error fetching ids & uuids for collection ${collectionName}, ${e.message}`,
                error: e,
                source: 'ProaPatientClientPersonLinkRunner.getProaPatientsIdMap',
            });
        } finally {
            await session.endSession();
            await client.close();
        }
    }

    /**
     * Populate proaPatientToClientPersonMap & proaPersonToProaPatientMap
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}} mongoConfig
     */
    async getPersonsMapFromProaPatient({ mongoConfig }) {
        this.adminLogger.logInfo('Fetching Proa persons from db');
        const collectionName = 'Person_4_0_0';
        /**
         * @type {Object}
         */
        let projection = { id: 1, _uuid: 1, meta: 1, link: 1 };
        /**
         * @type {require('mongodb').collection}
         */
        const { collection, session, client } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName,
        });

        try {
            /**
             * @type {import('mongodb').Filter<import('mongodb').Document>}
             */
            const query = {
                'link.target._uuid': {
                    $in: [...this.proaPatientUUIDToIdOwnerMap.keys()].map(
                        (uuid) => `Patient/${uuid}`
                    ),
                },
            };

            /**
             * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').Document>>}
             */
            const cursor = collection.find(query, { projection });
            while (await cursor.hasNext()) {
                const resource = await cursor.next();
                if (resource && resource.id) {
                    let isProaPerson = resource.meta?.security?.find(
                        (item) => item.system === SecurityTagSystem.connectionType && item.code === 'proa'
                    );
                    const resourceOwner =
                        resource.meta?.security?.find((item) => item.system === SecurityTagSystem.owner)
                            ?.code || '';

                    resource.link?.forEach((ref) => {
                        const refTargetUuid = ref?.target?._uuid;
                        const { id: targetIdWithoutPrefix, resourceType: prefix } = ReferenceParser.parseReference(refTargetUuid);

                        // Check for proa person based on connection type or owner [checking resource type also in this case]
                        if (
                            isProaPerson ||
                            (resourceOwner ===
                                this.proaPatientUUIDToIdOwnerMap.get(targetIdWithoutPrefix)?.owner &&
                                (prefix === 'Patient' || ref?.target?.type === 'Patient'))
                        ) {
                            this.personsUuidLinkedToProaPatient.add(resource._uuid);
                            if (!this.proaPersonToProaPatientMap.has(resource._uuid)) {
                                this.proaPersonToProaPatientMap.set(resource._uuid, []);
                            }
                            this.proaPersonToProaPatientMap
                                .get(resource._uuid)
                                .push({ id: ref?.target?._uuid, sourceAssigningAuthority: ref?.target?._sourceAssigningAuthority });
                        } else {
                            if (!this.proaPatientToClientPersonMap.has(ref.target?._uuid)) {
                                this.proaPatientToClientPersonMap.set(ref.target?._uuid, []);
                            }
                            this.proaPatientToClientPersonMap.get(ref.target?._uuid).push(resource._uuid);
                        }
                    });
                }
            }
            this.adminLogger.logInfo('Successfully fetched Proa patients from db');
        } catch (e) {
            throw new RethrownError({
                message: `Error fetching ids & uuids for collection ${collectionName}, ${e.message}`,
                error: e,
                source: 'ProaPatientClientPersonLinkRunner.getPersonsMapFromProaPatient',
            });
        } finally {
            await session.endSession();
            await client.close();
        }
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').DefaultSchema} doc
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync(doc) {
        try {
            const operations = [];
            const linkedCounts = {
                linkedMasterPatients: [],
                linkedClientPersons: [],
                linkedProaPersons: [],
                linkedMasterPersons: []
            };
            doc.link?.forEach((ref) => {
                const refTargetUuid = ref?.target?._uuid;
                const { id: targetIdWithoutPrefix, resourceType: prefix } = ReferenceParser.parseReference(refTargetUuid);
                if (ref?.target?._sourceAssigningAuthority === 'bwell' && prefix === 'Patient') {
                    linkedCounts.linkedMasterPatients.push(targetIdWithoutPrefix);
                }
                else if (ref?.target?._sourceAssigningAuthority === 'bwell' && prefix === 'Person') {
                    linkedCounts.linkedMasterPersons.push(targetIdWithoutPrefix);
                }
                else if (prefix === 'Person') {
                    // Proa person linked to master person
                    if (this.personsUuidLinkedToProaPatient.has(targetIdWithoutPrefix)) {
                        linkedCounts.linkedProaPersons.push(targetIdWithoutPrefix);
                    } else {
                        // Client person linked to master person
                        linkedCounts.linkedClientPersons.push(targetIdWithoutPrefix);
                    }
                }
            });
            if (linkedCounts.linkedMasterPersons.length) {
                this.writeStreamError.write(`${doc._uuid}| Master person is linked with other master persons having id: ${linkedCounts.linkedMasterPersons}| \n`);
            }
            else if (!linkedCounts.linkedMasterPatients.length) {
                this.writeStreamError.write(`${doc._uuid}| Master person does not have any linked master patient| \n`);
            }
            else if (linkedCounts.linkedMasterPatients.length > 1) {
                this.writeStreamError.write(`${doc._uuid}| Master person have multiple linked master patients: ${linkedCounts.linkedMasterPatients}| \n`);
            }
            else if (!linkedCounts.linkedClientPersons.length) {
                this.writeStreamError.write(`${doc._uuid}| Master person does not have any linked client person| \n`);
            }
            else if (linkedCounts.linkedClientPersons.length > 1) {
                this.writeStreamError.write(`${doc._uuid}| Master person have multiple linked client persons: ${linkedCounts.linkedClientPersons}| \n`);
            }
            else if (linkedCounts.linkedProaPersons.length > 1) {
                this.writeStreamError.write(`${doc._uuid}| Master person have multiple linked proa persons: ${linkedCounts.linkedProaPersons}| \n`);
            }
            else if (this.proaPersonToProaPatientMap.get(linkedCounts.linkedProaPersons[0]).length > 1) {
                this.writeStreamError.write(`${doc._uuid}| Master person have proa person with uuid: ${linkedCounts.linkedProaPersons[0]} which further have multiple linked proa patients of ids: ${this.proaPersonToProaPatientMap.get(linkedCounts.linkedProaPersons[0]).map(obj => obj.id)}| \n`);
            }
            else if (this.proaPersonToProaPatientMap.get(linkedCounts.linkedProaPersons[0]).length === 1) {
                const [{ id: proaPatientUUID, sourceAssigningAuthority }] = this.proaPersonToProaPatientMap.get(linkedCounts.linkedProaPersons[0]);
                const proaPatientUUIDWithoutPrefix = proaPatientUUID.startsWith('Patient/') ? proaPatientUUID.substring('Patient/'.length) : proaPatientUUID;
                const proaPatientClientPersonMatchingScore = await this.getClientPersonToProaPatientMatch({ proaPatientUUID, clientPersonUUID: linkedCounts.linkedClientPersons[0] });
                if (this.proaPatientToClientPersonMap.get(proaPatientUUID)?.includes(linkedCounts.linkedClientPersons[0])) {
                    this.writeStream.write(`${proaPatientUUIDWithoutPrefix}| ${linkedCounts.linkedProaPersons[0]}| ${doc._uuid}| ${linkedCounts.linkedClientPersons[0]}| ${proaPatientClientPersonMatchingScore}| ''| Already linked| \n`);
                }
                else {
                    if (!this.linkClientPersonToProaPatient) {
                        this.writeStream.write(`${proaPatientUUIDWithoutPrefix}| ${linkedCounts.linkedProaPersons[0]}| ${doc._uuid}| ${linkedCounts.linkedClientPersons[0]}| ${proaPatientClientPersonMatchingScore}| Can be linked| ''| \n`);
                    }
                    else {
                        this.writeStream.write(`${proaPatientUUIDWithoutPrefix}| ${linkedCounts.linkedProaPersons[0]}| ${doc._uuid}| ${linkedCounts.linkedClientPersons[0]}| ${proaPatientClientPersonMatchingScore}| Linked| ''| \n`);
                        let updatedResource = {
                            'link': {
                                'target': {
                                    'extension': [
                                        {
                                            'id': 'sourceId',
                                            'url': 'https://www.icanbwell.com/sourceId',
                                            'valueString': proaPatientUUID
                                        },
                                        {
                                            'id': 'uuid',
                                            'url': 'https://www.icanbwell.com/uuid',
                                            'valueString': proaPatientUUID
                                        },
                                        {
                                            'id': 'sourceAssigningAuthority',
                                            'url': 'https://www.icanbwell.com/sourceAssigningAuthority',
                                            'valueString': sourceAssigningAuthority
                                        }
                                    ],
                                    'reference': `${proaPatientUUID}|${sourceAssigningAuthority}`,
                                    '_sourceAssigningAuthority': sourceAssigningAuthority,
                                    '_uuid': proaPatientUUID,
                                    '_sourceId': proaPatientUUID
                                }
                            }
                        };
                        const patches = compare({}, updatedResource);
                        const updateOperation = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({ patches });
                        if (Object.keys(updateOperation).length > 0) {
                            operations.push({
                                updateOne: {
                                    filter: {
                                        _uuid: linkedCounts.linkedClientPersons[0],
                                    },
                                    update: updateOperation,
                                },
                            });
                        }
                    }
                }
            }
            return operations;
        } catch (e) {
            throw new RethrownError({
                message: `Error processing record ${e.message}`,
                error: e.stack,
                args: {
                    resource: doc,
                },
                source: 'ProaPatientClientPersonLinkRunner.processRecordAsync',
            });
        }
    }

    /**
     * Fetch client person to proa patient matching result value
     * @param {string} patientUuid
     * @param {{ id: string; _uuid: string; }[]} proaPersonInfo
     * @returns {string}
     */
    async getClientPersonToProaPatientMatch({ proaPatientUUID, clientPersonUUID }) {
        let score = 'N/A';
        try {
            const matchingResult = await this.personMatchManager.personMatchAsync({
                sourceId: proaPatientUUID,
                sourceType: 'Patient',
                targetId: clientPersonUUID,
                targetType: 'Person',
            });

            score = (matchingResult?.entry && matchingResult?.entry[0]?.search?.score) || 'N/A';
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e.message}`, {
                stack: e.stack,
                sourceId: `Patient/${proaPatientUUID}`,
                targetId: `Person/${clientPersonUUID}`,
            });
        }
        return score;
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync() {
        // noinspection JSValidateTypes
        try {
            await this.init();

            /**
             * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
             */
            const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

            try {
                const startFromIdContainer = this.createStartFromIdContainer();
                await this.getProaPatientsIdMap({ mongoConfig });
                await this.getPersonsMapFromProaPatient({ mongoConfig });
                this.writeStream.write(
                    'Proa Patient UUID| Proa Person UUID| Proa Master Person UUID| Client Person UUID| Proa Patient - Client Person Matching| Linked/Can be linked| Already linked|' +
                        '\n'
                );
                this.writeStreamError.write(
                    'Master Person UUID| Data Issue|' +
                    '\n'
                );
                /**
                 * @type {import('mongodb').Filter<import('mongodb').Document>}
                 */
                const query = {
                    $and: [
                        {
                            'meta.security': {
                                $elemMatch: {
                                    system: SecurityTagSystem.owner,
                                    code: 'bwell',
                                },
                            },
                        },
                        {
                            'link.target._uuid': {
                                $in: [...this.personsUuidLinkedToProaPatient.keys()].map(
                                    (uuid) => `Person/${uuid}`
                                ),
                            },
                        },
                    ],
                };

                try {
                    await this.runForQueryBatchesAsync({
                        config: mongoConfig,
                        sourceCollectionName: 'Person_4_0_0',
                        destinationCollectionName: 'Person_4_0_0',
                        query,
                        startFromIdContainer,
                        fnCreateBulkOperationAsync: async (doc) =>
                            await this.processRecordAsync(doc),
                        ordered: false,
                        batchSize: this.batchSize,
                        skipExistingIds: false,
                        limit: this.limit,
                        useTransaction: this.useTransaction,
                        skip: this.skip,
                        useEstimatedCount: false,
                    });
                } catch (e) {
                    this.adminLogger.logError(
                        `Got error ${e}.  At ${startFromIdContainer.startFromId}`
                    );
                    throw new RethrownError({
                        message: `Error processing proa person/patient linkage ${e.message}`,
                        error: e,
                        args: {
                            query,
                        },
                        source: 'ProaPatientClientPersonLinkRunner.processAsync',
                    });
                }
            } catch (err) {
                this.adminLogger.logError(err.message, { stack: err.stack });
            }

            this.adminLogger.logInfo('Finished script');
            this.adminLogger.logInfo('Shutting down');
            await this.shutdown();
            this.adminLogger.logInfo('Shutdown finished');

            this.writeStream.close();
            this.writeStreamError.close();
            return Promise.all([
                new Promise((resolve) => this.writeStream.on('close', resolve)),
                new Promise((resolve) => this.writeStreamError.on('close', resolve))
            ]);
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e.message}`, { stack: e.stack });
        }
    }
}

module.exports = {
    ProaPatientClientPersonLinkRunner,
};
