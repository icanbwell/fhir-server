const { createContainer } = require('../../createContainer');
const { CommandLineParser } = require('./commandLineParser');
const { AdminLogger } = require('../adminLogger');
const { FixMultipleOwnerTagsRunner } = require('../runners/fixMultipleOwnerTagsRunner');
const {
    MigrateHistoryToCloudStorageRunner
} = require('../runners/migrateHistoryToCloudStorageRunner');

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

    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 1000;

    const adminLogger = new AdminLogger();

    adminLogger.logInfo(`[${currentDateTime}] Running migrateHistoryToCloudStorageRunner script`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register(
        'migrateHistoryToCloudStorageRunner',
        (c) =>
            new MigrateHistoryToCloudStorageRunner({
                mongoCollectionManager: c.mongoCollectionManager,
                mongoDatabaseManager: c.mongoDatabaseManager,
                collectionName: parameters.collection,
                batchSize,
                adminLogger,
                limit: parameters.limit,
                startAfterId: parameters.startAfterId,
                historyResourceCloudStorageClient: c.historyResourceCloudStorageClient,
                configManager: c.configManager
            })
    );

    /**
     * @type {FixMultipleOwnerTagsRunner}
     */
    const migrateHistoryToCloudStorageRunner = container.migrateHistoryToCloudStorageRunner;
    await migrateHistoryToCloudStorageRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/migrateHistoryToCloudStorage.js --batchSize=1000 --collection=Binary_4_0_0_History
 * node src/admin/scripts/migrateHistoryToCloudStorage.js --batchSize=1000 --collection=Binary_4_0_0_History --limit=100000 --startAfterId=67b3730e0c1612400384e36a
 */
main().catch((reason) => {
    console.error(reason);
});
