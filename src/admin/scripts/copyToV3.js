// load config from .env.  Should be first thing so env vars are available to rest of the code
const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});
const { logInfo } = require('../../operations/common/logging');
const { createContainer } = require('../../createContainer');
const { CommandLineParser } = require('./commandLineParser');
const moment = require('moment-timezone');
const { CopyToV3Runner } = require('../runners/copyToV3Runner.js');
const { AdminLogger } = require('../adminLogger');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main () {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();
    const adminLogger = new AdminLogger();
    if (!parameters.updatedAfter) {
        adminLogger.logInfo('UpdatedAfter is a required field.');
        process.exit(0);
    }
    const updatedAfter = moment(`${parameters.updatedAfter}`);
    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;
    const concurrentRunners = parameters.concurrentRunners || 1;
    const _idAbove = parameters._idAbove ? String(parameters._idAbove) : undefined;
    const collections = parameters.collections ? parameters.collections.split(',') : undefined;
    const startWithCollection = parameters.startWithCollection || undefined;
    adminLogger.logInfo(`Running script to update data with last_updated greater than ${updatedAfter.toISOString()}.`);

    // set up all the standard services in the container
    const container = createContainer();

    logInfo('Parameters', { parameters });
    // now add our class
    container.register(
        'processCopyToV3Runner',
        (c) =>
            new CopyToV3Runner({
                mongoDatabaseManager: c.mongoDatabaseManager,
                mongoCollectionManager: c.mongoCollectionManager,
                updatedAfter,
                batchSize,
                concurrentRunners,
                _idAbove,
                collections,
                startWithCollection,
                skipHistoryCollections: !!parameters.skipHistoryCollections,
                adminLogger
            })
    );

    /**
     * @type {CopyToV3Runner}
     */
    const processUpdateFhirRunner = container.processCopyToV3Runner;
    await processUpdateFhirRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * required env variables
 * V3_MONGO_URL, V3_MONGO_USERNAME, V3_MONGO_PASSWORD, V3_DB_NAME(default: fhir)
 * MONGO_URL, MONGO_USERNAME, MONGO_PASSWORD, MONGO_DB_NAME(default: fhir)
 * node src/admin/scripts/copyToV3.js --updatedAfter=2023-04-20 --batchSize=10000 --concurrentRunners=5 --_idAbove="1" --startWithCollection="Task_4_0_0"
 * node src/admin/scripts/copyToV3.js --updatedAfter=2023-04-20 --collections=Task_4_0_0 --skipHistoryCollections
 * node src/admin/scripts/copyToV3.js --updatedAfter=2023-04-20 --concurrentRunners=10
 */
main().catch((reason) => {
    console.error(reason);
});
