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
const { GetIdSourceIdMismatchCountRunner } = require('../runners/getIdSourceIdMismatchCountRunner');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main () {
    const parameters = CommandLineParser.parseCommandLine();

    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;

    const adminLogger = new AdminLogger();

    const currentDateTime = new Date();
    adminLogger.logInfo(`[${currentDateTime}] Running getIdSourceIdMismatchCountRunner script`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('getIdSourceIdMismatchCountRunner', (c) => new GetIdSourceIdMismatchCountRunner({
        mongoDatabaseManager: c.mongoDatabaseManager,
        adminLogger,
        batchSize
    }));

    /**
     * @type {GetIdSourceIdMismatchCountRunner}
     */
    const getIdSourceIdMismatchCountRunner = container.getIdSourceIdMismatchCountRunner;
    await getIdSourceIdMismatchCountRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/getIdSourceIdMismatchCount.js
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getIdSourceIdMismatchCount.js
 */
main().catch(reason => {
    console.error(reason);
});
