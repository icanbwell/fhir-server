const fs = require('fs');
const { RethrownError } = require('../../utils/rethrownError');
const { ReferenceParser } = require('../../utils/referenceParser');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { assertTypeEquals } = require('../../utils/assertType');
const { generateUUID } = require('../../utils/uid.util');
const { VERSIONS } = require('../../middleware/fhir/utils/constants');
const Person = require('../../fhir/classes/4_0_0/resources/person');
const { DatabaseUpdateFactory } = require('../../dataLayer/databaseUpdateFactory');

/**
 * @classdesc Delink proa patient from proa person, proa person from master person & removing proa person
 */
class DelinkProaPersonPatientRunner extends BaseBulkOperationRunner {
    /**
     * @typedef {Object} constructorProps
     * @property {Object} args
     * @property {boolean} delinkRemoveProaPerson
     * @property {string} connectionType
     * @property {DatabaseUpdateFactory} databaseUpdateFactory
     *
     * @param {constructorProps}
     */
    constructor ({ delinkRemoveProaPerson, connectionType, databaseUpdateFactory, ...args }) {
        super(args);

        this.writeStream = fs.createWriteStream('proa_person_removal_delinking_report.csv');
        this.writeStreamError = fs.createWriteStream(
            'proa_person_removal_delinking_report_errors.csv'
        );

        /**
         * @type {boolean}
         */
        this.delinkRemoveProaPerson = delinkRemoveProaPerson;

        /**
         * @type {string}
         */
        this.connectionType = connectionType;

        /**
         * @type {DatabaseUpdateFactory}
         */
        this.databaseUpdateFactory = databaseUpdateFactory;
        assertTypeEquals(databaseUpdateFactory, DatabaseUpdateFactory);

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
         * @type {Map<string, { id: string, sourceAssigningAuthority: string }>}
         */
        this.proaPatientUUIDToIdSourceMap = new Map();

        /**
         * @type {string}
         * Generates a unique uuid that is used for operations
         */
        this.uniqueRequestId = generateUUID();
    }

    /**
     * Fetch proa patient uuid to id & owner map
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}} mongoConfig
     */
    async getProaPatientsIdMap ({ mongoConfig }) {
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
            collectionName
        });

        try {
            /**
             * @type {import('mongodb').Filter<import('mongodb').Document>}
             */
            const query = {
                'meta.security': {
                    $elemMatch: {
                        system: SecurityTagSystem.connectionType,
                        code: this.connectionType
                    }
                }
            };
            /**
             * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').Document>>}
             */
            const cursor = collection.find(query, { projection });
            while (await cursor.hasNext()) {
                const doc = await cursor.next();
                if (doc && doc.id) {
                    this.proaPatientUUIDToIdSourceMap.set(doc._uuid, {
                        id: doc.id,
                        sourceAssigningAuthority:
                            doc.meta?.security?.find(
                                (item) => item.system === SecurityTagSystem.sourceAssigningAuthority
                            )?.code || ''
                    });
                }
            }
            this.adminLogger.logInfo('Successfully fetched Proa patients from db');
        } catch (e) {
            throw new RethrownError({
                message: `Error fetching ids & uuids for collection ${collectionName}, ${e.message}`,
                error: e,
                source: 'DelinkProaPersonPatientRunner.getProaPatientsIdMap'
            });
        } finally {
            await session.endSession();
            await client.close();
        }
    }

    /**
     * Populate proaPatientToClientPersonMap & proaPersonToProaPatientMap
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}} mongoConfig
     * @param {string} collectionName
     */
    async getPersonsMapFromProaPatient ({ mongoConfig, collectionName }) {
        this.adminLogger.logInfo('Fetching Proa persons from db');
        /**
         * @type {Object}
         */
        const projection = { id: 1, _uuid: 1, meta: 1, link: 1 };
        /**
         * @type {require('mongodb').collection}
         */
        const { collection, session, client } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName
        });

        try {
            /**
             * @type {import('mongodb').Filter<import('mongodb').Document>}
             */
            const query = {
                'link.target._uuid': {
                    $in: [...this.proaPatientUUIDToIdSourceMap.keys()].map(
                        (uuid) => `Patient/${uuid}`
                    )
                }
            };

            /**
             * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').Document>>}
             */
            const cursor = collection.find(query, { projection });
            while (await cursor.hasNext()) {
                const resource = await cursor.next();
                if (resource && resource.id) {
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
                        const refTargetUuid = ref?.target?._uuid;
                        const { id: targetIdWithoutPrefix, resourceType: prefix } =
                            ReferenceParser.parseReference(refTargetUuid);

                        // Check that linked reference is a patient
                        if (prefix === 'Patient' || ref?.target?.type === 'Patient') {
                            // Check for proa person based on connection type or owner [checking resource type also in this case]
                            if (
                                isProaPerson ||
                                resourceSourceAssigningAuthority ===
                                    this.proaPatientUUIDToIdSourceMap.get(targetIdWithoutPrefix)
                                        ?.sourceAssigningAuthority
                            ) {
                                this.personsUuidLinkedToProaPatient.add(resource._uuid);
                                if (!this.proaPersonToProaPatientMap.has(resource._uuid)) {
                                    this.proaPersonToProaPatientMap.set(resource._uuid, []);
                                }
                                this.proaPersonToProaPatientMap.get(resource._uuid).push({
                                    id: ref?.target?._uuid,
                                    sourceAssigningAuthority:
                                        ref?.target?._sourceAssigningAuthority
                                });
                            } else if (
                                resource?.meta?.source ===
                                'https://www.icanbwell.com/enterprise-person-service'
                            ) {
                                if (!this.proaPatientToClientPersonMap.has(ref.target?._uuid)) {
                                    this.proaPatientToClientPersonMap.set(ref.target?._uuid, []);
                                }
                                this.proaPatientToClientPersonMap
                                    .get(ref.target?._uuid)
                                    .push(resource._uuid);
                            }
                        }
                    });
                }
            }
            this.adminLogger.logInfo('Successfully fetched Proa persons from db');
        } catch (e) {
            throw new RethrownError({
                message: `Error fetching ids & uuids for collection ${collectionName}, ${e.message}`,
                error: e,
                source: 'DelinkProaPersonPatientRunner.getPersonsMapFromProaPatient'
            });
        } finally {
            await session.endSession();
            await client.close();
        }
    }

    /**
     * Processes each document of master person
     * @param {import('mongodb').DefaultSchema} doc
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}} mongoConfig
     * @param {string} collectionName
     * @returns {Promise<(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    async processRecordAsync (doc, mongoConfig, collectionName) {
        /**
         * @type {require('mongodb').collection}
         */
        const { db, session, client } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName
        });
        /**
         * @type {Map<string, Resource>}
         */
        this.proaPersonUUIDToResourceMap = new Map();
        try {
            const linkedCounts = {
                linkedMasterPatients: [],
                linkedClientPersons: [],
                linkedProaPersons: [],
                linkedMasterPersons: []
            };
            for (let i = 0; i < doc.link?.length; i++) {
                const ref = doc.link[parseInt(i)];
                const refTargetUuid = ref?.target?._uuid;
                if (!refTargetUuid) {
                    this.adminLogger.logError(
                        `Invalid reference present in Master person having UUID: ${doc._uuid}`
                    );
                    continue;
                }
                const { id: targetIdWithoutPrefix, resourceType: prefix } =
                    ReferenceParser.parseReference(refTargetUuid);

                let resource;
                try {
                    if (prefix === 'Patient') {
                        resource = await db
                            .collection('Patient_4_0_0')
                            .findOne({ _uuid: targetIdWithoutPrefix });
                        if (
                            resource?.meta?.security?.find(
                                (item) => item.system === SecurityTagSystem.owner
                            )?.code === 'bwell'
                        ) {
                            linkedCounts.linkedMasterPatients.push(targetIdWithoutPrefix);
                        }
                    } else {
                        resource = await db
                            .collection(collectionName)
                            .findOne({ _uuid: targetIdWithoutPrefix });
                        if (
                            resource?.meta?.security?.find(
                                (item) => item.system === SecurityTagSystem.owner
                            )?.code === 'bwell'
                        ) {
                            linkedCounts.linkedMasterPersons.push(targetIdWithoutPrefix);
                        } else {
                            // Proa person linked to master person
                            if (this.personsUuidLinkedToProaPatient.has(targetIdWithoutPrefix)) {
                                linkedCounts.linkedProaPersons.push(targetIdWithoutPrefix);
                                if (!this.proaPersonUUIDToResourceMap.has(targetIdWithoutPrefix)) {
                                    this.proaPersonUUIDToResourceMap.set(
                                        targetIdWithoutPrefix,
                                        resource
                                    );
                                }
                            } else if (
                                resource?.meta?.source ===
                                'https://www.icanbwell.com/enterprise-person-service'
                            ) {
                                // Client person linked to master person
                                linkedCounts.linkedClientPersons.push(targetIdWithoutPrefix);
                            }
                        }
                    }
                } catch (e) {
                    throw new RethrownError({
                        message: `Error fetching resource , ${e.message}`,
                        error: e,
                        source: 'DelinkProaPersonPatientRunner.processRecordAsync'
                    });
                }
            }
            /**
             * @type {Set<string>}
             */
            const proaPersonIdsToRemove = new Set();
            for (let i = 0; i < linkedCounts.linkedProaPersons.length; i++) {
                const proaPatients =
                    this.proaPersonToProaPatientMap.get(
                        linkedCounts.linkedProaPersons[parseInt(i)]
                    ) ?? [];
                /**
                 * @type {Set<string>}
                 */
                const delinkProaPatientIds = new Set();
                for (let j = 0; j < proaPatients.length; j++) {
                    const { id: proaPatientUUID } = proaPatients[parseInt(j)];
                    const proaPatientUUIDWithoutPrefix = proaPatientUUID?.startsWith('Patient/') ? proaPatientUUID.substring('Patient/'.length) : proaPatientUUID;
                    if (linkedCounts.linkedMasterPersons.length) {
                        this.writeStreamError.write(
                            `${proaPatientUUIDWithoutPrefix}| ${linkedCounts.linkedProaPersons[parseInt(i)]}| ${doc._uuid}| Master person is linked with other master persons having ids as mentioned| ${linkedCounts.linkedMasterPersons}| \n`
                        );
                    } else if (!linkedCounts.linkedMasterPatients.length) {
                        this.writeStreamError.write(
                            `${proaPatientUUIDWithoutPrefix}| ${linkedCounts.linkedProaPersons[parseInt(i)]}| ${doc._uuid}| Master person does not have any linked master patient| ${''}| \n`
                        );
                    } else if (linkedCounts.linkedMasterPatients.length > 1) {
                        this.writeStreamError.write(
                            `${proaPatientUUIDWithoutPrefix}| ${linkedCounts.linkedProaPersons[parseInt(i)]}| ${doc._uuid}| Master person have multiple linked master patients having ids as mentioned| ${linkedCounts.linkedMasterPatients}| \n`
                        );
                    } else if (!linkedCounts.linkedClientPersons.length) {
                        this.writeStreamError.write(
                            `${proaPatientUUIDWithoutPrefix}| ${linkedCounts.linkedProaPersons[parseInt(i)]}| ${doc._uuid}| Master person does not have any linked client person| ${''}| \n`
                        );
                    } else if (linkedCounts.linkedClientPersons.length > 1) {
                        this.writeStreamError.write(
                            `${proaPatientUUIDWithoutPrefix}| ${linkedCounts.linkedProaPersons[parseInt(i)]}| ${doc._uuid}| Master person have multiple linked client persons having ids as mentioned| ${linkedCounts.linkedClientPersons}| \n`
                        );
                    } else {
                        if (
                            this.proaPatientToClientPersonMap
                                .get(proaPatientUUID)
                                ?.includes(linkedCounts.linkedClientPersons[0])
                        ) {
                            delinkProaPatientIds.add(proaPatientUUID);
                        } else {
                            this.writeStreamError.write(
                                `${proaPatientUUIDWithoutPrefix}| ${linkedCounts.linkedProaPersons[parseInt(i)]}| ${doc._uuid}| Proa patient has no linked client person| ${''}| \n`
                            );
                        }
                    }
                }
                let proaPersonToBeRemoved = false;
                if (proaPatients.length === delinkProaPatientIds.size) {
                    proaPersonToBeRemoved = true;
                    proaPersonIdsToRemove.add(linkedCounts.linkedProaPersons[parseInt(i)]);
                    this.proaPersonToProaPatientMap.delete(
                        linkedCounts.linkedProaPersons[parseInt(i)]
                    );
                } else {
                    if (this.delinkRemoveProaPerson && delinkProaPatientIds.size > 0) {
                        await this.delinkResources(
                            delinkProaPatientIds,
                            this.proaPersonUUIDToResourceMap.get(
                                linkedCounts.linkedProaPersons[parseInt(i)]
                            ),
                            mongoConfig,
                            collectionName
                        );
                        // Update map proaPersonToProaPatientMap by removing delinked proa patients
                        delinkProaPatientIds.forEach((patientId) => {
                            // Get the list of patients associated with the current proa person ID
                            const patients =
                                this.proaPersonToProaPatientMap.get(
                                    linkedCounts.linkedProaPersons[parseInt(i)]
                                ) ?? [];

                            // Filter out the patient with the given ID
                            const updatedPatients = patients.filter(
                                (patient) => patient.id !== patientId
                            );

                            // Update the map entry with the filtered patient list
                            this.proaPersonToProaPatientMap.set(
                                linkedCounts.linkedProaPersons[parseInt(i)],
                                updatedPatients
                            );
                        });
                    }
                }

                // Adding data in csv file
                delinkProaPatientIds.forEach((ref) => {
                    const { id } = ReferenceParser.parseReference(ref);
                    if (this.delinkRemoveProaPerson) {
                        if (proaPersonToBeRemoved) {
                            this.writeStream.write(
                                `${id}| ${linkedCounts.linkedProaPersons[parseInt(i)]}| ${doc._uuid}| ${linkedCounts.linkedClientPersons[0]}| Delinked| Delinked| Removed| \n`
                            );
                        } else {
                            this.writeStream.write(
                                `${id}| ${linkedCounts.linkedProaPersons[parseInt(i)]}| ${doc._uuid}| ${linkedCounts.linkedClientPersons[0]}| Delinked| Cannot be delinked| Cannot be removed| \n`
                            );
                        }
                    } else {
                        if (proaPersonToBeRemoved) {
                            this.writeStream.write(
                                `${id}| ${linkedCounts.linkedProaPersons[parseInt(i)]}| ${doc._uuid}| ${linkedCounts.linkedClientPersons[0]}| Can be delinked| Can be delinked| Can be removed| \n`
                            );
                        } else {
                            this.writeStream.write(
                                `${id}| ${linkedCounts.linkedProaPersons[parseInt(i)]}| ${doc._uuid}| ${linkedCounts.linkedClientPersons[0]}| Can be delinked| Cannot be delinked| Cannot be removed| \n`
                            );
                        }
                    }
                });
            }
            if (this.delinkRemoveProaPerson && proaPersonIdsToRemove.size > 0) {
                await this.removeProaPersons(proaPersonIdsToRemove, mongoConfig, collectionName);

                // Iterate over the set and update each item by appending the prefix
                const updatedProaPersonIds = new Set(
                    [...proaPersonIdsToRemove].map((uuid) => `Person/${uuid}`)
                );
                // Now, pass the updated set to the function
                await this.delinkResources(updatedProaPersonIds, doc, mongoConfig, collectionName);
            }
        } catch (e) {
            throw new RethrownError({
                message: `Error processing record ${e.message}`,
                error: e,
                args: {
                    resource: doc
                },
                source: 'DelinkProaPersonPatientRunner.processRecordAsync'
            });
        } finally {
            await session.endSession();
            await client.close();
        }
    }

    /**
     * Function to remove proa patients link from a proa person
     * @param {Set<string>} delinkResourceIds
     * @param {Resource} person
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}} mongoConfig
     * @param {string} collectionName
     */
    async delinkResources (delinkResourceIds, person, mongoConfig, collectionName) {
        /**
         * @type {require('mongodb').collection}
         */
        const { db, session, client } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName
        });

        try {
            this.adminLogger.logInfo(
                `Delinking patients having ids: ${delinkResourceIds}, for ${collectionName}`
            );
            const personResource = { ...person };

            // Remove link objects based on UUIDs
            personResource.link = personResource.link.filter(
                (linkObj) => !delinkResourceIds.has(linkObj.target._uuid)
            );

            await db.collection(collectionName).replaceOne(
                {
                    _uuid: personResource._uuid
                },
                personResource
            );

            /**
             * @type {DatabaseUpdateManager}
             */
            const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
                resourceType: 'Person',
                base_version: VERSIONS['4_0_0']
            });
            // To create history
            await databaseUpdateManager.postSaveAsync({
                requestId: this.uniqueRequestId,
                method: 'PUT',
                doc: new Person(personResource)
            });
            this.adminLogger.logInfo(
                `Successfully delinked ids: ${delinkResourceIds} for resource ${collectionName}`
            );
        } catch (e) {
            throw new RethrownError({
                message: `Error updating record ${e.message}`,
                error: e,
                args: {
                    resource: person
                },
                source: 'DelinkProaPersonPatientRunner.delinkResources'
            });
        } finally {
            await session.endSession();
            await client.close();
        }
    }

    /**
     * Function to remove proa persons
     * @param {Set<string>} proaPersonIdsToRemove
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}} mongoConfig
     * @param {string} collectionName
     */
    async removeProaPersons (proaPersonIdsToRemove, mongoConfig, collectionName) {
        /**
         * @type {require('mongodb').collection}
         */
        const { db, session, client } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName
        });

        try {
            this.adminLogger.logInfo(
                `Removing resource ids: ${proaPersonIdsToRemove}, for ${collectionName}`
            );
            await db.collection(collectionName).deleteMany({
                _uuid: {
                    $in: Array.from(proaPersonIdsToRemove)
                }
            });

            this.adminLogger.logInfo(
                `Successfully removed ids: ${proaPersonIdsToRemove} for resource ${collectionName}`
            );
        } catch (e) {
            throw new RethrownError({
                message: `Error removing record ${e.message}`,
                error: e,
                args: {
                    proaPersonIdsToRemove
                },
                source: 'DelinkProaPersonPatientRunner.removeProaPersons'
            });
        } finally {
            await session.endSession();
            await client.close();
        }
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync () {
        // noinspection JSValidateTypes
        try {
            await this.init();

            /**
             * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
             */
            const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

            try {
                await this.getProaPatientsIdMap({ mongoConfig });
                const collectionName = 'Person_4_0_0';
                await this.getPersonsMapFromProaPatient({ mongoConfig, collectionName });
                this.writeStream.write(
                    'Proa Patient UUID| Proa Person UUID| Proa Master Person UUID| Client Person UUID| Proa Person-Proa Patient delinking status| Master Person-Proa Person delinking status| Deletion of Proa Person status|' +
                        '\n'
                );
                this.writeStreamError.write(
                    'Proa Patient UUID| Proa Person UUID| Master Person UUID| Data Issue| Ids having data issue|' +
                        '\n'
                );

                this.adminLogger.logInfo('Fetching Master persons from db');
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
                /**
                 * @type {require('mongodb').collection}
                 */
                const { collection, session, client } = await this.createSingeConnectionAsync({
                    mongoConfig,
                    collectionName
                });

                try {
                    /**
                     * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').Document>>}
                     */
                    const cursor = collection.find(query);
                    while (await cursor.hasNext()) {
                        const doc = await cursor.next();
                        // Process each master separately
                        await this.processRecordAsync(doc, mongoConfig, collectionName);
                    }
                    this.adminLogger.logInfo('Successfully fetched Master persons from db');
                } catch (e) {
                    throw new RethrownError({
                        message: `Error fetching uuids of Master persons for collection ${collectionName}, ${e.message}`,
                        error: e,
                        source: 'DelinkProaPersonPatientRunner.processAsync'
                    });
                } finally {
                    await session.endSession();
                    await client.close();
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
            this.adminLogger.logError(`ERROR: ${e.message}`, { stack: e });
        }
    }
}

module.exports = {
    DelinkProaPersonPatientRunner
};
