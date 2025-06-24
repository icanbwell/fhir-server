const { logInfo } = require('../../operations/common/logging');
const { createContainer } = require('../../createContainer');
const { DatabaseStats } = require('../runners/dbStatsRunner.js');
const { CommandLineParser } = require('./commandLineParser');
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
    const collections = parameters.collections ? parameters.collections.split(',') : undefined;
    adminLogger.logInfo('Running script to checks stats of databases -> total no. of documents, total no. of Documents in history table');

    // set up all the standard services in the container
    const container = createContainer();

    logInfo('Parameters', { parameters });
    // now add our class
    container.register(
        'processDatabaseStats',
        (c) =>
            new DatabaseStats({
                mongoDatabaseManager: c.mongoDatabaseManager,
                mongoCollectionManager: c.mongoCollectionManager,
                collections,
                adminLogger
            })
    );

    /**
     * @type {DatabaseStats}
     */
    const processDatabaseStats = container.processDatabaseStats;
    await processDatabaseStats.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * required env variables
 * MONGO_DB_NAME, MONGO_URL
 * node src/admin/scripts/dbStats.js --collections="Task_4_0_0,Patient_4_0_0"
 */
main().catch((reason) => {
    console.error(reason);
});
