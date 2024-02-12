// load config from .env.  Should be first thing so env vars are available to rest of the code
const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});
console.log(`Reading config from ${pathToEnv}`);
console.log(`MONGO_URL=${process.env.MONGO_URL}`);
const { createContainer } = require('../../createContainer');
const { AdminLogger } = require('../adminLogger');
const { CommandLineParser } = require('./commandLineParser');
const { AdminPersonPatientLinkManager } = require('../adminPersonPatientLinkManager');
const { ClientPersonToProaPatientLinkRunner } = require('../runners/clientPersonToProaPatientLinkRunner');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main() {
    const parameters = CommandLineParser.parseCommandLine();

    /**
     * Denotes the file path of the csv to read for getting client person and proa patient data
     * @type {string}
     */
    const csvFileName = parameters.csvFileName || 'proa_patient_link_data.csv';

    /**
     * Denotes the column in the csv where proa patient uuid is stored
     * @type {number}
     */
    const proaPatientUuidColumn = parameters.proaPatientUuidColumn || 0;
    /**
     * Denotes the cloumn in the csv where proa patient sourceAssigningAuthority is stored
     * @type {number}
     */
    const proaPatientSourceAssigningAuthorityColumn = parameters.proaPatientSourceAssigningAuthorityColumn || 1;
    /**
     * Denotes the cloumn in the csv where client person uuid is stored
     * @type {number}
     */
    const clientUuidColumn = parameters.clientUuidColumn || 9;
    /**
     * Denotes the column in the csv where status is stored
     * @type {number}
     */
    const statusColumn = parameters.statusColumn || 12;

    const adminLogger = new AdminLogger();

    let currentDateTime = new Date();
    adminLogger.logInfo(`[${currentDateTime}] Running proaPatientLinkCsvRunner script`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('clientPersonToProaPatientLinkRunner', (c) => new ClientPersonToProaPatientLinkRunner({
        csvFileName,
        proaPatientUuidColumn,
        proaPatientSourceAssigningAuthorityColumn,
        clientUuidColumn,
        statusColumn,
        adminLogger,
        adminPersonPatientLinkManager: new AdminPersonPatientLinkManager({
            databaseQueryFactory: c.databaseQueryFactory,
            databaseUpdateFactory: c.databaseUpdateFactory,
            fhirOperationsManager: c.fhirOperationsManager,
        })
    }));

    /**
     * @type {ClientPersonToProaPatientLinkRunner}
     */
    const clientPersonToProaPatientLinkRunner = container.clientPersonToProaPatientLinkRunner;
    await clientPersonToProaPatientLinkRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/clientPersonToProaPatientLink.js
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/clientPersonToProaPatientLink.js
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/clientPersonToProaPatientLink.js --csvFileName client
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/clientPersonToProaPatientLink.js --proaPatientUuidColumn 0
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/clientPersonToProaPatientLink.js --proaPatientSourceAssigningAuthorityColumn 1
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/clientPersonToProaPatientLink.js --clientUuidColumn 9
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/clientPersonToProaPatientLink.js --statusColumn 12
 */
main().catch(reason => {
    console.error(reason);
});
