// load config from .env.  Should be first thing so env vars are available to rest of the code
const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv,
});
console.log(`Reading config from ${pathToEnv}`);
console.log(`MONGO_URL=${process.env.MONGO_URL}`);
console.log(`AUDIT_EVENT_MONGO_URL=${process.env.AUDIT_EVENT_MONGO_URL}`);
const { createContainer } = require('../../createContainer');
const { CommandLineParser } = require('./commandLineParser');
const { AdminLogger } = require('../adminLogger');
const { FixPersonLinksRunner } = require('../runners/fixPersonLinksRunner');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main() {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();
    let currentDateTime = new Date();
    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;
    /**
     * @type {Date|undefined}
     */
    const beforeLastUpdatedDate = parameters.before ? new Date(parameters.before) : undefined;
    console.log(`[${currentDateTime}] ` + 'Running script for Person_4_0_0');

    let preLoadCollections = parameters.preLoadCollections ?
        parameters.preLoadCollections.split(',').map(x => x.trim()) :
        [];

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('fixPersonLinksRunner', (c) => new FixPersonLinksRunner(
        {
            mongoCollectionManager: c.mongoCollectionManager,
            batchSize,
            beforeLastUpdatedDate,
            adminLogger: new AdminLogger(),
            mongoDatabaseManager: c.mongoDatabaseManager,
            resourceLocatorFactory: c.resourceLocatorFactory,
            preSaveManager: c.preSaveManager,
            databaseQueryFactory: c.databaseQueryFactory,
            preloadCollections: preLoadCollections,
            limit: parameters.limit,
            skip: parameters.skip,
            minLinks: parameters.minLinks,
        },
        ),
    );

    /**
     * @type {fixPersonLinksRunner}
     */
    const fixPersonLinksRunner = container.fixPersonLinksRunner;
    await fixPersonLinksRunner.processAsync();

    console.log('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/fixPersonLinks.js --batchSize=10000 --preLoadCollections Person_4_0_0
 * node src/admin/scripts/fixPersonLinks.js --batchSize=10000 --minLinks 20 --0 Person_4_0_0
 */
main().catch(reason => {
    console.error(reason);
});
