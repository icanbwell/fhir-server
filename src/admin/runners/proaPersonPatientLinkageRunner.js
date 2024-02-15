const fs = require('fs');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { RethrownError } = require('../../utils/rethrownError');
const { ReferenceParser } = require('../../utils/referenceParser');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { PersonMatchManager } = require('../personMatchManager');
const { assertTypeEquals } = require('../../utils/assertType');

/**
 * @classdesc Find person patient linkage for the specified connection type
 */
class ProaPersonPatientLinkageRunner extends BaseBulkOperationRunner {
    /**
     * @typedef {Object} constructorProps
     * @property {Object} args
     * @property {PersonMatchManager} personMatchManager
     * @property {boolean} patientPersonMatching
     * @property {string} connectionType
     * @property {string[]} clientSourceAssigningAuthorities
     *
     * @param {constructorProps}
     */
    constructor({
        personMatchManager,
        patientPersonMatching,
        clientSourceAssigningAuthorities,
        connectionType,
        ...args
    }) {
        super(args);
        /**
         * @type {PersonMatchManager}
         */
        this.personMatchManager = personMatchManager;
        assertTypeEquals(personMatchManager, PersonMatchManager);

        /**
         * @type {boolean}
         */
        this.patientPersonMatching = patientPersonMatching;

        /**
         * @type {string[]}
         */
        this.clientSourceAssigningAuthorities = clientSourceAssigningAuthorities;

        /**
         * @type {string}
         */
        this.connectionType = connectionType;

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
         * @type {Map<string, { id: string, owner: string, sourceAssigningAuthority: string }>}
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
        const projection = { id: 1, _uuid: 1, meta: 1 };
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
                        code: this.connectionType,
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
                        sourceAssigningAuthority:
                            doc.meta?.security?.find(
                                (item) => item.system === SecurityTagSystem.sourceAssigningAuthority
                            )?.code || '',
                        lastUpdated: new Date(doc.meta.lastUpdated).toISOString(),
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
            const resource = FhirResourceCreator.create(doc);
            const isProaPerson = resource.meta?.security?.find(
                (item) =>
                    item.system === SecurityTagSystem.connectionType &&
                    item.code === this.connectionType
            );
            const resourceSourceAssigningAuthority =
                resource.meta?.security?.find(
                    (item) => item.system === SecurityTagSystem.sourceAssigningAuthority
                )?.code || '';

            resource.link?.forEach((ref) => {
                this.personsUuidLinkedToProaPatient.add(resource._uuid);
                const refTargetUuid = ref?.target?._uuid;
                const {
                    id: targetIdWithoutPrefix, resourceType: prefix
                } = ReferenceParser.parseReference(refTargetUuid);

                // Check for proa person based on connection type or owner [checking resource type also in this case]
                if (
                    isProaPerson ||
                    (resourceSourceAssigningAuthority ===
                        this.proaPatientUUIDToIdOwnerMap.get(targetIdWithoutPrefix)
                            ?.sourceAssigningAuthority &&
                        (prefix === 'Patient' || ref?.target?.type === 'Patient'))
                ) {
                    if (!this.proaPatientToProaPersonMap.has(ref.target?._uuid)) {
                        this.proaPatientToProaPersonMap.set(ref.target?._uuid, []);
                    }
                    this.proaPatientToProaPersonMap.get(ref.target?._uuid).push({
                        id: resource.id,
                        _uuid: resource._uuid,
                        _sourceAssigningAuthority: resourceSourceAssigningAuthority,
                        lastUpdated: new Date(resource.meta?.lastUpdated).toISOString(),
                    });
                } else if (
                    resource?.meta?.source === 'https://www.icanbwell.com/enterprise-person-service' ||
                    this.clientSourceAssigningAuthorities.includes(resourceSourceAssigningAuthority)
                ) {
                    if (!this.proaPatientToClientPersonMap.has(ref.target?._uuid)) {
                        this.proaPatientToClientPersonMap.set(ref.target?._uuid, []);
                    }
                    this.proaPatientToClientPersonMap.get(ref.target?._uuid).push({
                        id: resource.id,
                        _uuid: resource._uuid,
                        _sourceAssigningAuthority: resourceSourceAssigningAuthority,
                        lastUpdated: new Date(resource.meta?.lastUpdated).toISOString(),
                    });
                } else {
                    console.log(resource, 'InvalidPerson');
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
     * @returns {Promise<ids: string, uuids: string, owners: string, matchingResult: string>}
     */
    async fetchMasterPersonInfo(personInfoList, personToMasterPersonMap) {
        const clientMasterPersonInfo = [];
        for (const personInfo of personInfoList) {
            const masterPersons = personToMasterPersonMap.get(`Person/${personInfo._uuid}`) || [];
            const masterPersonIds = [];
            const masterPersonUuids = [];
            const masterPersonSourceAssigningAuthorities = [];
            const masterPersonLastUpdated = [];
            const masterPersonMatching = [];

            for (let i = 0; i < masterPersons.length; i++) {
                const masterPerson = masterPersons[parseInt(i)];
                masterPersonIds.push(masterPerson.id);
                masterPersonUuids.push(masterPerson._uuid);
                masterPersonSourceAssigningAuthorities.push(masterPerson._sourceAssigningAuthority);
                masterPersonLastUpdated.push(masterPerson.lastUpdated);
                if (this.patientPersonMatching) {
                    try {
                        const matchingResult = await this.personMatchManager.personMatchAsync({
                            sourceId: personInfo._uuid,
                            sourceType: 'Person',
                            targetId: masterPerson._uuid,
                            targetType: 'Person',
                        });
                        masterPersonMatching.push(
                            (matchingResult?.entry && matchingResult?.entry[0]?.search?.score) ||
                                'N/A'
                        );
                    } catch (e) {
                        this.adminLogger.logError(`ERROR: ${e.message}`, {
                            stack: e.stack,
                            sourceId: `Person/${personInfo._uuid}`,
                            targetId: `Person/${masterPerson._uuid}`,
                        });
                        masterPersonMatching.push('N/A');
                    }
                }
            }

            const ids = masterPersonIds.join(', ') || 'null';
            const uuids = masterPersonUuids.join(', ') || 'null';
            const sourceAssigningAuthorities = masterPersonSourceAssigningAuthorities.join(', ') || 'null';
            const lastUpdated = masterPersonLastUpdated.join(', ') || 'null';
            const matchingResult = masterPersonMatching.join(', ') || 'null';

            clientMasterPersonInfo.push({
                ids: masterPersons.length > 1 ? `[${ids}]` : ids,
                uuids: masterPersons.length > 1 ? `[${uuids}]` : uuids,
                sourceAssigningAuthorities: masterPersons.length > 1 ? `[${sourceAssigningAuthorities}]` : sourceAssigningAuthorities,
                lastUpdated: masterPersons.length > 1 ? `[${lastUpdated}]` : lastUpdated,
                matchingResult: masterPersons.length > 1 ? `[${matchingResult}]` : matchingResult,
            });
        }

        const masterPersonIds = clientMasterPersonInfo.map((info) => info.ids).join(', ');
        const masterPersonUuids = clientMasterPersonInfo.map((info) => info.uuids).join(', ');
        const masterPersonSourceAssigningAuthorities = clientMasterPersonInfo.map((info) => info.sourceAssigningAuthorities).join(', ');
        const masterPersonLastUpdated = clientMasterPersonInfo.map((info) => info.lastUpdated).join(', ');
        const masterPersonMatching = clientMasterPersonInfo.map((info) => info.matchingResult).join(', ');

        return {
            masterPersonIds,
            masterPersonUuids,
            masterPersonSourceAssigningAuthorities,
            masterPersonLastUpdated,
            masterPersonMatching,
        };
    }

    /**
     * Fetch person to master person map
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}} mongoConfig
     * @returns {Promise<Map<string, { id: string, _uuid: string, owner: string }[]>>}
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
                                _sourceAssigningAuthority: doc.meta?.security?.find(
                                    (item) => item.system === SecurityTagSystem.sourceAssigningAuthority
                                )?.code || '',
                                lastUpdated: new Date(doc.meta?.lastUpdated).toISOString(),
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
     * Fetch proa patient to all linked person-matching result value
     * @param {string} patientUuid
     * @param {{ id: string; _uuid: string; }[]} proaPersonInfo
     * @returns {Promise<string>}
     */
    async getProaPatientToPersonMatch(patientUuid, personInfo) {
        const proaPersonMatchingScores = [];
        for (const person of personInfo) {
            try {
                const matchingResult = await this.personMatchManager.personMatchAsync({
                    sourceId: patientUuid,
                    sourceType: 'Patient',
                    targetId: person._uuid,
                    targetType: 'Person',
                });

                proaPersonMatchingScores.push(
                    (matchingResult?.entry && matchingResult?.entry[0]?.search?.score) || 'N/A'
                );
            } catch (e) {
                this.adminLogger.logError(`ERROR: ${e.message}`, {
                    stack: e.stack,
                    sourceId: `Patient/${patientUuid}`,
                    targetId: `Person/${person._uuid}`,
                });
                proaPersonMatchingScores.push('N/A');
            }
        }
        return proaPersonMatchingScores.join(', ');
    }

    /**
     * Initialize write stream
     * @returns {void}
     */
    initializeWriteStream() {
        this.writeStream = fs.createWriteStream('proa_person_patient_linkage_report.csv');

        // Write the CSV content to a file
        if (this.patientPersonMatching) {
            this.writeStream.write(
                'Proa Patient ID| Proa Patient UUID| Proa Patient SourceAssigningAuthority| Proa Patient LastUpdated| ' +
                'Proa Person ID| Proa Person UUID| Proa Person SourceAssigningAuthority| Proa Person LastUpdated| ' +
                'Proa Patient - Proa Person Match Percentage| ' +
                'Proa Master Person ID| Proa Master Person UUID| Proa Master Person SourceAssigningAuthority| Proa Master Person LastUpdated| ' +
                'Proa Person - Proa Master Person Matching| ' +
                'Client Person ID| Client Person UUID| Client Person SourceAssigningAuthority| Client Person LastUpdated| ' +
                'Client Master Person ID| Client Master Person UUID| Client Master Person SourceAssigningAuthority| Client Master Person LastUpdated| ' +
                'Proa Patient - Client Person Matching|\n'
            );
        } else {
            this.writeStream.write(
                'Proa Patient ID| Proa Patient UUID| Proa Patient SourceAssigningAuthority| Proa Patient LastUpdated| ' +
                'Proa Person ID| Proa Person UUID| Proa Person SourceAssigningAuthority| Proa Person LastUpdated| ' +
                'Proa Master Person ID| Proa Master Person UUID| Proa Master Person SourceAssigningAuthority| Proa Master Person LastUpdated| ' +
                'Client Person ID| Client Person UUID| Client Person SourceAssigningAuthority| Client Person LastUpdated| ' +
                'Client Master Person ID| Client Master Person UUID| Client Master Person SourceAssigningAuthority| Client Master Person LastUpdated|\n'
            );
        }
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync() {
        try {
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

            await this.createCSV();

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

    /**
     * Creates CSV file with the data fetched from db
     * @returns {Promise<void>}
     */
    async createCSV() {
        /**
         * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
         */
        const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

        this.initializeWriteStream();
        /**
         * @type {Map<string, { id: string, _uuid: string, owner: string }[]>}
         */
        const personToMasterPersonMap = await this.getPersonToMasterPersonMap({ mongoConfig });
        this.adminLogger.logInfo('Started creating CSV file.');

        for (const [uuid, proaPatientData] of this.proaPatientUUIDToIdOwnerMap.entries()) {
            // Fetch Proa person data
            const proaPersonInfo = this.proaPatientToProaPersonMap.get(`Patient/${uuid}`) || [];
            const proaPersonAppendedIds = proaPersonInfo.map((obj) => obj.id).join(', ') || '';
            const proaPersonAppendedUuids = proaPersonInfo.map((obj) => obj._uuid).join(', ') || '';
            const proaPersonAppendedSourceAssigningAuthorities = proaPersonInfo.map((obj) => obj._sourceAssigningAuthority).join(', ') || '';
            const proaPersonAppendedLastUpdated = proaPersonInfo.map((obj) => obj.lastUpdated).join(', ') || '';
            // Fetch Proa master person data
            const {
                masterPersonIds,
                masterPersonUuids,
                masterPersonSourceAssigningAuthorities,
                masterPersonLastUpdated,
                masterPersonMatching,
            } = await this.fetchMasterPersonInfo(
                proaPersonInfo,
                personToMasterPersonMap
            );

            // Fetch Client person data
            const clientPersonInfo = this.proaPatientToClientPersonMap.get(`Patient/${uuid}`) || [];
            const clientPersonAppendedIds = clientPersonInfo.map((obj) => obj.id).join(', ');
            const clientPersonAppendedUuids = clientPersonInfo.map((obj) => obj._uuid).join(', ');
            const clientPersonAppendedSourceAssigningAuthorities = clientPersonInfo.map((obj) => obj._sourceAssigningAuthority).join(', ') || '';
            const clientPersonAppendedLastUpdated = clientPersonInfo.map((obj) => obj.lastUpdated).join(', ') || '';

            // Fetch Client master person data
            const {
                masterPersonIds: clientMasterPersonIds,
                masterPersonUuids: clientMasterPersonUuids,
                masterPersonSourceAssigningAuthorities: clientMasterPersonSourceAssigningAuthorities,
                masterPersonLastUpdated: clientMasterPersonLastUpdated,
            } = await this.fetchMasterPersonInfo(
                clientPersonInfo,
                personToMasterPersonMap
            );

            if (this.patientPersonMatching) {
                // Fetching proa patient to all linked proa persons matching result value
                const proaPatientProaPersonMatchingResult = await this.getProaPatientToPersonMatch(
                    uuid,
                    proaPersonInfo
                );
                // Fetching proa patient to all linked client persons matching result value
                const proaPatientClientPersonMatchingResult = await this.getProaPatientToPersonMatch(uuid, clientPersonInfo);

                this.writeStream.write(
                    `${proaPatientData.id}| ${uuid}| ${proaPatientData.sourceAssigningAuthority}| ${proaPatientData.lastUpdated}| ` +
                    `${proaPersonAppendedIds}| ${proaPersonAppendedUuids}| ${proaPersonAppendedSourceAssigningAuthorities}| ${proaPersonAppendedLastUpdated}| ` +
                    `${proaPatientProaPersonMatchingResult || ''}| ` +
                    `${masterPersonIds}| ${masterPersonUuids}| ${masterPersonSourceAssigningAuthorities}| ${masterPersonLastUpdated}| ` +
                    `${masterPersonMatching}| ` +
                    `${clientPersonAppendedIds}| ${clientPersonAppendedUuids}| ${clientPersonAppendedSourceAssigningAuthorities}| ${clientPersonAppendedLastUpdated}| ` +
                    `${clientMasterPersonIds}| ${clientMasterPersonUuids}| ${clientMasterPersonSourceAssigningAuthorities}| ${clientMasterPersonLastUpdated}| ` +
                    `${proaPatientClientPersonMatchingResult || ''}|\n`
                );
            } else {
                this.writeStream.write(
                    `${proaPatientData.id}| ${uuid}| ${proaPatientData.sourceAssigningAuthority}| ${proaPatientData.lastUpdated}| ` +
                    `${proaPersonAppendedIds}| ${proaPersonAppendedUuids}| ${proaPersonAppendedSourceAssigningAuthorities}| ${proaPersonAppendedLastUpdated}| ` +
                    `${masterPersonIds}| ${masterPersonUuids}| ${masterPersonSourceAssigningAuthorities}| ${masterPersonLastUpdated}| ` +
                    `${clientPersonAppendedIds}| ${clientPersonAppendedUuids}| ${clientPersonAppendedSourceAssigningAuthorities}| ${clientPersonAppendedLastUpdated}| ` +
                    `${clientMasterPersonIds}| ${clientMasterPersonUuids}| ${clientMasterPersonSourceAssigningAuthorities}| ${clientMasterPersonLastUpdated}|\n`
                );
            }
        }
        this.adminLogger.logInfo('CSV file created successfully.');
    }
}

module.exports = {
    ProaPersonPatientLinkageRunner,
};
