// load config from .env.  Should be first thing so env vars are available to rest of the code
const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});
console.log(`Reading config from ${pathToEnv}`);
console.log(`MONGO_URL=${process.env.MONGO_URL}`);
console.log(`AUDIT_EVENT_MONGO_URL=${process.env.AUDIT_EVENT_MONGO_URL}`);
const {createContainer} = require('../../createContainer');
const {CommandLineParser} = require('./commandLineParser');
const {AdminLogger} = require('../adminLogger');
const {FixMultipleSourceAssigningAuthorityHistoryRunner} = require('../runners/fixMultipleSourceAssigningAuthorityHistoryRunner');

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
    /**
     * @type {string[]}
     */
    let collections = parameters.collections ? parameters.collections.split(',').map(x => x.trim()) : [];
    if (parameters.collections === 'all') {
        collections = ['all'];
    }
    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;

    console.log(`[${currentDateTime}] ` +
        `Running script for collections: ${collections.join(',')}`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('fixMultipleSourceAssigningAuthorityHistoryRunner', (c) => new FixMultipleSourceAssigningAuthorityHistoryRunner(
            {
                mongoCollectionManager: c.mongoCollectionManager,
                collections: collections,
                batchSize,
                adminLogger: new AdminLogger(),
                mongoDatabaseManager: c.mongoDatabaseManager,
                preSaveManager: c.preSaveManager,
                startFromCollection: parameters.startFromCollection,
                skipIfResourcePresent: parameters.skipIfResourcePresent
            }
        )
    );

    /**
     * @type {FixMultipleSourceAssigningAuthorityHistoryRunner}
     */
    const fixMultipleSourceAssigningAuthorityHistoryRunner = container.fixMultipleSourceAssigningAuthorityHistoryRunner;
    await fixMultipleSourceAssigningAuthorityHistoryRunner.processAsync();

    console.log('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use 18.16.0
 * node src/admin/scripts/fixMultipleSourceAssigningAuthorityHistory.js --collections=Practitioner_4_0_0_History --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixMultipleSourceAssigningAuthorityHistory.js --collections=all --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixMultipleSourceAssigningAuthorityHistory.js --collections=all --batchSize=10000 --startFromCollection Practitioner_4_0_0
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixMultipleSourceAssigningAuthorityHistory.js --collections=all --batchSize=10000 --startFromCollection Practitioner_4_0_0 --skipIfResourcePresent
 * node src/admin/scripts/fixMultipleSourceAssigningAuthorityHistory.js --collections=Account_4_0_0_History --batchSize=10000
 */
main().catch(reason => {
    console.error(reason);
});
