const path = require('path');
const fs = require('fs');
const { open } = require('node:fs/promises');
const { ClientPersonToProaPatientLinkRunner } = require('./clientPersonToProaPatientLinkRunner');
const { assertTypeEquals } = require('../../utils/assertType');
const { RethrownError } = require('../../utils/rethrownError');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { IdentifierSystem } = require('../../utils/identifierSystem');
const { ReferenceParser } = require('../../utils/referenceParser');

class DelinkProaPersonRunner extends ClientPersonToProaPatientLinkRunner {
    /**
     * @typedef {Object} ConstructorProps
     * @property {string} csvFileName
     * @property {number} proaPatientUuidColumn
     * @property {number} proaPersonUuidColumn
     * @property {number} proaPersonSAAColumn
     * @property {number} proaPersonLastUpdatedColumn
     * @property {number} masterUuidColumn
     * @property {number} clientUuidColumn
     * @property {number} statusColumn
     * @property {AdminPersonPatientLinkManager} adminPersonPatientLinkManager
     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {AdminLogger} adminLogger
     *
     * @param {ConstructorProps}
     */
    constructor({
        csvFileName,
        proaPatientUuidColumn,
        proaPersonUuidColumn,
        proaPersonSAAColumn,
        proaPersonLastUpdatedColumn,
        masterUuidColumn,
        clientUuidColumn,
        statusColumn,
        adminPersonPatientLinkManager,
        databaseQueryFactory,
        adminLogger,
    }) {
        super({
            csvFileName,
            proaPatientUuidColumn,
            clientUuidColumn,
            statusColumn,
            adminPersonPatientLinkManager,
            adminLogger,
        });
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {number}
         */
        this.proaPersonUuidColumn = proaPersonUuidColumn;

        /**
         * @type {number}
         */
        this.proaPersonSAAColumn = proaPersonSAAColumn;

        /**
         * @type {number}
         */
        this.proaPersonLastUpdatedColumn = proaPersonLastUpdatedColumn;
        console.log(proaPersonSAAColumn, proaPersonLastUpdatedColumn, 'Heree');

        /**
         * @type {number}
         */
        this.masterUuidColumn = masterUuidColumn;

        /**
         * @type {Map<string, Set<string>>}
         */
        this.proaPersonToClientPersonMap = new Map();
    }

    /**
     * Main process
     * @returns {Promise<void>}
     */
    async processAsync() {
        try {
            this.csvFileName = path.resolve(__dirname, path.join('../../../', this.csvFileName));

            this.initializeWriteStreams();
            await this.processDataFromCsv();

            this.adminLogger.logInfo(`Reading file: ${this.csvFileName}`);
            await this.handleDelink();

            await this.handlePersonDelete();
            this.adminLogger.logInfo(`Finished Reading file: ${this.csvFileName}`);

            await this.handleStreamClose();
        } catch (err) {
            this.adminLogger.logError(`ERROR: ${err.message}`, { stack: err.stack });
        }
    }

    /**
     * Initializes write streams
     * @returns {Promise<void>}
     */
    initializeWriteStreams() {
        // write stream to write person status
        this.writeStream = fs.createWriteStream('deleted_persons.csv');
        this.writeStream.write('Proa Person Uuid| Proa Person SourceAssigningAuthority| Proa Person LastUpdated|\n');
        // error stream to write errors
        this.errorStream = fs.createWriteStream('delink_errors.csv');
        this.errorStream.write('Proa Person Uuid| Proa Person SourceAssigningAuthority| Proa Person LastUpdated| Status|\n');
    }

    handleStreamClose() {
        this.errorStream.close();
        this.writeStream.close();

        return Promise.all([
            new Promise((res) => this.errorStream.once('close', res)),
            new Promise((res) => this.writeStream.once('close', res))
        ]);
    }

    /**
     * Processes data from the csv and creates map of proaPatient, proaPerson, masterPerson, clientPerson, status
     * @returns {Promise<void>}
     */
    async processDataFromCsv() {
        try {
            this.adminLogger.logInfo('Processing CSV Data');
            /**
             * @type {import('../../dataLayer/databaseQueryManager').DatabaseQueryManager}
             */
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'Person',
                base_version: '4_0_0',
            });

            const file = await open(this.csvFileName);
            for await (const line of file.readLines()) {
                /**
                 * @type {string[]}
                 */
                const columns = line.split('| ');

                const proaPatientUuid = columns[this.proaPatientUuidColumn];
                if (proaPatientUuid.includes('Proa')) {
                    continue;
                }
                const proaPersonUuids = columns[this.proaPersonUuidColumn].split(', ');
                const masterPersonUuids = columns[this.masterUuidColumn].split(', ');
                const clientUuids = columns[this.clientUuidColumn].split(', ');

                const cursor = await databaseQueryManager.findAsync({
                    query: { _uuid: { $in: masterPersonUuids } }, options: { projection: { _uuid: 1, link: 1 } }
                });
                while (await cursor.hasNext()) {
                    const masterPersonData = await cursor.next();
                    const relatedProaPersons = [];
                    const relatedClientPerson = [];

                    masterPersonData?.link?.forEach(link => {
                        const uuidReference =
                            link?.target?.extension?.find((e) => e.url === IdentifierSystem.uuid)?.valueString || '';

                        const { id: uuid, resourceType } = ReferenceParser.parseReference(uuidReference);

                        if (resourceType === 'Person') {
                            if (proaPersonUuids.includes(uuid)) {
                                relatedProaPersons.push(uuid);
                            } else if (clientUuids.includes(uuid)) {
                                relatedClientPerson.push(uuid);
                            }
                        }

                        relatedClientPerson.forEach(client => {
                            relatedProaPersons.forEach(proa => {
                                if (proa === '' || client === '') {
                                    return;
                                }
                                if (!this.proaPersonToClientPersonMap.has(proa)) {
                                    this.proaPersonToClientPersonMap.set(proa, new Set());
                                }
                                this.proaPersonToClientPersonMap.get(proa).add(client);
                            });
                        });
                    });
                }
            }
            this.adminLogger.logInfo('Finished Processing Data');
        } catch (err) {
            this.adminLogger.logError('Error while processing data');
            throw new RethrownError({
                message: err.message,
                error: err,
                source: 'DelinkProaPersonRunner.processDataFromCsv',
            });
        }
    }

    /**
     * Handles Delinking of proa person and master person
     * @returns {Promise<void>}
     */
    async handleDelink() {
        this.adminLogger.logInfo('Starting first iteration to remove links');
        const file = await open(this.csvFileName);

        for await (const line of file.readLines()) {
            /**
             * @type {string[]}
             */
            const columns = line.split('| ');

            const proaPatientUuid = columns[this.proaPatientUuidColumn];
            if (proaPatientUuid.includes('Proa')) {
                continue;
            }
            const proaPersonUuids = columns[this.proaPersonUuidColumn].split(', ');
            const masterPersonUuids = columns[this.masterUuidColumn].split(', ');
            const clientUuids = columns[this.clientUuidColumn].split(', ');
            const statuses = columns[this.statusColumn].split(', ');

            /**
             * @type {Map<string, string>}
             */
            const clientToStatusMap = new Map();
            clientUuids.forEach((uuid, i) => clientToStatusMap.set(uuid, statuses[`${i}`]));

            for (const proaPersonUuid of proaPersonUuids) {
                const relatedClientPersons = Array.from(this.proaPersonToClientPersonMap.get(proaPersonUuid) || []);

                let isClientPersonRelated = true;
                relatedClientPersons.forEach(uuid => {
                    if (
                        clientUuids.includes(uuid) &&
                        clientToStatusMap.get(uuid) !== 'Client Person & Proa Person Both Linked'
                    ) {
                        this.adminLogger.logInfo(`Client ${uuid} not related to proa patient ${proaPatientUuid}`);
                        isClientPersonRelated = false;
                    }
                });

                if (isClientPersonRelated && relatedClientPersons.length > 0) {
                    await this.removeProaPersonToMasterPersonLink({
                        proaPersonUuid,
                        masterPersonUuids,
                    });

                    await this.removeProaPersonToProaPatientLink({
                        proaPersonUuid,
                        proaPatientUuid,
                    });
                }
            }
        }
        this.adminLogger.logInfo('First iteration finished');
    }

    /**
     * Handle deletion of person
     * @returns {Promise<void>}
     */
    async handlePersonDelete() {
        this.adminLogger.logInfo('Starting second iteration to delete proa persons');

        const file = await open(this.csvFileName);
        for await (const line of file.readLines()) {
            /**
             * @type {string[]}
             */
            const columns = line.split('| ');

            const proaPatientUuid = columns[this.proaPatientUuidColumn];
            if (proaPatientUuid.includes('Proa')) {
                continue;
            }
            const proaPersonUuids = columns[this.proaPersonUuidColumn].split(', ');
            const proaPersonSAA = columns[this.proaPersonSAAColumn].split(', ');
            const proaPersonLastUpdated = columns[this.proaPersonLastUpdatedColumn].split(', ');

            for (let i = 0; i < proaPersonUuids.length; i++) {
                const proaPersonUuid = proaPersonUuids[`${i}`];
                const sourceAssigningAuthority = proaPersonSAA[`${i}`];
                const lastUpdated = proaPersonLastUpdated[`${i}`];

                await this.deletePerson({
                    personUuid: proaPersonUuid,
                    sourceAssigningAuthority,
                    lastUpdated,
                    slug: 'Proa',
                });
            }
        }
        this.adminLogger.logInfo('Second iteration finished');
    }

    /**
     * Removes link from all master persons to proa person
     * @typedef {Object} RemoveProaPersonToMasterPersonLinkProps
     * @property {string} proaPersonUuid
     * @property {string[]} masterPersonUuids
     *
     * @param {RemoveProaPersonToMasterPersonLinkProps}
     */
    async removeProaPersonToMasterPersonLink({ proaPersonUuid, masterPersonUuids }) {
        for (const masterPersonUuid of masterPersonUuids) {
            this.adminLogger.logInfo(
                `Removing link from master person ${masterPersonUuid} to proa person ${proaPersonUuid}`
            );

            const results = await this.adminPersonPatientLinkManager.removePersonToPersonLinkAsync({
                req: this.req,
                bwellPersonId: masterPersonUuid,
                externalPersonId: proaPersonUuid,
            });
            this.adminLogger.logInfo(results.message);
        }
    }

    /**
     * Removes link from proa person to proa patient
     * @typedef {Object} RemoveProaPersonToProaPatientLinkProps
     * @property {string} proaPersonUuid
     * @property {string} proaPatientUuid
     *
     * @param {RemoveProaPersonToProaPatientLinkProps}
     */
    async removeProaPersonToProaPatientLink({ proaPersonUuid, proaPatientUuid }) {
        this.adminLogger.logInfo(
            `Removing link from proa person ${proaPersonUuid} to proa patient ${proaPatientUuid}`
        );

        const results = await this.adminPersonPatientLinkManager.removePersonToPatientLinkAsync({
            req: this.req,
            personId: proaPersonUuid,
            patientId: proaPatientUuid,
        });
        this.adminLogger.logInfo(results.message);
    }

    /**
     * Deletes proa person if link is not present in the proa person
     * @typedef {Object} DeletePersonProps
     * @property {string} personUuid
     * @property {string} sourceAssigningAuthority
     * @property {string} lastUpdated
     * @property {string} slug
     *
     * @param {DeletePersonProps}
     */
    async deletePerson({ personUuid, sourceAssigningAuthority, lastUpdated, slug }) {
        try {
            // Get person data to check for links
            /**
             * @type {import('../../dataLayer/databaseQueryManager').DatabaseQueryManager}
             */
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'Person',
                base_version: '4_0_0',
            });
            const personData = await databaseQueryManager.findOneAsync({
                query: { _uuid: personUuid },
            });

            if (!personData) {
                return;
            }

            if (personData.link?.length > 0) {
                this.errorStream.write(`${personUuid}| ${sourceAssigningAuthority}| ${lastUpdated}| ${slug} Person with links found|\n`);
            } else {
                // if no links are present delete the proa person
                const results = await databaseQueryManager.deleteManyAsync({
                    query: { _uuid: personUuid },
                    requestId: this.systemRequestId,
                });

                if (results.deletedCount === 1) {
                    this.adminLogger.logInfo(`${slug} Person deleted ${personUuid}`);
                    this.writeStream.write(
                        `${personUuid}| ${sourceAssigningAuthority}| ${lastUpdated}|\n`
                    );
                } else {
                    this.adminLogger.logInfo(`Error while deleting ${slug} person ${results?.error}`);
                    this.errorStream.write(
                        `${personUuid}| ${sourceAssigningAuthority}| ${lastUpdated}| ${results?.error?.message || 'No Error Message'}|\n`
                    );
                }
            }
        } catch (err) {
            this.adminLogger.logError(`Error while deleting ${slug} person ${personUuid}`);
            throw new RethrownError({
                message: err.message,
                error: err,
                source: 'DelinkProaPersonRunner.deletePerson',
            });
        }
    }
}

module.exports = { DelinkProaPersonRunner };
