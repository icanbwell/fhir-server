// load config from .env.  Should be first thing so env vars are available to rest of the code
const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv,
});
const { logInfo } = require('../../operations/common/logging');
const { createContainer } = require('../../createContainer');
const { CollectionStats } = require('../runners/collectionStatsRunner.js');
const { CommandLineParser } = require('./commandLineParser');
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
    const collections = parameters.collections ? parameters.collections.split(',') : undefined;
    console.log('Running script to checks stats of databases. \n 1. Total no. of Documents \n 2. Total no. of Documents in history table');

    // set up all the standard services in the container
    const container = createContainer();

    logInfo('Parameters', { parameters });
    // now add our class
    container.register(
        'processCollectionStats',
        (c) =>
            new CollectionStats({
                mongoDatabaseManager: c.mongoDatabaseManager,
                mongoCollectionManager: c.mongoCollectionManager,
                collections,
                adminLogger: new AdminLogger(),
            })
    );

    /**
     * @type {PartitionAuditEventRunner}
     */
    const processCollectionStats = container.processCollectionStats;
    await processCollectionStats.processAsync();

    console.log('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use 18.14.2
 * required env variables
 * MONGO_DB_NAME, MONGO_URL
 * node src/admin/scripts/collectionStats.js --collections="Task_4_0_0,Patient_4_0_0"
 */
main().catch((reason) => {
    console.error(reason);
});
