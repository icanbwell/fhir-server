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
const { CommandLineParser } = require('./commandLineParser');
const { AdminLogger } = require('../adminLogger');
const { FixCompositionRunner } = require('../runners/fixCompositionRunner');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main () {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();
    const currentDateTime = new Date();

    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 1000;

    const adminLogger = new AdminLogger();

    adminLogger.logInfo(`[${currentDateTime}] Running fixComposition script`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('fixCompositionRunner', (c) =>
        new FixCompositionRunner({
            mongoDatabaseManager: c.mongoDatabaseManager,
            databaseHistoryFactory: c.databaseHistoryFactory,
            batchSize,
            adminLogger
        })
    );

    /**
     * @type {FixCompositionRunner}
     */
    const fixCompositionRunner = container.fixCompositionRunner;
    await fixCompositionRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/fixComposition.js --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixComposition.js
 */
main().catch((reason) => {
    console.error(reason);
});
