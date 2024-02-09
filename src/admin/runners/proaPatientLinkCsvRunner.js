const fs = require('fs');

const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { RethrownError } = require('../../utils/rethrownError');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { IdentifierSystem } = require('../../utils/identifierSystem');
const { ReferenceParser } = require('../../utils/referenceParser');

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
     *
     * @param {ConstructorProps}
     */
    constructor({
        adminLogger,
        mongoDatabaseManager,
        mongoCollectionManager,
        batchSize,
        clientSourceAssigningAuthorities,
    }) {
        super({
            adminLogger,
            mongoDatabaseManager,
            mongoCollectionManager,
            batchSize,
        });
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
            this.handleProaPatientRelatedErrors();

            this.adminLogger.logInfo('Creating Proa Person to Proa Patient Map');
            this.createProaPersonToProaPatientMap();
            this.adminLogger.logInfo('Fetching Master Persons realted to Proa Persons');
            await this.getMasterPersonFromProaPersons();
            this.adminLogger.logInfo('Master Persons Fetched');
            this.adminLogger.logInfo('Creating Proa Person to Master Person Map');
            this.createProaPersonToMasterPersonMap();
            this.adminLogger.logInfo('Handling Errors Related to Persons');
            this.handlePersonRelatedErrors();

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
            'Proa Patient UUID| Proa Patient SourceAssigningAuthority| Proa Patient LastUpdated| Status| Issue Data|\n'
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
                    this.adminLogger.logError(`Error while writing to error stream: ${err.message}`, {
                        stack: err.stack,
                    });
                }
            }
        );
    }

    /**
     * Handles all the writes to proa_patient_link_data_errors.csv
     * @typedef {Object} WriteErrorCasesProps
     * @property {CsvDataType} patientData
     * @property {string} message
     * @property {string[]} errorRecordUuids
     *
     * @param {WriteErrorCasesProps}
     * @returns {void}
     */
    writeErrorCases({ patientData, message, errorRecordUuids }) {
        this.writeErrorStream.write(
            `${patientData.uuid}| ${patientData.sourceAssigningAuthority}| ${patientData.lastUpdated}| ` +
                `${message}| ${errorRecordUuids.join(', ')}|\n`,
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
        // Master person checks
        if (personSourceAssigningAuthority === 'bwell') {
            if (!this.proaPatientToMasterPersonMap.has(patientUuid)) {
                this.proaPatientToMasterPersonMap.set(patientUuid, []);
            }
            this.proaPatientToMasterPersonMap.get(patientUuid).push(personUuid);
        }
        // Proa person checks
        else if (
            hasProaConnectionType ||
            personSourceAssigningAuthority === this.proaPatientDataMap.get(patientUuid).sourceAssigningAuthority
        ) {
            if (!this.proaPatientToProaPersonMap.has(patientUuid)) {
                this.proaPatientToProaPersonMap.set(patientUuid, []);
            }
            this.proaPatientToProaPersonMap.get(patientUuid).push(personUuid);
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
                        link.target.extension.find((e) => e.url === IdentifierSystem.uuid)?.valueString || '';

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
     * Handles the following errors
     * - Proa Patient has multiple Proa Persons
     * - Proa Patient is directly linked to Master Person
     * - Proa Patient not linked to any Person
     *
     * @returns {void}
     */
    handleProaPatientRelatedErrors() {
        Array.from(this.proaPatientDataMap.keys()).forEach((patientUuid) => {
            // check if directly linked to master person
            if (this.proaPatientToMasterPersonMap.has(patientUuid)) {
                this.writeErrorCases({
                    patientData: this.proaPatientDataMap.get(patientUuid),
                    message: 'Proa Patient Directly Linked to Master Person (Added Master Person Uuids)',
                    errorRecordUuids: this.proaPatientToMasterPersonMap.get(patientUuid),
                });
                this.proaPatientDataMap.delete(patientUuid);
            }
            // check if proa patient is linked to multiple proa persons
            else if (
                this.proaPatientToProaPersonMap.has(patientUuid) &&
                this.proaPatientToProaPersonMap.get(patientUuid).length > 1
            ) {
                this.writeErrorCases({
                    patientData: this.proaPatientDataMap.get(patientUuid),
                    message: 'Proa Patient Linked to Multiple Proa Persons (Added Proa Person Uuids)',
                    errorRecordUuids: this.proaPatientToProaPersonMap.get(patientUuid),
                });
                this.proaPatientDataMap.delete(patientUuid);
            }
            // check if proa patient is not related to anyone
            else if (
                !this.proaPatientToClientPersonMap.has(patientUuid) &&
                !this.proaPatientToProaPersonMap.has(patientUuid)
            ) {
                this.writeErrorCases({
                    patientData: this.proaPatientDataMap.get(patientUuid),
                    message: 'Proa Patient not linked to any Person',
                    errorRecordUuids: [],
                });
                this.proaPatientDataMap.delete(patientUuid);
            }
        });
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
                        link.target.extension.find((e) => e.url === IdentifierSystem.uuid)?.valueString || '';

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
     * - Master Person Related to multiple or No Master Patients
     * - Client Person Related to multiple or No Client Patients
     * - Proa Person not related to master person
     *
     * @returns {void}
     */
    handlePersonRelatedErrors() {
        // Check Proa Persons not related to master persons
        Array.from(this.proaPatientDataMap.keys()).forEach(proaPatientUuid => {
            if (this.proaPatientToProaPersonMap.has(proaPatientUuid)) {
                const proaPersonUuid = this.proaPatientToProaPersonMap.get(proaPatientUuid)[0];

                if (!this.proaPersonToMasterPersonMap.has(proaPersonUuid)) {
                    this.writeErrorCases({
                        patientData: this.proaPatientDataMap.get(proaPatientUuid),
                        message: 'Proa Person Not Attached to Master Person',
                        errorRecordUuids: [proaPersonUuid],
                    });

                    this.proaPatientDataMap.delete(proaPatientUuid);
                }
                // Check if related master persons are valid
                else {
                    this.proaPersonToMasterPersonMap.get(proaPersonUuid).forEach((masterPersonUuid) => {
                        // Check if related client person has multiple client patient or no client patient
                        const clientPersonUuids = this.masterPersonToClientPersonMap.get(masterPersonUuid) || [];
                        const relatedClientPatients = [];
                        let isClientPersonValid = true;
                        clientPersonUuids.forEach((personUuid) => {
                            if (this.clientPersonToClientPatientMap.has(personUuid)) {
                                if (
                                    !this.clientPersonToClientPatientMap.has(personUuid) ||
                                    this.clientPersonToClientPatientMap.get(personUuid).length > 1
                                ) {
                                    isClientPersonValid = false;
                                }
                                relatedClientPatients.push(this.clientPersonToClientPatientMap.get(personUuid));
                            }
                        });

                        // Check if master person has no master patient or multiple master patient
                        if (
                            !this.masterPersonToMasterPatientMap.has(masterPersonUuid) ||
                            this.masterPersonToMasterPatientMap.get(masterPersonUuid).length > 1 ||
                            !isClientPersonValid
                        ) {
                            let message = '';
                            let errorRecordUuids = [];
                            if (
                                !this.masterPersonToMasterPatientMap.has(masterPersonUuid) ||
                                this.masterPersonToMasterPatientMap.get(masterPersonUuid).length > 1
                            ) {
                                message = this.masterPersonToMasterPatientMap.has(masterPersonUuid) ?
                                    'Master Person with multiple Master Patients found (Added Master Person Uuid)' :
                                    'Master Person without Master Patient found (Added Master Person Uuid)';
                                errorRecordUuids = [masterPersonUuid];
                            } else {
                                relatedClientPatients.forEach(relatedClientPatient => {
                                    message += relatedClientPatient.length > 1 ?
                                        'Client Person with multiple client patients found (Added Client Person Uuids), ' :
                                        'Client Person without client patients found (Added Client Person Uuids), ';
                                });
                                errorRecordUuids = clientPersonUuids;
                            }

                            const relatedProaPersons = this.masterPersonToProaPersonMap.get(masterPersonUuid);
                            const relatedProaPatients = [];
                            relatedProaPersons.forEach((proaPerson) => {
                                relatedProaPatients.push(...this.proaPersonToProaPatientMap.get(proaPerson));
                            });

                            const patientUuids = relatedProaPatients.join(', ');
                            const patientSourceAssigningAuthorities = relatedProaPatients
                                .map((p) => this.proaPatientDataMap.get(p).sourceAssigningAuthority)
                                .join(', ');
                            const patientLastUpdated = relatedProaPatients
                                .map((p) => this.proaPatientDataMap.get(p).lastUpdated)
                                .join(', ');

                            this.writeErrorCases({
                                patientData: {
                                    uuid: patientUuids,
                                    sourceAssigningAuthority: patientSourceAssigningAuthorities,
                                    lastUpdated: patientLastUpdated,
                                },
                                message,
                                errorRecordUuids,
                            });

                            relatedProaPatients.forEach((patientUuid) => this.proaPatientDataMap.delete(patientUuid));
                        }
                    });
                }
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
        this.proaPatientDataMap.forEach((proaPatientData, proaPatientUuid) => {
            if (this.proaPatientToProaPersonMap.has(proaPatientUuid)) {
                const proaPersonUuid = this.proaPatientToProaPersonMap.get(proaPatientUuid)[0];
                const masterPersonUuids = this.proaPersonToMasterPersonMap.get(proaPersonUuid);
                const clientPersonUuids = [];
                masterPersonUuids.forEach((masterPersonUuid) => {
                    clientPersonUuids.push(...this.masterPersonToClientPersonMap.get(masterPersonUuid));
                });

                let message = '';

                clientPersonUuids.forEach((uuid) => {
                    // if client person is linked
                    if (
                        this.proaPatientToClientPersonMap.has(proaPatientUuid) &&
                        this.proaPatientToClientPersonMap.get(proaPatientUuid).includes(uuid)
                    ) {
                        message += 'Client Person Already Linked';
                    } else {
                        message += 'Client Person Not Linked';
                    }
                });

                this.writeData({
                    proaPatientData,
                    proaPersonData: this.personDataMap.get(proaPersonUuid),
                    masterPersonsData: masterPersonUuids.map((uuid) => this.personDataMap.get(uuid)),
                    clientPersonsData: clientPersonUuids.map((uuid) => this.personDataMap.get(uuid)),
                    message,
                });
            } else if (this.proaPatientToClientPersonMap.has(proaPatientUuid)) {
                const message = 'Client Person Already Linked';
                const clientPersonUuids = this.proaPatientToClientPersonMap.get(proaPatientUuid);

                this.writeData({
                    proaPatientData,
                    proaPersonData: { uuid: '', sourceAssigningAuthority: '', lastUpdated: ''},
                    masterPersonsData: [],
                    clientPersonsData: clientPersonUuids.map((uuid) => this.personDataMap.get(uuid)),
                    message,
                });
            }
        });
    }
}

module.exports = { ProaPatientLinkCsvRunner };
