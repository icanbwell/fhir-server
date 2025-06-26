if (process.argv.includes('--dotenv')) {
    const path = require('path');
    const dotenv = require('dotenv');
    const pathToEnv = path.resolve(__dirname, '.env');
    dotenv.config({
        path: pathToEnv
    });
    console.log(`Reading config from ${pathToEnv}`);
}
console.log(`MONGO_URL=${process.env.MONGO_URL}`);
console.log(`AUDIT_EVENT_MONGO_URL=${process.env.AUDIT_EVENT_MONGO_URL}`);
const { createContainer } = require('../../createContainer');
const { CommandLineParser } = require('./commandLineParser');
const { AdminLogger } = require('../adminLogger');
const {
    DeletePersonPatientDataGraphRunner
} = require('../runners/deletePersonPatientDataGraphRunner');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main () {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();

    const currentDateTime = new Date();

    const properties = parameters.properties
        ? parameters.properties.split(',').map((x) => x.trim())
        : [];

    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;

    const concurrencyBatchSize = parameters.concurrencyBatchSize || 10;

    const dryRun = parameters.dryRun ? Boolean(parameters.dryRun === 'true') : true;

    const patientUuids = parameters.patientUuids ? parameters.patientUuids.split(',') : [];

    const personUuids = parameters.personUuids ? parameters.personUuids.split(',') : [];

    const adminLogger = new AdminLogger();

    adminLogger.logInfo(
        `[${currentDateTime}] Running script to remove person/patient with provided _uuid`
    );

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register(
        'deletePersonPatientDataGraphRunner',
        (c) =>
            new DeletePersonPatientDataGraphRunner({
                batchSize,
                adminLogger,
                mongoDatabaseManager: c.mongoDatabaseManager,
                adminPersonPatientDataManager: c.adminPersonPatientDataManager,
                properties,
                patientUuids,
                personUuids,
                concurrencyBatchSize,
                dryRun
            })
    );

    /**
     * @type {DeletePersonPatientDataGraphRunner}
     */
    const deletePersonPatientDataGraphRunner = container.deletePersonPatientDataGraphRunner;
    await deletePersonPatientDataGraphRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/deletePersonPatientDataGraph.js --patientUuids=0c2f8ae1-2cc0-5936-a66c-f85ea566e5c5
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/deletePersonPatientDataGraph.js --patientUuids=0c2f8ae1-2cc0-5936-a66c-f85ea566e5c5
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/deletePersonPatientDataGraph.js --patientUuids=0c2f8ae1-2cc0-5936-a66c-f85ea566e5c5 --dryRun false
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/deletePersonPatientDataGraph.js --personUuids=0c2f8ae1-2cc0-5936-a66c-f85ea566e5c5 --dotenv
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/deletePersonPatientDataGraph.js --personUuids=0c2f8ae1-2cc0-5936-a66c-f85ea566e5c5 --dotenv --concurrencyBatchSize=10
 * node src/admin/scripts/deletePersonPatientDataGraph.js --patientUuids=0c2f8ae1-2cc0-5936-a66c-f85ea566e5c5
 */
main().catch((reason) => {
    console.error(reason);
});
