const path = require('path');
const fs = require('fs');
const { open } = require('node:fs/promises');
const { ClientPersonToProaPatientLinkRunner } = require('./clientPersonToProaPatientLinkRunner');
const { assertTypeEquals } = require('../../utils/assertType');
const { RethrownError } = require('../../utils/rethrownError');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');

class DelinkProaPersonRunner extends ClientPersonToProaPatientLinkRunner {
    /**
     * @typedef {Object} ConstructorProps
     * @property {string} csvFileName
     * @property {number} proaPatientUuidColumn
     * @property {number} proaPersonUuidColumn
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
        this.masterUuidColumn = masterUuidColumn;
    }

    /**
     * Main process
     * @returns {Promise<void>}
     */
    async processAsync() {
        this.csvFileName = path.resolve(__dirname, path.join('../../../', this.csvFileName));
        this.adminLogger.logInfo(`Reading file: ${this.csvFileName}`);
        try {
            this.adminLogger.logInfo('Starting first iteration to remove links');
            let file = await open(this.csvFileName);
            for await (const line of file.readLines()) {
                /**
                 * @type {string[]}
                 */
                const columns = line.split('| ');

                const proaPatientUuid = columns[this.proaPatientUuidColumn];
                const proaPersonUuid = columns[this.proaPersonUuidColumn];
                const masterPersonUuids = columns[this.masterUuidColumn].split(', ');
                const clientUuids = columns[this.clientUuidColumn].split(', ');
                const statuses = columns[this.statusColumn].split(', ');

                // To check if all the clients are linked to proa patients
                let isClientLinked = true;
                for (let i = 0; i < clientUuids.length; i++) {
                    const clientUuid = clientUuids[`${i}`];
                    const status = statuses[`${i}`];

                    if (status !== 'Client Person & Proa Person Both Linked') {
                        this.adminLogger.logInfo(
                            `Client ${clientUuid} not linked with Proa Patient ${proaPatientUuid}`
                        );
                        isClientLinked = false;
                    }
                }
                if (isClientLinked) {
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
            this.adminLogger.logInfo('First iteration finished');

            this.adminLogger.logInfo('Starting second iteration to delete proa persons');
            // error stream to write errors
            this.errorStream = fs.createWriteStream('delink_errors.csv');
            this.errorStream.write('Proa Person Uuid| Status|\n');

            file = await open(this.csvFileName);
            for await (const line of file.readLines()) {
                /**
                 * @type {string[]}
                 */
                const columns = line.split('| ');

                const proaPatientUuid = columns[this.proaPatientUuidColumn];
                const proaPersonUuid = columns[this.proaPersonUuidColumn];
                const clientUuids = columns[this.clientUuidColumn].split(', ');
                const statuses = columns[this.statusColumn].split(', ');

                // To check if all the clients are linked to proa patients
                let isClientLinked = true;
                for (let i = 0; i < clientUuids.length; i++) {
                    const clientUuid = clientUuids[`${i}`];
                    const status = statuses[`${i}`];

                    if (status !== 'Client Person & Proa Person Both Linked') {
                        this.adminLogger.logInfo(
                            `Client ${clientUuid} not linked with Proa Patient ${proaPatientUuid}`
                        );
                        isClientLinked = false;
                    }
                }
                if (isClientLinked) {
                    await this.deleteProaPerson({
                        proaPersonUuid,
                    });
                }
            }
            this.adminLogger.logInfo('Second iteration finished');
            this.adminLogger.logInfo(`Finished Reading file: ${this.csvFileName}`);

            this.errorStream.close();
            return await new Promise((res) => this.errorStream.once('close', res));
        } catch (err) {
            this.adminLogger.logError(`ERROR: ${err.message}`, { stack: err.stack });
        }
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
     * @typedef {Object} DeleteProaPersonProps
     * @property {string} proaPersonUuid
     *
     * @param {DeleteProaPersonProps}
     */
    async deleteProaPerson({ proaPersonUuid }) {
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
                query: { _uuid: proaPersonUuid },
            });

            if (personData.link?.length > 0) {
                this.errorStream.write(`${proaPersonUuid}| Proa Person with links found|\n`);
            } else {
                // if no links are present delete the proa person
                const results = await databaseQueryManager.deleteManyAsync({
                    query: { _uuid: proaPersonUuid },
                    requestId: this.systemRequestId,
                });

                if (results.deletedCount === 1) {
                    this.adminLogger.logInfo(`Proa Person deleted ${proaPersonUuid}`);
                } else {
                    this.adminLogger.logInfo(`Error while deleting proa person ${results.error}`);
                    this.errorStream.write(`${proaPersonUuid}| ${results.error.message}|\n`);
                }
            }
        } catch (err) {
            this.adminLogger.logError(`Error while deleting proa person ${proaPersonUuid}`);
            throw new RethrownError({
                message: err.message,
                error: err,
                source: 'DelinkProaPersonRunner.deleteProaPerson',
            });
        }
    }
}

module.exports = { DelinkProaPersonRunner };
