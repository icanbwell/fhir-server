const fs = require('fs');

const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { RethrownError } = require('../../utils/rethrownError');
const { ReferenceParser } = require('../../utils/referenceParser');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { IdentifierSystem } = require('../../utils/identifierSystem');

/**
 * @typedef {Object} MongoConfigType
 * @property {string} connection
 * @property {string} db_name
 * @property {import('mongodb').MongoClientOptions} options
 */

/**
 * @typedef {Object} CsvDataType
 * @property {string} uuid
 * @property {string} sourceAssigningAuthority
 * @property {string} lastUpdated
 */

class ProaPatientLinkCsvRunner extends BaseBulkOperationRunner {
    /**
     * @typedef {Object} ConstructorProps
     * @property {AdminLogger} adminLogger
     * @property {MongoDatabaseManager} mongoDatabaseManager
     * @property {MongoCollectionManager} mongoCollectionManager
     * @property {number} batchSize
     * @property {string[]} clientSourceAssigningAuthorities
     * @property {boolean} skipAlreadyLinked
     *
     * @param {ConstructorProps}
     */
    constructor({
        adminLogger,
        mongoDatabaseManager,
        mongoCollectionManager,
        batchSize,
        clientSourceAssigningAuthorities,
        skipAlreadyLinked,
    }) {
        super({
            adminLogger,
            mongoDatabaseManager,
            mongoCollectionManager,
            batchSize,
        });
        /**
         * @type {boolean}
         */
        this.skipAlreadyLinked = skipAlreadyLinked;

        /**
         * @type {string}
         */
        this.patientCollectionName = 'Patient_4_0_0';

        /**
         * @type {string}
         */
        this.personCollectionName = 'Person_4_0_0';

        /**
         * @type {string}
         */
        this.proaConnectionTypes = ['proa', 'humanapi'];

        /**
         * @type {string}
         */
        this.clientPersonSource = 'https://www.icanbwell.com/enterprise-person-service';

        /**
         * @type {string[]}
         */
        this.clientSourceAssigningAuthorities = clientSourceAssigningAuthorities;

        /**
         * @type {Map<string, CsvDataType>}
         */
        this.proaPatientDataMap = new Map();

        /**
         * @type {Map<string, CsvDataType>}
         */
        this.personDataMap = new Map();

        /**
         * @type {Map<string, string[]>}
         */
        this.proaPatientToProaPersonMap = new Map();

        /**
         * @type {Map<string, string[]>}
         */
        this.proaPatientToClientPersonMap = new Map();

        /**
         * @type {Map<string, string[]>}
         */
        this.proaPatientToMasterPersonMap = new Map();

        /**
         * @type {Map<string, string[]>}
         */
        this.proaPersonToProaPatientMap = new Map();

        /**
         * @type {Map<string, string[]>}
         */
        this.proaPersonToMasterPersonMap = new Map();

        /**
         * @type {Map<string, string[]>}
         */
        this.masterPersonToProaPersonMap = new Map();

        /**
         * @type {Map<string, string[]>}
         */
        this.masterPersonToClientPersonMap = new Map();

        /**
         * @type {Map<string, string[]>}
         */
        this.masterPersonToMasterPatientMap = new Map();

        /**
         * @type {Map<string, string[]>}
         */
        this.clientPersonToClientPatientMap = new Map();
    }

    /**
     * main process function
     * @returns {Promise<void>}
     */
    async processAsync() {
        try {
            this.initializeWriteStream();

            this.adminLogger.logInfo('Fetching Proa Patient Data');
            await this.getProaPatientData();
            this.adminLogger.logInfo('Proa Patient Data Fetched');

            this.adminLogger.logInfo('Fetching Proa Person and Client Person Data');
            await this.getProaPatientRelatedPersons();
            this.adminLogger.logInfo('Proa Person and Client Person Data Fetched');
            this.adminLogger.logInfo('Handling Errors Related to Proa Patient');

            this.adminLogger.logInfo('Creating Proa Person to Proa Patient Map');
            this.createProaPersonToProaPatientMap();
            this.adminLogger.logInfo('Fetching Master Persons realted to Proa Persons');
            await this.getMasterPersonFromProaPersons();
            this.adminLogger.logInfo('Master Persons Fetched');
            this.adminLogger.logInfo('Creating Proa Person to Master Person Map');
            this.createProaPersonToMasterPersonMap();
            this.adminLogger.logInfo('Handling Errors Related to Persons');
            this.handleAllErrorCases();

            this.adminLogger.logInfo('Writing Proa Patient Data Graph');
            this.writeProaPatientDataGraph();

            await this.handleWriteStreamClose();
        } catch (err) {
            this.adminLogger.logError(`Error in main process: ${err.message}`, {
                stack: err.stack,
            });
        }
    }

    /**
     * Initialize write stream
     * @returns {void}
     */
    initializeWriteStream() {
        this.writeStream = fs.createWriteStream('proa_patient_link_data.csv');
        this.writeErrorStream = fs.createWriteStream('proa_patient_link_data_errors.csv');

        this.writeStream.write(
            'Proa Patient UUID| Proa Patient SourceAssigningAuthority| Proa Patient LastUpdated | ' +
                'Proa Person UUID| Proa Person SourceAssigningAuthority| Proa Person LastUpdated| ' +
                'Proa Master Person UUID| Proa Master Person SourceAssigningAuthority| Proa Master Person LastUpdated| ' +
                'Client Person UUID| Client Person SourceAssigningAuthority| Client Person LastUpdated| ' +
                'Status|\n'
        );
        this.writeErrorStream.write(
            'Proa Patient UUID| Proa Patient SourceAssigningAuthority| Proa Patient LastUpdated| ' +
            'Proa Person UUID| Proa Person SourceAssigningAuthority| Proa Person LastUpdated| ' +
            'Proa Master Person UUID| Proa Master Person SourceAssigningAuthority| Proa Master Person LastUpdated| ' +
            'Client Person UUID| Client Person SourceAssigningAuthority| Client Person LastUpdated| ' +
            'Status|\n'
        );
    }

    /**
     * Closes Write streams
     * @returns {Promise<void>}
     */
    async handleWriteStreamClose() {
        this.writeStream.close();
        this.writeErrorStream.close();

        return Promise.all([
            new Promise((resolve) => this.writeStream.on('close', resolve)),
            new Promise((resolve) => this.writeErrorStream.on('close', resolve)),
        ]);
    }

    /**
     * Handles all the writes to proa_patient_link_data.csv
     * @typedef {Object} WriteDataProps
     * @property {CsvDataType} proaPatientData
     * @property {CsvDataType} proaPersonData
     * @property {CsvDataType[]} masterPersonsData
     * @property {CsvDataType[]} clientPersonsData
     * @property {string} message
     *
     * @param {WriteDataProps}
     * @returns {void}
     */
    writeData({ proaPatientData, proaPersonData, masterPersonsData, clientPersonsData, message }) {
        const masterPersonData = {
            uuid: masterPersonsData.reduce((arr, d) => arr.push(d.uuid) && arr, []).join(', '),
            sourceAssigningAuthority: masterPersonsData
                .reduce((arr, d) => arr.push(d.sourceAssigningAuthority) && arr, [])
                .join(', '),
            lastUpdated: masterPersonsData.reduce((arr, d) => arr.push(d.lastUpdated) && arr, []).join(', '),
        };

        const clientPersonData = {
            uuid: clientPersonsData.reduce((arr, d) => arr.push(d.uuid) && arr, []).join(', '),
            sourceAssigningAuthority: clientPersonsData
                .reduce((arr, d) => arr.push(d.sourceAssigningAuthority) && arr, [])
                .join(', '),
            lastUpdated: clientPersonsData.reduce((arr, d) => arr.push(d.lastUpdated) && arr, []).join(', '),
        };

        this.writeStream.write(
            `${proaPatientData.uuid}| ${proaPatientData.sourceAssigningAuthority}| ${proaPatientData.lastUpdated}| ` +
                `${proaPersonData.uuid}| ${proaPersonData.sourceAssigningAuthority}| ${proaPersonData.lastUpdated}| ` +
                `${masterPersonData.uuid}| ${masterPersonData.sourceAssigningAuthority}| ${masterPersonData.lastUpdated}| ` +
                `${clientPersonData.uuid}| ${clientPersonData.sourceAssigningAuthority}| ${clientPersonData.lastUpdated}| ` +
                `${message}|\n`,
            (err) => {
                if (err) {
                    this.adminLogger.logError(`Error while writing to data stream: ${err.message}`, {
                        stack: err.stack,
                    });
                }
            }
        );
    }

    /**
     * Handles all the writes to proa_patient_link_data_errors.csv
     * @typedef {Object} WriteErrorCasesProps
     * @property {CsvDataType} proaPatientData
     * @property {CsvDataType[]} proaPersonsData
     * @property {CsvDataType[]} masterPersonsData
     * @property {CsvDataType[]} clientPersonsData
     * @property {string} message
     *
     * @param {WriteErrorCasesProps}
     * @returns {void}
     */
    writeErrorCases({ proaPatientData, proaPersonsData, masterPersonsData, clientPersonsData, message }) {
        const proaPersonData = {
            uuid: proaPersonsData.reduce((arr, d) => arr.push(d.uuid) && arr, []).join(', '),
            sourceAssigningAuthority: proaPersonsData
                .reduce((arr, d) => arr.push(d.sourceAssigningAuthority) && arr, [])
                .join(', '),
            lastUpdated: proaPersonsData.reduce((arr, d) => arr.push(d.lastUpdated) && arr, []).join(', '),
        };

        const masterPersonData = {
            uuid: masterPersonsData.reduce((arr, d) => arr.push(d.uuid) && arr, []).join(', '),
            sourceAssigningAuthority: masterPersonsData
                .reduce((arr, d) => arr.push(d.sourceAssigningAuthority) && arr, [])
                .join(', '),
            lastUpdated: masterPersonsData.reduce((arr, d) => arr.push(d.lastUpdated) && arr, []).join(', '),
        };

        const clientPersonData = {
            uuid: clientPersonsData.reduce((arr, d) => arr.push(d.uuid) && arr, []).join(', '),
            sourceAssigningAuthority: clientPersonsData
                .reduce((arr, d) => arr.push(d.sourceAssigningAuthority) && arr, [])
                .join(', '),
            lastUpdated: clientPersonsData.reduce((arr, d) => arr.push(d.lastUpdated) && arr, []).join(', '),
        };

        this.writeErrorStream.write(
            `${proaPatientData.uuid}| ${proaPatientData.sourceAssigningAuthority}| ${proaPatientData.lastUpdated}| ` +
                `${proaPersonData.uuid}| ${proaPersonData.sourceAssigningAuthority}| ${proaPersonData.lastUpdated}| ` +
                `${masterPersonData.uuid}| ${masterPersonData.sourceAssigningAuthority}| ${masterPersonData.lastUpdated}| ` +
                `${clientPersonData.uuid}| ${clientPersonData.sourceAssigningAuthority}| ${clientPersonData.lastUpdated}| ` +
                `${message}|\n`,
            (err) => {
                if (err) {
                    this.adminLogger.logError(`Error while writing to error stream: ${err.message}`, {
                        stack: err.stack,
                    });
                }
            }
        );
    }

    /**
     * Fetch proa patient data from database
     * @returns {Promise<void>}
     */
    async getProaPatientData() {
        /**
         * @type {MongoConfigType}
         */
        const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

        const { collection, client, session } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName: this.patientCollectionName,
        });

        try {
            const query = {
                'meta.security': {
                    $elemMatch: {
                        system: SecurityTagSystem.connectionType,
                        code: {
                            $in: this.proaConnectionTypes,
                        },
                    },
                },
            };

            const options = {
                projection: {
                    _uuid: 1,
                    meta: 1,
                },
            };

            const cursor = collection.find(query, options);

            while (await cursor.hasNext()) {
                const patient = await cursor.next();
                if (!patient) {
                    continue;
                }

                const sourceAssigningAuthority = patient.meta.security.find(
                    (s) => s.system === SecurityTagSystem.sourceAssigningAuthority
                )?.code;

                this.proaPatientDataMap.set(patient._uuid, {
                    uuid: patient._uuid,
                    sourceAssigningAuthority,
                    lastUpdated: new Date(patient.meta.lastUpdated).toISOString(),
                });
            }
        } catch (err) {
            this.adminLogger.logError(`Error in getProaPatientData: ${err.message}`, {
                stack: err.stack,
            });

            throw new RethrownError({
                message: err.message,
                error: err,
            });
        } finally {
            await session.endSession();
            await client.close();
        }
    }

    /**
     * Links person and patient in global maps
     * @typedef {Object} LinkProaPatientDataProps
     * @property {string} personUuid
     * @property {string} personSourceAssigningAuthority
     * @property {string} personSource
     * @property {boolean} hasProaConnectionType
     * @property {string} patientUuid
     *
     * @param {LinkProaPatientDataProps}
     * @returns {void}
     */
    linkProaPatientData({
        personUuid,
        personSourceAssigningAuthority,
        personSource,
        hasProaConnectionType,
        patientUuid,
    }) {
        // Proa ConnectionType check
        if (hasProaConnectionType) {
            if (!this.proaPatientToProaPersonMap.has(patientUuid)) {
                this.proaPatientToProaPersonMap.set(patientUuid, []);
            }
            this.proaPatientToProaPersonMap.get(patientUuid).push(personUuid);
        }
        // Master person checks
        else if (personSourceAssigningAuthority === 'bwell') {
            if (!this.proaPatientToMasterPersonMap.has(patientUuid)) {
                this.proaPatientToMasterPersonMap.set(patientUuid, []);
            }
            this.proaPatientToMasterPersonMap.get(patientUuid).push(personUuid);
        }
        // Client person checks
        else if (
            personSource === this.clientPersonSource ||
            this.clientSourceAssigningAuthorities.includes(personSourceAssigningAuthority)
        ) {
            if (!this.proaPatientToClientPersonMap.has(patientUuid)) {
                this.proaPatientToClientPersonMap.set(patientUuid, []);
            }
            this.proaPatientToClientPersonMap.get(patientUuid).push(personUuid);
        }
        // Proa person checks
        else if (
            personSourceAssigningAuthority === this.proaPatientDataMap.get(patientUuid).sourceAssigningAuthority
        ) {
            if (!this.proaPatientToProaPersonMap.has(patientUuid)) {
                this.proaPatientToProaPersonMap.set(patientUuid, []);
            }
            this.proaPatientToProaPersonMap.get(patientUuid).push(personUuid);
        }
    }

    /**
     * Fetch persons related to proa patients
     * @returns {Promise<void>}
     */
    async getProaPatientRelatedPersons() {
        /**
         * @type {MongoConfigType}
         */
        const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

        const { collection, client, session } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName: this.personCollectionName,
        });

        try {
            const query = {
                'link.target._uuid': {
                    $in: Array.from(this.proaPatientDataMap.keys()).map((k) => `Patient/${k}`),
                },
            };

            const options = {
                projection: {
                    _uuid: 1,
                    meta: 1,
                    link: 1,
                },
            };

            const cursor = collection.find(query, options);

            while (await cursor.hasNext()) {
                const person = await cursor.next();
                if (!person) {
                    continue;
                }

                const sourceAssigningAuthority = person.meta.security.find(
                    (s) => s.system === SecurityTagSystem.sourceAssigningAuthority
                )?.code;

                const hasProaConnectionType = person.meta.security.find(
                    (s) => s.system === SecurityTagSystem.connectionType && this.proaConnectionTypes.includes(s.code)
                );

                this.personDataMap.set(person._uuid, {
                    uuid: person._uuid,
                    sourceAssigningAuthority,
                    lastUpdated: new Date(person.meta.lastUpdated).toISOString(),
                });

                // get all related proa patient from person links
                person.link.forEach((link) => {
                    const uuidReference =
                        link?.target?.extension?.find((e) => e.url === IdentifierSystem.uuid)?.valueString || '';

                    const { id: uuid, resourceType } = ReferenceParser.parseReference(uuidReference);

                    // Check if this is a proa patient
                    if (resourceType === 'Patient' && this.proaPatientDataMap.has(uuid)) {
                        this.linkProaPatientData({
                            personUuid: person._uuid,
                            personSourceAssigningAuthority: sourceAssigningAuthority,
                            personSource: person.meta.source,
                            hasProaConnectionType,
                            patientUuid: uuid,
                        });
                    }
                });
            }
        } catch (err) {
            this.adminLogger.logError(`Error in getProaPatientRelatedPersons: ${err.message}`, {
                stack: err.stack,
            });

            throw new RethrownError({
                message: err.message,
                error: err,
            });
        } finally {
            await session.endSession();
            await client.close();
        }
    }

    /**
     * Creates Proa Person to Proa Patient map
     * @returns {void}
     */
    createProaPersonToProaPatientMap() {
        this.proaPatientToProaPersonMap.forEach((proaPersonUuids, proaPatientUuid) => {
            if (this.proaPatientDataMap.has(proaPatientUuid)) {
                proaPersonUuids.forEach((proaPersonUuid) => {
                    if (!this.proaPersonToProaPatientMap.has(proaPersonUuid)) {
                        this.proaPersonToProaPatientMap.set(proaPersonUuid, []);
                    }
                    this.proaPersonToProaPatientMap.get(proaPersonUuid).push(proaPatientUuid);
                });
            }
        });
    }

    /**
     * Link master person data with other person and patients
     * @typedef {Object} LinkMasterPersonDataProps
     * @property {string} masterPersonUuid
     * @property {string} otherUuid
     * @property {string} otherResourceType
     * @property {import('mongodb').Db} db
     *
     * @param {LinkMasterPersonDataProps}
     * @returns {Promise<void>}
     */
    async linkMasterPersonData({ masterPersonUuid, otherUuid, otherResourceType, db }) {
        try {
            if (otherResourceType === 'Patient') {
                const patientCollection = db.collection(this.patientCollectionName);

                const patientData = await patientCollection.findOne({ _uuid: otherUuid });
                if (patientData) {
                    const sourceAssigningAuthority = patientData.meta.security.find(
                        (s) => s.system === SecurityTagSystem.sourceAssigningAuthority
                    )?.code;

                    // If sourceAssigningAuthority is bwell then it is master patient
                    if (sourceAssigningAuthority === 'bwell') {
                        if (!this.masterPersonToMasterPatientMap.has(masterPersonUuid)) {
                            this.masterPersonToMasterPatientMap.set(masterPersonUuid, []);
                        }
                        this.masterPersonToMasterPatientMap.get(masterPersonUuid).push(patientData._uuid);
                    }
                }
            } else if (otherResourceType === 'Person') {
                // Check if this is proa person
                if (this.proaPersonToProaPatientMap.has(otherUuid)) {
                    if (!this.masterPersonToProaPersonMap.has(masterPersonUuid)) {
                        this.masterPersonToProaPersonMap.set(masterPersonUuid, []);
                    }
                    this.masterPersonToProaPersonMap.get(masterPersonUuid).push(otherUuid);
                }
                // Check if this is client person
                else {
                    const personCollection = db.collection(this.personCollectionName);
                    const personData = await personCollection.findOne({ _uuid: otherUuid });

                    if (personData) {
                        const sourceAssigningAuthority = personData.meta.security.find(
                            (s) => s.system === SecurityTagSystem.sourceAssigningAuthority
                        )?.code;

                        // Check if this is client person
                        if (
                            this.clientSourceAssigningAuthorities.includes(sourceAssigningAuthority) ||
                            personData.meta.source === this.clientPersonSource
                        ) {
                            // Filter client patients
                            const clientPatients = personData.link?.reduce((uuids, link) => {
                                const uuidReference = link.target.extension.find(
                                    e => e.url === IdentifierSystem.uuid
                                )?.valueString;
                                const { id: uuid, resourceType } = ReferenceParser.parseReference(uuidReference);
                                if (resourceType === 'Patient' && !this.proaPatientDataMap.has(uuid)) {
                                    uuids.push(uuid);
                                }
                                return uuids;
                            }, []);

                            this.clientPersonToClientPatientMap.set(personData._uuid, clientPatients || []);

                            // Store client person information
                            this.personDataMap.set(personData._uuid, {
                                uuid: personData._uuid,
                                sourceAssigningAuthority,
                                lastUpdated: new Date(personData.meta.lastUpdated).toISOString(),
                            });

                            if (!this.masterPersonToClientPersonMap.has(masterPersonUuid)) {
                                this.masterPersonToClientPersonMap.set(masterPersonUuid, []);
                            }
                            this.masterPersonToClientPersonMap.get(masterPersonUuid).push(personData._uuid);
                        }
                    }
                }
            }
        } catch (err) {
            this.adminLogger.logError(`Error in linkMasterPersonData: ${err.message}`, { stack: err.stack });
            throw new RethrownError({
                message: err.message,
                error: err,
            });
        }
    }

    /**
     * Fetch master person related to proa persons
     * @returns {Promise<void>}
     */
    async getMasterPersonFromProaPersons() {
        /**
         * @type {MongoConfigType}
         */
        const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

        const { collection, db, client, session } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName: this.personCollectionName,
        });

        try {
            const query = {
                'meta.security': {
                    $elemMatch: {
                        system: SecurityTagSystem.sourceAssigningAuthority,
                        code: 'bwell',
                    },
                },
                'link.target._uuid': {
                    $in: Array.from(this.proaPersonToProaPatientMap.keys()).map((k) => `Person/${k}`),
                },
            };

            const options = {
                projection: {
                    _uuid: 1,
                    meta: 1,
                    link: 1,
                },
            };

            const cursor = collection.find(query, options);

            while (await cursor.hasNext()) {
                const person = await cursor.next();

                if (!person) {
                    continue;
                }

                const sourceAssigningAuthority = person.meta.security.find(
                    (s) => s.system === SecurityTagSystem.sourceAssigningAuthority
                )?.code;

                this.personDataMap.set(person._uuid, {
                    uuid: person._uuid,
                    sourceAssigningAuthority,
                    lastUpdated: new Date(person.meta.lastUpdated).toISOString(),
                });

                for (const link of person.link) {
                    const uuidReference =
                        link?.target?.extension?.find((e) => e.url === IdentifierSystem.uuid)?.valueString || '';

                    const { id: uuid, resourceType } = ReferenceParser.parseReference(uuidReference);

                    await this.linkMasterPersonData({
                        masterPersonUuid: person._uuid,
                        otherUuid: uuid,
                        otherResourceType: resourceType,
                        db,
                    });
                }
            }
        } catch (err) {
            this.adminLogger.logError(`Error in getMasterPersonFromProaPersons: ${err.message}`, {
                stack: err.stack,
            });

            throw new RethrownError({
                message: err.message,
                error: err,
            });
        } finally {
            await session.endSession();
            await client.close();
        }
    }

    /**
     * Handles the following errors
     * - Proa Person not linked to master person
     * - Master Person Related to multiple or No Master Patients
     * - Client Person Related to multiple or No Client Patients
     * - Master Person not linked to client person
     *
     * @returns {void}
     */
    handleAllErrorCases() {
        Array.from(this.proaPatientDataMap.keys()).forEach(proaPatientUuid => {
            const proaPatientData = this.proaPatientDataMap.get(proaPatientUuid);
            // proa person data
            const proaPersonUuids = this.proaPatientToProaPersonMap.get(proaPatientUuid) ?? [];
            const proaPersonsData = proaPersonUuids.map(uuid => this.personDataMap.get(uuid));
            // master person data
            const masterPersonUuids = proaPersonUuids.reduce((uuids, proaPersonUuid) => {
                if (this.proaPersonToMasterPersonMap.has(proaPersonUuid)) {
                    uuids.push(...this.proaPersonToMasterPersonMap.get(proaPersonUuid));
                } else {
                    uuids.push(null);
                }
                return uuids;
            }, []);
            if (this.proaPatientToMasterPersonMap.has(proaPatientUuid)) {
                masterPersonUuids.push(
                    ...this.proaPatientToMasterPersonMap.get(proaPatientUuid)
                        .filter(uuid => !masterPersonUuids.includes(uuid))
                );
            }
            const masterPersonsData = masterPersonUuids.map(
                uuid => uuid ? this.personDataMap.get(uuid) : {
                    uuid: 'null', sourceAssigningAuthority: 'null', lastUpdated: 'null'
                }
            );
            // client person data
            const clientPersonUuids = masterPersonUuids.reduce((uuids, masterPersonUuid) => {
                if (this.masterPersonToClientPersonMap.has(masterPersonUuid)) {
                    uuids.push(...this.masterPersonToClientPersonMap.get(masterPersonUuid));
                } else {
                    uuids.push(null);
                }
                return uuids;
            }, []);
            const clientPersonsData = clientPersonUuids.map(
                uuid => uuid ? this.personDataMap.get(uuid) : {
                    uuid: 'null', sourceAssigningAuthority: 'null', lastUpdated: 'null'
                }
            );

            // check if master person is present
            if (masterPersonUuids.filter(u => u).length === 0) {
                this.writeErrorCases({
                    proaPatientData,
                    masterPersonsData,
                    clientPersonsData,
                    proaPersonsData,
                    message: 'Proa Person not linked to master person',
                });
                this.proaPatientDataMap.delete(proaPatientUuid);
                return;
            }

            let deleteProaPatient = false;
            let message = '';
            // check if every masterPerson is related to atleast one client person
            for (const masterPersonUuid of masterPersonUuids) {
                if (!masterPersonUuid) {
                    message += 'null, ';
                } else if (
                    !this.masterPersonToClientPersonMap.has(masterPersonUuid) ||
                    this.masterPersonToClientPersonMap.get(masterPersonUuid).length === 0
                ) {
                    if (
                        !this.masterPersonToMasterPatientMap.has(masterPersonUuid) ||
                        this.masterPersonToMasterPatientMap.get(masterPersonUuid).length === 0
                    ) {
                        message += 'Master Person Not Linked to Client Person and Master Patient, ';
                    } else {
                        message += 'Master Person Not Linked to Client Person, ';
                    }
                    deleteProaPatient = true;
                } else if (
                    !this.masterPersonToMasterPatientMap.has(masterPersonUuid) ||
                    this.masterPersonToMasterPatientMap.get(masterPersonUuid).length === 0
                ) {
                    message += 'Master Person Not Linked to Master Patient, ';
                    deleteProaPatient = true;
                } else if (this.masterPersonToMasterPatientMap.get(masterPersonUuid).length > 1) {
                    message += 'Master Person Linked to multiple Master Patients, ';
                    deleteProaPatient = true;
                } else {
                    message += 'Valid Master Patient, ';
                }
            }

            if (deleteProaPatient) {
                this.writeErrorCases({
                    proaPatientData,
                    proaPersonsData,
                    masterPersonsData,
                    clientPersonsData,
                    message,
                });

                this.proaPatientDataMap.delete(proaPatientUuid);
                return;
            }

            message = '';

            for (const clientPersonUuid of clientPersonUuids) {
                if (!clientPersonUuid) {
                    message += 'null, ';
                } else if (
                    !this.clientPersonToClientPatientMap.has(clientPersonUuid) ||
                    this.clientPersonToClientPatientMap.get(clientPersonUuid).length === 0
                ) {
                    message += 'Client Person not Linked to Client Patient, ';
                    deleteProaPatient = true;
                } else if (this.clientPersonToClientPatientMap.get(clientPersonUuid).length > 1) {
                    message += 'Client Person Linked to Multiple Client Patients, ';
                } else {
                    message += 'Valid Client Patient, ';
                }
            }

            if (deleteProaPatient) {
                this.writeErrorCases({
                    proaPatientData,
                    proaPersonsData,
                    masterPersonsData,
                    clientPersonsData,
                    message,
                });

                this.proaPatientDataMap.delete(proaPatientUuid);
                return;
            }
        });
    }

    /**
     * Creates Proa Person to Master Person map
     * @returns {void}
     */
    createProaPersonToMasterPersonMap() {
        this.masterPersonToProaPersonMap.forEach((proaPersonUuids, masterPersonUuid) => {
            proaPersonUuids.forEach((proaPersonUuid) => {
                if (!this.proaPersonToMasterPersonMap.has(proaPersonUuid)) {
                    this.proaPersonToMasterPersonMap.set(proaPersonUuid, []);
                }
                this.proaPersonToMasterPersonMap.get(proaPersonUuid).push(masterPersonUuid);
            });
        });
    }

    /**
     * Writes Proa patient data graph from all the maps
     * @returns {void}
     */
    writeProaPatientDataGraph() {
        for (const proaPatientUuid of Array.from(this.proaPatientDataMap.keys())) {
            const proaPatientData = this.proaPatientDataMap.get(proaPatientUuid);
            if (this.proaPatientToProaPersonMap.has(proaPatientUuid)) {
                const proaPersonUuid = this.proaPatientToProaPersonMap.get(proaPatientUuid)[0];
                const masterPersonUuids = this.proaPersonToMasterPersonMap.get(proaPersonUuid);
                let clientPersonUuids = [];
                masterPersonUuids.forEach((masterPersonUuid) => {
                    if (this.masterPersonToClientPersonMap.has(masterPersonUuid)) {
                        clientPersonUuids.push(...this.masterPersonToClientPersonMap.get(masterPersonUuid));
                    }
                });

                if (this.skipAlreadyLinked) {
                    clientPersonUuids = clientPersonUuids.reduce((uuids, clientUuid) => {
                        if (
                            !this.proaPatientToClientPersonMap.has(proaPatientUuid) ||
                            !this.proaPatientToClientPersonMap.get(proaPatientUuid).includes(clientUuid)
                        ) {
                            uuids.push(clientUuid);
                        }
                        return uuids;
                    }, []);

                    if (clientPersonUuids.length === 0) {
                        continue;
                    }
                }

                let message = '';

                for (const uuid of clientPersonUuids) {
                    // if client person is linked
                    if (
                        this.proaPatientToClientPersonMap.has(proaPatientUuid) &&
                        this.proaPatientToClientPersonMap.get(proaPatientUuid).includes(uuid)
                    ) {
                        if (this.proaPatientToProaPersonMap.get(proaPatientUuid).includes(proaPersonUuid)) {
                            message += 'Client Person & Proa Person Both Linked, ';
                        } else {
                            message += 'Client Person Already Linked, ';
                        }
                    } else {
                        message += 'Client Person Not Linked, ';
                    }
                }

                this.writeData({
                    proaPatientData,
                    proaPersonData: this.personDataMap.has(proaPersonUuid) && this.personDataMap.get(proaPersonUuid),
                    masterPersonsData: masterPersonUuids.map((uuid) => this.personDataMap.has(uuid) && this.personDataMap.get(uuid)),
                    clientPersonsData: clientPersonUuids.map((uuid) => this.personDataMap.has(uuid) && this.personDataMap.get(uuid)),
                    message,
                });
            } else if (this.proaPatientToClientPersonMap.has(proaPatientUuid)) {
                if (this.skipAlreadyLinked) {
                    continue;
                }
                const clientPersonUuids = this.proaPatientToClientPersonMap.get(proaPatientUuid);

                const clientPersonsData = clientPersonUuids
                    .map((uuid) => this.personDataMap.has(uuid) && this.personDataMap.get(uuid))
                    .filter(c => c);

                let message = '';
                clientPersonUuids.forEach(() => {
                    message += 'Client Person Already Linked, ';
                });

                this.writeData({
                    proaPatientData,
                    proaPersonData: { uuid: '', sourceAssigningAuthority: '', lastUpdated: ''},
                    masterPersonsData: [],
                    clientPersonsData,
                    message,
                });
            } else {
                this.writeData({
                    proaPatientData,
                    proaPersonData: { uuid: '', sourceAssigningAuthority: '', lastUpdated: ''},
                    masterPersonsData: [],
                    clientPersonsData: [],
                    message: 'Proa Patient not Linked to any person',
                });
            }
        }
    }
}

module.exports = { ProaPatientLinkCsvRunner };
