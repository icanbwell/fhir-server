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
const { UpdateCollectionsRunner } = require('../runners/updateCollectionsRunner.js');
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
    const updatedBefore = parameters.updatedBefore ? new Date(`${parameters.updatedBefore}T00:00:00Z`) : new Date(2023, 3 - 1, 14);
    const readBatchSize = parameters.readBatchSize || process.env.BULK_BUFFER_SIZE || 10000;
    const concurrentRunners = parameters.concurrentRunners || 1;
    const _idAbove = parameters._idAbove ? String(parameters._idAbove) : undefined;
    const collections = parameters.collections ? parameters.collections.split(',') : undefined;
    const startWithCollection = parameters.startWithCollection || undefined;
    adminLogger.logInfo(`Running script to update data with last_updated greater than ${updatedBefore}`);

    // set up all the standard services in the container
    const container = createContainer();

    logInfo('Parameters', { parameters });
    // now add our class
    container.register(
        'processUpdateFhirRunner',
        (c) =>
            new UpdateCollectionsRunner({
                mongoDatabaseManager: c.mongoDatabaseManager,
                updatedBefore: moment.utc(updatedBefore),
                readBatchSize,
                concurrentRunners,
                _idAbove,
                collections,
                startWithCollection,
                skipHistoryCollections: !!parameters.skipHistoryCollections,
                adminLogger
            })
    );

    /**
     * @type {UpdateCollectionsRunner}
     */
    const processUpdateFhirRunner = container.processUpdateFhirRunner;
    await processUpdateFhirRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * required env variables
 * TARGET_CLUSTER_USERNAME, TARGET_CLUSTER_PASSWORD, TARGET_CLUSTER_MONGO_URL, TARGET_DB_NAME
 * SOURCE_CLUSTER_USERNAME, SOURCE_CLUSTER_PASSWORD, SOURCE_CLUSTER_MONGO_URL, SOURCE_DB_NAME
 * node src/admin/scripts/updateCollections.js --updatedBefore=2023-03-14 --readbatchSize=10000 --concurrentRunners=5 --_idAbove="1" --startWithCollection="Task_4_0_0"
 * node src/admin/scripts/updateCollections.js --updatedBefore=2023-03-14 --collections=Task_4_0_0 --skipHistoryCollections
 */
main().catch((reason) => {
    console.error(reason);
});
