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
async function main() {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();
    const adminLogger = new AdminLogger();
    if (!parameters.updatedAfter) {
        adminLogger.logInfo('UpdatedAfter is a required field.');
        process.exit(0);
    }
    const updatedAfter = new Date(`${parameters.updatedAfter}T00:00:00Z`);
    const readBatchSize = parameters.readBatchSize || process.env.BULK_BUFFER_SIZE || 10000;
    const concurrentRunners = parameters.concurrentRunners || 1;
    const _idAbove = parameters._idAbove ? String(parameters._idAbove) : undefined;
    const collections = parameters.collections ? parameters.collections.split(',') : undefined;
    const startWithCollection = parameters.startWithCollection || undefined;
    adminLogger.logInfo(`Running script to update data with last_updated greater than ${updatedAfter}`);

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
                updatedAfter: moment.utc(updatedAfter),
                readBatchSize,
                concurrentRunners,
                _idAbove,
                collections,
                startWithCollection,
                skipHistoryCollections: parameters.skipHistoryCollections ? true : false,
                adminLogger: adminLogger,
            })
    );

    /**
     * @type {PartitionAuditEventRunner}
     */
    const processUpdateFhirRunner = container.processCopyToV3Runner;
    await processUpdateFhirRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use 18.14.2
 * required env variables
 * V3_CLUSTER_USERNAME, V3_CLUSTER_PASSWORD, V3_CLUSTER_MONGO_URL, V3_CLUSTER_DB_NAME
 * SOURCE_CLUSTER_USERNAME, SOURCE_CLUSTER_PASSWORD, SOURCE_CLUSTER_MONGO_URL, SOURCE_DB_NAME
 * node src/admin/scripts/copyToV3.js --updatedAfter=2023-04-20 --readbatchSize=10000 --concurrentRunners=5 --_idAbove="1" --startWithCollection="Task_4_0_0"
 * node src/admin/scripts/copyToV3.js --updatedAfter=2023-04-20 --collections=Task_4_0_0 --skipHistoryCollections
 */
main().catch((reason) => {
    console.error(reason);
});
