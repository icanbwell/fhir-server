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
const { DelinkProaPersonMasterPersonRunner } = require('../runners/delinkProaPersonMasterPersonRunner');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main () {
    const parameters = CommandLineParser.parseCommandLine();

    /**
     * Name of the csv file
     * @type {string}
     */
    const csvFileName = parameters.csvFileName || 'proa_patient_link_data_errors.csv';

    /**
     * column in which proa patient uuid is present
     * @type {number}
     */
    const proaPatientUuidColumn = parameters.proaPatientUuidColumn || 0;
    /**
     * column in which proa person uuid is present
     * @type {number}
     */
    const proaPersonUuidColumn = parameters.proaPersonUuidColumn || 3;
    /**
     * column in which proa person sourceAssigningAuthority is present
     * @type {number}
     */
    const proaPersonSAAColumn = parameters.proaPersonSAAColumn || 4;
    /**
     * column in which proa person lastUpdated is present
     * @type {number}
     */
    const proaPersonLastUpdatedColumn = parameters.proaPersonLastUpdatedColumn || 5;
    /**
     * column in which master person uuid is present
     * @type {number}
     */
    const masterUuidColumn = parameters.masterUuidColumn || 6;
    /**
     * column in which proa person sourceAssigningAuthority is present
     * @type {number}
     */
    const masterPersonSAAColumn = parameters.proaPersonSAAColumn || 7;
    /**
     * column in which proa person lastUpdated is present
     * @type {number}
     */
    const masterPersonLastUpdatedColumn = parameters.proaPersonLastUpdatedColumn || 8;
    /**
     * column in which status is present
     * @type {number}
     */
    const statusColumn = parameters.statusColumn || 12;

    const adminLogger = new AdminLogger();

    const currentDateTime = new Date();
    adminLogger.logInfo(`[${currentDateTime}] Running delinkProaPersonMasterPersonRunner script`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('delinkProaPersonMasterPersonRunner', (c) => new DelinkProaPersonMasterPersonRunner({
        csvFileName,
        proaPatientUuidColumn,
        proaPersonUuidColumn,
        proaPersonSAAColumn,
        proaPersonLastUpdatedColumn,
        masterUuidColumn,
        masterPersonSAAColumn,
        masterPersonLastUpdatedColumn,
        adminLogger,
        statusColumn,
        deleteData: !!parameters.deleteData,
        databaseQueryFactory: c.databaseQueryFactory,
        adminPersonPatientLinkManager: new AdminPersonPatientLinkManager({
            databaseQueryFactory: c.databaseQueryFactory,
            databaseUpdateFactory: c.databaseUpdateFactory,
            fhirOperationsManager: c.fhirOperationsManager,
            postSaveProcessor: c.postSaveProcessor,
            patientFilterManager: c.patientFilterManager
        })
    }));

    /**
     * @type {DelinkProaPersonMasterPersonRunner}
     */
    const delinkProaPersonMasterPersonRunner = container.delinkProaPersonMasterPersonRunner;
    await delinkProaPersonMasterPersonRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/delinkProaPersonMasterPerson.js
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/delinkProaPersonMasterPerson.js
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/delinkProaPersonMasterPerson.js --csvFileName client
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/delinkProaPersonMasterPerson.js --deleteData
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/delinkProaPersonMasterPerson.js --proaPatientUuidColumn 0
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/delinkProaPersonMasterPerson.js --proaPersonUuidColumn 3
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/delinkProaPersonMasterPerson.js --masterUuidColumn 6
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/delinkProaPersonMasterPerson.js --statusColumn 12
 */
main().catch(reason => {
    console.error(reason);
});
