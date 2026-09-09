const { createContainer } = require('../../createContainer');
const { CommandLineParser } = require('./commandLineParser');
const { AdminLogger } = require('../adminLogger');
const {
    MigrateBinaryDataToCloudStorageRunner
} = require('../runners/migrateBinaryDataToCloudStorageRunner');

async function main () {
    const parameters = CommandLineParser.parseCommandLine();
    const currentDateTime = new Date();

    const adminLogger = new AdminLogger();

    adminLogger.logInfo(`[${currentDateTime}] Running migrateBinaryDataToCloudStorageRunner script`);

    const container = createContainer();

    const batchSize = parameters.batchSize || 1000;
    const concurrency = parameters.concurrency || 10;
    const thresholdKB = parameters.thresholdKB !== undefined
        ? parameters.thresholdKB
        : container.configManager.base64FieldDataThresholdKB;
    const dryRun = parameters.dryRun || false;
    const uuids = parameters.ids
        ? parameters.ids.split(',').map((u) => u.trim()).filter(Boolean)
        : undefined;

    container.register(
        'migrateBinaryDataToCloudStorageRunner',
        (c) =>
            new MigrateBinaryDataToCloudStorageRunner({
                mongoDatabaseManager: c.mongoDatabaseManager,
                adminLogger,
                batchSize,
                concurrency,
                thresholdKB,
                startId: parameters.startId,
                count: parameters.count,
                fromDate: parameters.fromDate,
                toDate: parameters.toDate,
                uuids,
                dryRun,
                base64FieldCloudStorageClient: c.base64FieldCloudStorageClient,
                configManager: c.configManager
            })
    );

    /**
     * @type {MigrateBinaryDataToCloudStorageRunner}
     */
    const migrateBinaryDataToCloudStorageRunner = container.migrateBinaryDataToCloudStorageRunner;
    await migrateBinaryDataToCloudStorageRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/migrateBinaryDataToCloudStorage.js --batchSize=1000 --concurrency=10 --dryRun
 * node src/admin/scripts/migrateBinaryDataToCloudStorage.js --batchSize=1000 --concurrency=10 --thresholdKB=64 --startId=<mongoObjectId>
 * node src/admin/scripts/migrateBinaryDataToCloudStorage.js --fromDate=2024-01-01 --toDate=2024-06-01 --count=100000
 * node src/admin/scripts/migrateBinaryDataToCloudStorage.js --ids=<uuid1>,<uuid2>,<uuid3>
 *
 * --ids retries only the given _uuid's (e.g. the ones a prior run's summary logged as "failed") —
 * it's ANDed with the normal eligibility filters, so an id that's already migrated or no longer
 * inline is safely skipped and reported rather than reprocessed.
 */
main().catch((reason) => {
    console.error(reason);
});
