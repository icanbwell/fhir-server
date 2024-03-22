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
const { GetMasterPatientUsageDataRunner } = require('../runners/getMasterPatientUsageDataRunner');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main () {
    const parameters = CommandLineParser.parseCommandLine();

    const collections = parameters.collections ? parameters.collections.split(',') : ['all'];

    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;

    const csvFileName = 'masterPatientUsage.csv';

    const adminLogger = new AdminLogger();

    const currentDateTime = new Date();
    adminLogger.logInfo(`[${currentDateTime}] Running getMasterPatientUsageDataRunner script`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('getMasterPatientUsageDataRunner', (c) => new GetMasterPatientUsageDataRunner({
        mongoCollectionManager: c.mongoCollectionManager,
        mongoDatabaseManager: c.mongoDatabaseManager,
        adminLogger,
        batchSize,
        databaseQueryFactory: c.databaseQueryFactory,
        collections,
        csvFileName
    }));

    /**
     * @type {GetMasterPatientUsageDataRunner}
     */
    const getMasterPatientUsageDataRunner = container.getMasterPatientUsageDataRunner;
    await getMasterPatientUsageDataRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/getMasterPatientUsageData.js
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getMasterPatientUsageData.js --collections Observation_4_0_0
 */
main().catch(reason => {
    console.error(reason);
});
