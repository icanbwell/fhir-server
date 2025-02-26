const { MigrateToCloudStorageRunner } = require('./migrateToCloudStorageRunner');
const { logInfo, logError } = require('../../common/logging');
const { CommandLineParser } = require('../../../admin/scripts/commandLineParser');
const { createContainer } = require('../../../createContainer');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main() {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();
    const currentDateTime = new Date();

    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 100;

    logInfo(`[${currentDateTime}] Running migrateToCloudStorageRunner script`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register(
        'migrateToCloudStorageRunner',
        (c) =>
            new MigrateToCloudStorageRunner({
                mongoDatabaseManager: c.mongoDatabaseManager,
                collectionName: parameters.collection,
                batchSize,
                limit: parameters.limit,
                historyResourceCloudStorageClient: c.historyResourceCloudStorageClient,
                configManager: c.configManager
            })
    );

    /**
     * @type {MigrateToCloudStorageRunner}
     */
    const migrateToCloudStorageRunner = container.migrateToCloudStorageRunner;
    await migrateToCloudStorageRunner.processAsync();

    logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/operations/history/script/migrateToCloudStorage.js --batchSize=1000 --collection=Binary_4_0_0_History
 * node src/operations/history/script/migrateToCloudStorage.js --batchSize=1000 --collection=Binary_4_0_0_History --limit=100000
 */
main().catch((reason) => {
    logError(reason);
});
