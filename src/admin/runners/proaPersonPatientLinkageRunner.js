const fs = require('fs');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { RethrownError } = require('../../utils/rethrownError');
const { ReferenceParser } = require('../../utils/referenceParser');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { PersonMatchManager } = require('../personMatchManager');
const { assertTypeEquals } = require('../../utils/assertType');

/**
 * @classdesc Find person patient linkage for connection type 'proa'
 */
class ProaPersonPatientLinkageRunner extends BaseBulkOperationRunner {
    /**
     * @param {Object} args
     * @param {PersonMatchManager} personMatchManager
     */
    constructor({ personMatchManager, ...args }) {
        super(args);
        /**
         * @type {PersonMatchManager}
         */
        this.personMatchManager = personMatchManager;
        assertTypeEquals(personMatchManager, PersonMatchManager);

        this.writeStream = fs.createWriteStream('proa_person_patient_linkage_report.csv');

        /**
         * @type {Map<string, { id: string, _uuid: string }[]>}
         */
        this.proaPatientToProaPersonMap = new Map();

        /**
         * @type {Map<string, { id: string, _uuid: string, owner: string }[]>}
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
                source: 'ProaPersonPatientLinkageRunner.getProaPatientsIdMap',
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
            /**
             * @type {Resource}
             */
            let resource = FhirResourceCreator.create(doc);
            let isProaPerson = resource.meta?.security?.find(
                (item) => item.system === SecurityTagSystem.connectionType && item.code === 'proa'
            );
            const resourceOwner =
                resource.meta?.security?.find((item) => item.system === SecurityTagSystem.owner)
                    ?.code || '';

            resource.link?.forEach((ref) => {
                this.personsUuidLinkedToProaPatient.add(resource._uuid);
                const refTargetUuid = ref?.target?._uuid;
                const { id: targetIdWithoutPrefix, resourceType: prefix } = ReferenceParser.parseReference(refTargetUuid);

                // Check for proa person based on connection type or owner [checking resource type also in this case]
                if (
                    isProaPerson ||
                    (resourceOwner ===
                        this.proaPatientUUIDToIdOwnerMap.get(targetIdWithoutPrefix)?.owner &&
                        (prefix === 'Patient' || ref?.target?.type === 'Patient'))
                ) {
                    if (!this.proaPatientToProaPersonMap.has(ref.target?._uuid)) {
                        this.proaPatientToProaPersonMap.set(ref.target?._uuid, []);
                    }
                    this.proaPatientToProaPersonMap
                        .get(ref.target?._uuid)
                        .push({ id: resource.id, _uuid: resource._uuid });
                } else {
                    if (!this.proaPatientToClientPersonMap.has(ref.target?._uuid)) {
                        this.proaPatientToClientPersonMap.set(ref.target?._uuid, []);
                    }
                    this.proaPatientToClientPersonMap.get(ref.target?._uuid).push({
                        id: resource.id,
                        _uuid: resource._uuid,
                        owner:
                            resource.meta?.security?.find(
                                (item) => item.system === SecurityTagSystem.owner
                            )?.code || '',
                    });
                }
            });

            return operations;
        } catch (e) {
            throw new RethrownError({
                message: `Error processing record ${e.message}`,
                error: e.stack,
                args: {
                    resource: doc,
                },
                source: 'ProaPersonPatientLinkageRunner.processRecordAsync',
            });
        }
    }

    /**
     * Fetch comma separated master person info
     * @param {Array<{ id: string, _uuid: string, owner: string }>} personInfoList
     * @param {Map<string, { id: string, _uuid: string, owner: string }[]>} personToMasterPersonMap
     * @returns { ids: string, uuids: string, owners: string, matchingResult: string }
     */
    async fetchMasterPersonInfo(personInfoList, personToMasterPersonMap) {
        const clientMasterPersonInfo = await personInfoList.map(async (personInfo) => {
            const masterPersons = personToMasterPersonMap.get(`Person/${personInfo._uuid}`) || [];
            const masterPersonIds = [];
            const masterPersonUuids = [];
            const masterPersonOwners = [];
            const masterPersonMatching = [];

            for (let i = 0; i < masterPersons.length; i++) {
                const masterPerson = masterPersons[i];
                masterPersonIds.push(masterPerson.id);
                masterPersonUuids.push(masterPerson._uuid);
                masterPersonOwners.push(masterPerson.owner);
                const matchingResult = await this.personMatchManager.personMatchAsync({
                    sourceId: personInfo._uuid,
                    sourceType: 'Person',
                    targetId: masterPerson._uuid,
                    targetType: 'Person',
                });
                masterPersonMatching.push(matchingResult?.entry[0]?.search.score);
            }

            const ids = masterPersonIds.join(', ') || 'null';
            const uuids = masterPersonUuids.join(', ') || 'null';
            const owners = masterPersonOwners.join(', ') || 'null';
            const matchingResult = masterPersonMatching.join(', ') || 'null';

            return {
                ids: masterPersons.length > 1 ? `[${ids}]` : ids,
                uuids: masterPersons.length > 1 ? `[${uuids}]` : uuids,
                owners: masterPersons.length > 1 ? `[${owners}]` : owners,
                matchingResult: masterPersons.length > 1 ? `[${matchingResult}]` : matchingResult,
            };
        });

        const ids = clientMasterPersonInfo.map((info) => info.ids).join(', ');
        const uuids = clientMasterPersonInfo.map((info) => info.uuids).join(', ');
        const owners = clientMasterPersonInfo.map((info) => info.owners).join(', ');

        return { ids, uuids, owners };
    }

    /**
     * Fetch person to master person map
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}} mongoConfig
     * @returns {Map<string, { id: string, _uuid: string, owner: string }[]>}
     */
    async getPersonToMasterPersonMap({ mongoConfig }) {
        this.adminLogger.logInfo('Fetching Master persons from db');
        const collectionName = 'Person_4_0_0';
        /**
         * @type {Map<string, { id: string, _uuid: string, owner: string }[]>}
         */
        const personToMasterPersonMap = new Map();

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
                    $in: [...this.personsUuidLinkedToProaPatient.keys()].map(
                        (uuid) => `Person/${uuid}`
                    ),
                },
            };

            /**
             * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').Document>>}
             */
            const cursor = collection.find(query);
            while (await cursor.hasNext()) {
                const doc = await cursor.next();
                if (doc && doc.id) {
                    doc.link?.forEach((ref) => {
                        if (ref?.target?._uuid) {
                            if (!personToMasterPersonMap.has(ref.target._uuid)) {
                                personToMasterPersonMap.set(ref.target._uuid, []);
                            }
                            personToMasterPersonMap.get(ref.target._uuid).push({
                                id: doc.id,
                                _uuid: doc._uuid,
                                owner:
                                    doc.meta?.security?.find(
                                        (item) => item.system === SecurityTagSystem.owner
                                    )?.code || '',
                            });
                        }
                    });
                }
            }
            this.adminLogger.logInfo('Successfully fetched Master persons from db');
        } catch (e) {
            throw new RethrownError({
                message: `Error fetching ids & uuids for collection ${collectionName}, ${e.message}`,
                error: e,
                source: 'ProaPersonPatientLinkageRunner.getPersonToMasterPersonMap',
            });
        } finally {
            await session.endSession();
            await client.close();
        }

        return personToMasterPersonMap;
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
                        source: 'ProaPersonPatientLinkageRunner.processAsync',
                    });
                }
            } catch (err) {
                this.adminLogger.logError(err.message, { stack: err.stack });
            }

            /**
             * @type {Map<string, { id: string, _uuid: string, owner: string }[]>}
             */
            const personToMasterPersonMap = await this.getPersonToMasterPersonMap({ mongoConfig });

            this.adminLogger.logInfo('Started creating CSV file.');
            // Write the CSV content to a file
            this.writeStream.write(
                'Proa Patient ID| Proa Patient UUID| Proa Person ID| Proa Person UUID| Proa Master Person ID| Proa Master Person UUID| Proa Master Person Owner| Proa Person - Master Person Match Percentage| Client Person ID| Client Person UUID| Client Person Owner| Client Master Person ID| Client Master Person UUID| Client Master Person Owner| Proa Patient - Client Person Match Percentage|' +
                    '\n'
            );
            for (const [uuid, otherDetails] of this.proaPatientUUIDToIdOwnerMap.entries()) {
                // Fetch Proa person data
                const proaPersonInfo = this.proaPatientToProaPersonMap.get(`Patient/${uuid}`) || [];
                const proaPersonAppendedIds = proaPersonInfo?.map((obj) => obj.id).join(', ');
                const proaPersonAppendedUuids = proaPersonInfo?.map((obj) => obj._uuid).join(', ');

                // Fetch Proa master person data
                const consolidatedProaMasterPersonInfo = await this.fetchMasterPersonInfo(
                    proaPersonInfo,
                    personToMasterPersonMap
                );

                // Fetch Client person data
                const clientPersonInfo =
                    this.proaPatientToClientPersonMap.get(`Patient/${uuid}`) || [];
                const clientPersonAppendedIds = clientPersonInfo?.map((obj) => obj.id).join(', ');
                const clientPersonAppendedUuids = clientPersonInfo
                    ?.map((obj) => obj._uuid)
                    .join(', ');
                const clientPersonAppendedOwners = clientPersonInfo
                    ?.map((obj) => obj.owner)
                    .join(', ');

                // Fetching proa patient to all linked client persons matching result value
                const matchingScores = [];
                for (const clientPerson of clientPersonInfo) {
                    const matchingResult = await this.personMatchManager.personMatchAsync({
                        sourceId: uuid,
                        sourceType: 'Patient',
                        targetId: clientPerson._uuid,
                        targetType: 'Person',
                    });
                    matchingScores.push(matchingResult?.entry[0]?.search?.score || 'N/A');
                }
                const proaPatientClientPersonMatchingResult = matchingScores.join(', ');

                // Fetch Client master person data
                const consolidatedClientMasterPersonInfo = await this.fetchMasterPersonInfo(
                    clientPersonInfo,
                    personToMasterPersonMap
                );

                this.writeStream.write(
                    `${otherDetails.id}| ${uuid}| ${proaPersonAppendedIds || ''}| ${
                        proaPersonAppendedUuids || ''
                    }| ${consolidatedProaMasterPersonInfo.ids || ''}| ${
                        consolidatedProaMasterPersonInfo.uuids || ''
                    }| ${consolidatedProaMasterPersonInfo.owners || ''}| ${
                        consolidatedProaMasterPersonInfo.matchingResult
                    }| ${clientPersonAppendedIds || ''}| ${clientPersonAppendedUuids || ''}| ${
                        clientPersonAppendedOwners || ''
                    }| ${consolidatedClientMasterPersonInfo.ids || ''}| ${
                        consolidatedClientMasterPersonInfo.uuids || ''
                    }| ${consolidatedClientMasterPersonInfo.owners || ''}| ${
                        proaPatientClientPersonMatchingResult || ''
                    }|` + '\n'
                );
            }

            this.adminLogger.logInfo('CSV file created successfully.');
            this.adminLogger.logInfo('Finished script');
            this.adminLogger.logInfo('Shutting down');
            await this.shutdown();
            this.adminLogger.logInfo('Shutdown finished');

            this.writeStream.close();
            return new Promise((resolve) => this.writeStream.on('close', resolve));
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e.message}`, { stack: e.stack });
        }
    }
}

module.exports = {
    ProaPersonPatientLinkageRunner,
};
