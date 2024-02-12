const { open } = require('node:fs/promises');
const { AdminPersonPatientLinkManager } = require('../adminPersonPatientLinkManager');
const { AdminLogger } = require('../adminLogger');
const { assertTypeEquals } = require('../../utils/assertType');
const { generateUUID } = require('../../utils/uid.util');

class ClientPersonToProaPatientLinkRunner {
    /**
     * @typedef {Object} ConstructorProps
     * @property {string} csvFileName
     * @property {number} proaPatientUuidColumn
     * @property {number} proaPatientSourceAssigningAuthorityColumn
     * @property {number} clientUuidColumn
     * @property {number} statusColumn
     * @property {AdminLogger} adminLogger
     * @property {AdminPersonPatientLinkManager} adminPersonPatientLinkManager
     *
     * @param {ConstructorProps}
     */
    constructor({
        csvFileName,
        proaPatientUuidColumn,
        proaPatientSourceAssigningAuthorityColumn,
        clientUuidColumn,
        statusColumn,
        adminPersonPatientLinkManager,
        adminLogger,
    }) {
        /**
         * @type {AdminLogger}
         */
        this.adminLogger = adminLogger;
        assertTypeEquals(adminLogger, AdminLogger);

        /**
         * @type {AdminPersonPatientLinkManager}
         */
        this.adminPersonPatientLinkManager = adminPersonPatientLinkManager;
        assertTypeEquals(adminPersonPatientLinkManager, AdminPersonPatientLinkManager);

        /**
         * @type {string}
         */
        this.csvFileName = csvFileName;

        /**
         * @type {number}
         */
        this.proaPatientUuidColumn = proaPatientUuidColumn;

        /**
         * @type {number}
         */
        this.proaPatientSourceAssigningAuthorityColumn = proaPatientSourceAssigningAuthorityColumn;

        /**
         * @type {number}
         */
        this.clientUuidColumn = clientUuidColumn;

        /**
         * @type {number}
         */
        this.statusColumn = statusColumn;

        /**
         * @type {string}
         */
        this.systemRequestId = generateUUID();
    }

    /**
     * Main process
     * @returns {Promise<void>}
     */
    async processAsync() {
        this.adminLogger.logInfo(`Reading file: ${this.csvFileName}`);
        try {
            const file = await open(this.csvFileName);
            for await (const line of file.readLines()) {
                /**
                 * @type {string[]}
                 */
                const columns = line.split('| ');

                const proaPatientUuid = columns[this.proaPatientUuidColumn];
                const proaPatientSourceAssigningAuthority = columns[this.proaPatientSourceAssigningAuthorityColumn];
                const clientUuids = columns[this.clientUuidColumn].split(', ');
                const statuses = columns[this.statusColumn].split(', ');

                for (let i = 0; i < clientUuids.length; i++) {
                    const clientUuid = clientUuids[`${i}`];
                    const status = statuses[`${i}`];

                    if (status === 'Client Person Not Linked') {
                        this.adminLogger.logInfo(
                            `Linking Client ${clientUuid} with Proa Patient ${proaPatientUuid}`
                        );

                        const res =
                            await this.adminPersonPatientLinkManager.createPersonToPatientLinkAsync(
                                {
                                    req: {
                                        header: () => 'system',
                                        headers: {
                                            accept: '*/*',
                                        },
                                        user: { name: 'system' },
                                        authInfo: {
                                            scope: 'user/*.read user/*.write',
                                        },
                                        method: 'POST',
                                        path: '/admin',
                                        originalUrl: '/admin',
                                        requestId: this.systemRequestId,
                                        userRequestId: this.systemRequestId,
                                    },
                                    externalPersonId: clientUuid,
                                    patientId: `${proaPatientUuid}|${proaPatientSourceAssigningAuthority}`,
                                }
                            );

                        this.adminLogger.logInfo(res.message);
                    }
                }
            }
            this.adminLogger.logInfo(`Finished Reading file: ${this.csvFileName}`);
        } catch (err) {
            this.adminLogger.logError(`ERROR: ${err.message}`, { stack: err.stack });
        }
    }
}

module.exports = { ClientPersonToProaPatientLinkRunner };
