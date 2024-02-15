const fs = require('fs');
const {RethrownError} = require('../../utils/rethrownError');
const {ReferenceParser} = require('../../utils/referenceParser');
const {SecurityTagSystem} = require('../../utils/securityTagSystem');
const {compare} = require('fast-json-patch');
const {MongoJsonPatchHelper} = require('../../utils/mongoJsonPatchHelper');
const {ProaPersonPatientLinkageRunner} = require('./proaPersonPatientLinkageRunner');
const {assertTypeEquals} = require('../../utils/assertType');
const {generateUUID} = require('../../utils/uid.util');
const {getCircularReplacer} = require('../../utils/getCircularReplacer');
const {VERSIONS} = require('../../middleware/fhir/utils/constants');
const {ResourceLocatorFactory} = require('../../operations/common/resourceLocatorFactory');
const {IdentifierSystem} = require('../../utils/identifierSystem');

/**
 * @classdesc Linking of Proa Patient with Client Person
 */
class ProaPatientClientPersonLinkRunner extends ProaPersonPatientLinkageRunner {
    /**
     * @typedef {Object} constructorProps
     * @property {Object} args
     * @property {PersonMatchManager} personMatchManager
     * @property {boolean} linkClientPersonToProaPatient
     * @property {string} connectionType
     * @property {boolean} getPersonMatchingScore
     * @property {ResourceLocatorFactory} resourceLocatorFactory
     * @property {string} clientSourceAssigningAuthorities
     *
     * @param {constructorProps}
     */
    constructor({
                    linkClientPersonToProaPatient,
                    getPersonMatchingScore,
                    resourceLocatorFactory,
                    ...args
                }) {
        super(args);
        /**
         * @type {boolean}
         */
        this.linkClientPersonToProaPatient = linkClientPersonToProaPatient;

        /**
         * @type {boolean}
         */
        this.getPersonMatchingScore = getPersonMatchingScore;

        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);

        /**
         * @type {Map<string, { id: string, sourceAssigningAuthority: string }[]>}
         */
        this.proaPersonToProaPatientMap = new Map();

        /**
         * @type {Map<string, {id: string, sourceAssigningAuthority: string, lastUpdated: string}}
         */
        this.personDataMap = new Map();

        /**
         * @type {Set<string>}
         */
        this.processedProaPatients = new Set();

        /**
         * @type {string}
         * Generates a unique uuid that is used for operations
         */
        this.uniqueRequestId = generateUUID();
    }

    /**
     * Populate proaPatientToClientPersonMap & proaPersonToProaPatientMap
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}} mongoConfig
     */
    async getPersonsMapFromProaPatient({mongoConfig}) {
        this.adminLogger.logInfo('Fetching Proa persons from db');
        const collectionName = 'Person_4_0_0';
        /**
         * @type {Object}
         */
        const projection = {id: 1, _uuid: 1, meta: 1, link: 1};
        /**
         * @type {require('mongodb').collection}
         */
        const {collection, session, client} = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName
        });

        try {
            /**
             * @type {import('mongodb').Filter<import('mongodb').Document>}
             */
            const query = {
                'link.target._uuid': {
                    $in: [...this.proaPatientUUIDToIdOwnerMap.keys()].map(
                        (uuid) => `Patient/${uuid}`
                    )
                }
            };

            /**
             * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').Document>>}
             */
            const cursor = collection.find(query, {projection});
            while (await cursor.hasNext()) {
                const resource = await cursor.next();
                if (resource && resource.id) {
                    // check if the current person is a proa person by checking the connectionType
                    const isProaPerson = resource.meta?.security?.find(
                        (item) => item.system === SecurityTagSystem.connectionType && item.code === this.connectionType
                    );
                    const resourceSourceAssigningAuthority = resource.meta?.security?.find(
                        (item) => item.system === SecurityTagSystem.sourceAssigningAuthority
                    )?.code || '';

                    // store person data for csv file
                    this.personDataMap.set(resource._uuid, {
                        id: resource._uuid,
                        sourceAssigningAuthority: resourceSourceAssigningAuthority,
                        lastUpdated: new Date(resource.meta?.lastUpdated).toISOString()
                    });

                    resource.link?.forEach((ref) => {
                        const refTargetUuid = ref?.target?.extension?.find(
                            e => e.url === IdentifierSystem.uuid
                        )?.valueString;
                        const refTargetSourceAssigningAuthority = ref?.target?.extension?.find(
                            e => e.url === SecurityTagSystem.sourceAssigningAuthority
                        )?.valueString;
                        const {
                            id: targetIdWithoutPrefix,
                            resourceType: prefix
                        } = ReferenceParser.parseReference(refTargetUuid);

                        // Check for proa person based on connection type or owner [checking resource type also in this case]
                        if (
                            isProaPerson ||
                            (resourceSourceAssigningAuthority ===
                                this.proaPatientUUIDToIdOwnerMap.get(targetIdWithoutPrefix)?.sourceAssigningAuthority &&
                                (prefix === 'Patient' || ref?.target?.type === 'Patient'))
                        ) {
                            this.personsUuidLinkedToProaPatient.add(resource._uuid);
                            if (!this.proaPersonToProaPatientMap.has(resource._uuid)) {
                                this.proaPersonToProaPatientMap.set(resource._uuid, []);
                            }
                            this.proaPersonToProaPatientMap.get(resource._uuid).push({
                                id: refTargetUuid,
                                sourceAssigningAuthority: refTargetSourceAssigningAuthority
                            });
                        } else if (
                            resource?.meta?.source === 'https://www.icanbwell.com/enterprise-person-service' ||
                            this.clientSourceAssigningAuthorities.includes(resourceSourceAssigningAuthority)
                        ) {
                            if (!this.proaPatientToClientPersonMap.has(refTargetUuid)) {
                                this.proaPatientToClientPersonMap.set(refTargetUuid, []);
                            }
                            this.proaPatientToClientPersonMap.get(refTargetUuid).push(resource._uuid);
                        }
                    });
                }
            }
            this.adminLogger.logInfo('Successfully fetched Proa patients from db');
        } catch (e) {
            throw new RethrownError({
                message: `Error fetching ids & uuids for collection ${collectionName}, ${e.message}`,
                error: e,
                source: 'ProaPatientClientPersonLinkRunner.getPersonsMapFromProaPatient'
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
        /**
         * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
         */
        const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();
        /**
         * @type {require('mongodb').collection}
         */
        const {db, session, client} = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName: 'Person_4_0_0'
        });
        try {
            const operations = [];
            const linkedMasterPatients = [];
            const linkedClientPersons = [];
            const linkedProaPersons = [];
            const linkedMasterPersons = [];
            /**
             * @type {Set<string>}
             */
            const alreadyProcessedProaPatients = new Set();
            for (let i = 0; i < doc.link?.length; i++) {
                const ref = doc.link[parseInt(i)];
                const refTargetUuid = ref?.target?._uuid;
                if (!refTargetUuid) {
                    this.adminLogger.logError(`Invalid reference present in Master person having UUID: ${doc._uuid}`);
                    continue;
                }
                const {id: targetIdWithoutPrefix, resourceType: prefix} = ReferenceParser.parseReference(refTargetUuid);
                let resource;
                try {
                    if (prefix === 'Patient') {
                        resource = await db.collection('Patient_4_0_0').findOne({_uuid: targetIdWithoutPrefix});
                        if (resource?.meta?.security?.find((item) => item.system === SecurityTagSystem.owner)?.code === 'bwell') {
                            linkedMasterPatients.push(targetIdWithoutPrefix);
                        }
                    } else {
                        resource = await db.collection('Person_4_0_0').findOne({_uuid: targetIdWithoutPrefix});
                        this.personDataMap.set(resource._uuid, {
                            id: resource._uuid,
                            sourceAssigningAuthority: resource.meta.security.find(
                                s => s.system === SecurityTagSystem.sourceAssigningAuthority
                            )?.code,
                            lastUpdated: new Date(resource.meta?.lastUpdated).toISOString()
                        });
                        if (resource?.meta?.security?.find((item) => item.system === SecurityTagSystem.owner)?.code === 'bwell') {
                            linkedMasterPersons.push(targetIdWithoutPrefix);
                        } else {
                            // Proa person linked to master person
                            if (this.personsUuidLinkedToProaPatient.has(targetIdWithoutPrefix)) {
                                linkedProaPersons.push(targetIdWithoutPrefix);
                            } else if (
                                resource?.meta?.source === 'https://www.icanbwell.com/enterprise-person-service' ||
                                this.clientSourceAssigningAuthorities.includes(resource._sourceAssigningAuthority)
                            ) {
                                this.clientPerson = resource;
                                // Client person linked to master person
                                linkedClientPersons.push(targetIdWithoutPrefix);
                            }
                        }
                    }
                } catch (e) {
                    throw new RethrownError({
                        message: `Error fetching resource , ${e.message}`,
                        error: e,
                        source: 'ProaPatientClientPersonLinkRunner.processRecordAsync'
                    });
                }
            }

            for (let i = 0; i < linkedProaPersons.length; i++) {
                const proaPatients = this.proaPersonToProaPatientMap.get(linkedProaPersons[parseInt(i)]) ?? [];
                for (let j = 0; j < proaPatients.length; j++) {
                    if (alreadyProcessedProaPatients.has(proaPatients[parseInt(j)].id)) {
                        continue;
                    }
                    alreadyProcessedProaPatients.add(proaPatients[parseInt(j)].id);
                    const {id: proaPatientUUID, sourceAssigningAuthority} = proaPatients[parseInt(j)];
                    const proaPatientUUIDWithoutPrefix = proaPatientUUID.replace('Patient/', '');
                    const proaPatientData = this.proaPatientUUIDToIdOwnerMap.get(proaPatientUUIDWithoutPrefix);
                    const proaPersonData = this.personDataMap.get(linkedProaPersons[`${i}`]);

                    this.processedProaPatients.add(proaPatientUUIDWithoutPrefix);

                    if (linkedProaPersons.length > 1) {
                        this.writeStreamError.write(
                            `${proaPatientUUIDWithoutPrefix.id}| ${proaPatientData.sourceAssigningAuthority}| ${proaPatientData.lastUpdated}| ` +
                            `${proaPersonData.id}| ${proaPersonData.sourceAssigningAuthority}| ${proaPersonData.lastUpdated}| ` +
                            `${doc._uuid}| ${doc._sourceAssigningAuthority}| ${new Date(doc.meta?.lastUpdated).toISOString()}| ` +
                            `Multiple Proa Persons linked to master Person found| ${linkedProaPersons}| \n`
                        );
                    } else if (proaPatients.length > 1) {
                        this.writeStreamError.write(
                            `${proaPatientUUIDWithoutPrefix}| ${proaPatientData.sourceAssigningAuthority}| ${proaPatientData.lastUpdated}| ` +
                            `${proaPersonData.id}| ${proaPersonData.sourceAssigningAuthority}| ${proaPersonData.lastUpdated}| ` +
                            `${doc._uuid}| ${doc._sourceAssigningAuthority}| ${new Date(doc.meta?.lastUpdated).toISOString()}| ` +
                            `Multiple Proa Patients linked to single Proa Person| ${proaPatients.map(p => p.id.replace('Patient/', ''))}| \n`
                        );
                    } else if (doc?.link.find(l => l?.target?._uuid === `Patient/${proaPatientUUID}`)) {
                        this.writeStreamError.write(
                            `${proaPatientUUIDWithoutPrefix}| ${proaPatientData.sourceAssigningAuthority}| ${proaPatientData.lastUpdated}| ` +
                            `${proaPersonData.id}| ${proaPersonData.sourceAssigningAuthority}| ${proaPersonData.lastUpdated}| ` +
                            `${doc._uuid}| ${doc._sourceAssigningAuthority}| ${new Date(doc.meta?.lastUpdated).toISOString()}| ` +
                            `Proa Patient directly linked to master person| ${linkedMasterPersons}| \n`
                        );
                    } else if (linkedMasterPersons.length) {
                        this.writeStreamError.write(
                            `${proaPatientUUIDWithoutPrefix}| ${proaPatientData.sourceAssigningAuthority}| ${proaPatientData.lastUpdated}| ` +
                            `${proaPersonData.id}| ${proaPersonData.sourceAssigningAuthority}| ${proaPersonData.lastUpdated}| ` +
                            `${doc._uuid}| ${doc._sourceAssigningAuthority}| ${new Date(doc.meta?.lastUpdated).toISOString()}| ` +
                            `Master person is linked with other master persons having ids as mentioned| ${linkedMasterPersons}| \n`
                        );
                    } else if (!linkedMasterPatients.length) {
                        this.writeStreamError.write(
                            `${proaPatientUUIDWithoutPrefix}| ${proaPatientData.sourceAssigningAuthority}| ${proaPatientData.lastUpdated}| ` +
                            `${proaPersonData.id}| ${proaPersonData.sourceAssigningAuthority}| ${proaPersonData.lastUpdated}| ` +
                            `${doc._uuid}| ${doc._sourceAssigningAuthority}| ${new Date(doc.meta?.lastUpdated).toISOString()}| ` +
                            `Master person does not have any linked master patient| ${''}| \n`
                        );
                    } else if (linkedMasterPatients.length > 1) {
                        this.writeStreamError.write(
                            `${proaPatientUUIDWithoutPrefix}| ${proaPatientData.sourceAssigningAuthority}| ${proaPatientData.lastUpdated}| ` +
                            `${proaPersonData.id}| ${proaPersonData.sourceAssigningAuthority}| ${proaPersonData.lastUpdated}| ` +
                            `${doc._uuid}| ${doc._sourceAssigningAuthority}| ${new Date(doc.meta?.lastUpdated).toISOString()}| ` +
                            `Master person have multiple linked master patients having ids as mentioned| ${linkedMasterPatients}| \n`
                        );
                    } else if (!linkedClientPersons.length) {
                        this.writeStreamError.write(
                            `${proaPatientUUIDWithoutPrefix}| ${proaPatientData.sourceAssigningAuthority}| ${proaPatientData.lastUpdated}| ` +
                            `${proaPersonData.id}| ${proaPersonData.sourceAssigningAuthority}| ${proaPersonData.lastUpdated}| ` +
                            `${doc._uuid}| ${doc._sourceAssigningAuthority}| ${new Date(doc.meta?.lastUpdated).toISOString()}| ` +
                            `Master person does not have any linked client person| ${''}| \n`
                        );
                    } else if (linkedClientPersons.length > 1) {
                        this.writeStreamError.write(
                            `${proaPatientUUIDWithoutPrefix}| ${proaPatientData.sourceAssigningAuthority}| ${proaPatientData.lastUpdated}| ` +
                            `${proaPersonData.id}| ${proaPersonData.sourceAssigningAuthority}| ${proaPersonData.lastUpdated}| ` +
                            `${doc._uuid}| ${doc._sourceAssigningAuthority}| ${new Date(doc.meta?.lastUpdated).toISOString()}| ` +
                            `Master person have multiple linked client persons having ids as mentioned| ${linkedClientPersons}| \n`
                        );
                    } else if (!this.clientPerson.link) {
                        // Case when nothing is linked to client person, i.e. no client patient also
                        this.writeStreamError.write(
                            `${proaPatientUUIDWithoutPrefix}| ${proaPatientData.sourceAssigningAuthority}| ${proaPatientData.lastUpdated}| ` +
                            `${proaPersonData.id}| ${proaPersonData.sourceAssigningAuthority}| ${proaPersonData.lastUpdated}| ` +
                            `${doc._uuid}| ${doc._sourceAssigningAuthority}| ${new Date(doc.meta?.lastUpdated).toISOString()}| ` +
                            `Client person linked to master person does not have any client patient linked| ${linkedClientPersons[0]}| \n`
                        );
                    } else {
                        const proaPatientClientPersonMatchingScore = await this.getClientPersonToProaPatientMatch({
                            proaPatientUUID, clientPersonUUID: linkedClientPersons[0]
                        });
                        const clientPersonData = this.personDataMap.get(linkedClientPersons[0]);
                        this.writeStream.write(
                            `${proaPatientUUIDWithoutPrefix}| ${proaPatientData.sourceAssigningAuthority}| ${proaPatientData.lastUpdated}| ` +
                            `${proaPersonData.id}| ${proaPersonData.sourceAssigningAuthority}| ${proaPersonData.lastUpdated}| ` +
                            `${doc._uuid}| ${doc._sourceAssigningAuthority}| ${new Date(doc.meta?.lastUpdated).toISOString()}| ` +
                            `${clientPersonData.id}| ${clientPersonData.sourceAssigningAuthority}| ${clientPersonData.lastUpdated}| `
                        );
                        if (this.proaPatientToClientPersonMap.get(proaPatientUUID)?.includes(linkedClientPersons[0])) {
                            this.writeStream.write(
                                `${proaPatientClientPersonMatchingScore}| Already linked| \n`
                            );
                        } else {
                            if (!this.linkClientPersonToProaPatient) {
                                this.writeStream.write(
                                    `${proaPatientClientPersonMatchingScore}| Can be linked| \n`
                                );
                            } else {
                                this.writeStream.write(
                                    `${proaPatientClientPersonMatchingScore}| Linked| \n`
                                );
                                const updatedResource = {
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
                                            'type': 'Patient',
                                            '_sourceAssigningAuthority': sourceAssigningAuthority,
                                            '_uuid': proaPatientUUID,
                                            '_sourceId': proaPatientUUID
                                        }
                                    }
                                };
                                const patches = compare({}, updatedResource);
                                const updateOperation = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({patches});
                                if (Object.keys(updateOperation).length > 0) {
                                    operations.push({
                                        updateOne: {
                                            filter: {
                                                _uuid: linkedClientPersons[0]
                                            },
                                            update: updateOperation
                                        }
                                    });
                                }
                                await this.createHistoryForUpdatedResource('Person', patches, updatedResource);
                            }
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
                    resource: doc
                },
                source: 'ProaPatientClientPersonLinkRunner.processRecordAsync'
            });
        } finally {
            await session.endSession();
            await client.close();
        }
    }

    /**
     * Create History for updated resource
     * @param {string} resourceType
     * @param {MergePatchEntry[]} patches
     * @param {Object} updatedResource
     */
    async createHistoryForUpdatedResource(resourceType, patches, updatedResource) {
        const base_version = VERSIONS['4_0_0'];

        // Append new link in client person class object
        this.clientPerson.link = this.clientPerson.link.concat(updatedResource.link);
        const document = {
            id: this.clientPerson._uuid,
            resource: this.clientPerson,
            request: {
                id: this.uniqueRequestId,
                method: 'PUT',
                url: `/${base_version}/${resourceType}/${this.clientPerson.id}`
            },
            response: patches ?
                {
                    status: '200',
                    outcome:
                        {
                            resourceType: 'OperationOutcome',
                            issue: patches.map(
                                p => ({
                                    severity: 'information',
                                    code: 'informational',
                                    diagnostics: JSON.stringify(p, getCircularReplacer())
                                })
                            )
                        }
                } : null
        };

        /**
         * @type {ResourceLocator}
         */
        const resourceLocator = this.resourceLocatorFactory.createResourceLocator({
            resourceType, base_version
        });
        const historyCollectionName = await resourceLocator.getHistoryCollectionNameAsync(this.clientPerson.resource || this.clientPerson);
        try {
            this.adminLogger.logInfo(`Creating resource for ${historyCollectionName}`);
            /**
             * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
             */
            const historyCollection = await resourceLocator.getOrCreateCollectionAsync(historyCollectionName);

            /**
             * @type {import('mongodb').BulkWriteResult}
             */
            await historyCollection.insertOne(document);
            this.adminLogger.logInfo(`Successfully created history resource for ${historyCollectionName}`);
        } catch (e) {
            throw new RethrownError({
                message: `Error creating history resource for collection ${historyCollectionName}, ${e.message}`,
                error: e,
                source: 'ProaPatientClientPersonLinkRunner.createHistoryForUpdatedResource'
            });
        }
    }

    /**
     * Fetch client person to proa patient matching result value
     * @param {string} patientUuid
     * @param {{ id: string; _uuid: string; }[]} proaPersonInfo
     * @returns {Promise<string>}
     */
    async getClientPersonToProaPatientMatch({proaPatientUUID, clientPersonUUID}) {
        let score = 'N/A';
        if (this.getPersonMatchingScore) {
            try {
                const matchingResult = await this.personMatchManager.personMatchAsync({
                    sourceId: proaPatientUUID,
                    sourceType: 'Patient',
                    targetId: clientPersonUUID,
                    targetType: 'Person'
                });

                score = (matchingResult?.entry && matchingResult?.entry[0]?.search?.score) || 'N/A';
            } catch (e) {
                this.adminLogger.logError(`ERROR: ${e.message}`, {
                    stack: e.stack,
                    sourceId: `Patient/${proaPatientUUID}`,
                    targetId: `Person/${clientPersonUUID}`
                });
            }
        }
        return score;
    }

    /**
     * Initialize write stream
     * @returns {void}
     */
    initializeWriteStream() {
        this.writeStream = fs.createWriteStream('proa_patient_client_person_link_report.csv');
        this.writeStreamError = fs.createWriteStream('proa_patient_client_person_link_report_errors.csv');

        this.writeStream.write(
            'Proa Patient UUID| Proa Patient SourceAssigningAuthority| Proa Patient LastUpdated | ' +
            'Proa Person UUID| Proa Person SourceAssigningAuthority| Proa Person LastUpdated| ' +
            'Proa Master Person UUID| Proa Master Person SourceAssigningAuthority| Proa Master Person LastUpdated| ' +
            'Client Person UUID| Client Person SourceAssigningAuthority| Client Person LastUpdated| ' +
            'Proa Patient - Client Person Matching| Proa Patient-Client Person linking status|\n'
        );
        this.writeStreamError.write(
            'Proa Patient UUID| Proa Patient SourceAssigningAuthority| Proa Patient LastUpdated| ' +
            'Proa Person UUID| Proa Person SourceAssigningAuthority| Proa Person LastUpdated| ' +
            'Master Person UUID| Master Person SourceAssigningAuthority| Master Person LastUpdated| ' +
            'Data Issue| Ids having data issue|\n'
        );
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync() {
        try {
            this.initializeWriteStream();

            /**
             * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
             */
            const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

            try {
                const startFromIdContainer = this.createStartFromIdContainer();
                await this.getProaPatientsIdMap({mongoConfig});
                await this.getPersonsMapFromProaPatient({mongoConfig});

                /**
                 * @type {import('mongodb').Filter<import('mongodb').Document>}
                 */
                const query = {
                    $and: [
                        {
                            'meta.security': {
                                $elemMatch: {
                                    system: SecurityTagSystem.owner,
                                    code: 'bwell'
                                }
                            }
                        },
                        {
                            'link.target._uuid': {
                                $in: [...this.personsUuidLinkedToProaPatient.keys()].map(
                                    (uuid) => `Person/${uuid}`
                                )
                            }
                        }
                    ]
                };

                try {
                    this.adminLogger.logInfo('Fetching Master persons from db');
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
                        useEstimatedCount: false
                    });
                } catch (e) {
                    this.adminLogger.logError(
                        `Got error ${e}.  At ${startFromIdContainer.startFromId}`
                    );
                    throw new RethrownError({
                        message: `Error processing proa person/patient linkage ${e.message}`,
                        error: e,
                        args: {
                            query
                        },
                        source: 'ProaPatientClientPersonLinkRunner.processAsync'
                    });
                }
            } catch (err) {
                this.adminLogger.logError(err.message, {stack: err.stack});
            }

            // Getting Proa Patients without Proa Person
            Array.from(this.proaPatientUUIDToIdOwnerMap.keys()).forEach(patientUUID => {
                if (!this.processedProaPatients.has(patientUUID)) {
                    const proaPatientData = this.proaPatientUUIDToIdOwnerMap.get(patientUUID);
                    this.writeStreamError.write(
                        `${patientUUID}| ${proaPatientData.sourceAssigningAuthority}| ${proaPatientData.lastUpdated}| ` +
                        '| | | | | | Proa Patient without Proa Person Link| | \n'
                    );
                }
            });

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
            this.adminLogger.logError(`ERROR: ${e.message}`, {stack: e.stack});
        }
    }
}

module.exports = {
    ProaPatientClientPersonLinkRunner
};
