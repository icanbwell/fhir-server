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
const { ChangeSourceAssigningAuthorityRunner } = require('../runners/changeSourceAssigningAuthorityRunner');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main () {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();
    /**
     * @type {string}
     */
    const oldSourceAssigningAuthority = parameters.oldSourceAssigningAuthority;
    if (!oldSourceAssigningAuthority) {
        throw Error('oldSourceAssigningAuthority is a required parameter');
    }
    /**
     * @type {string}
     */
    const newSourceAssigningAuthority = parameters.newSourceAssigningAuthority;
    if (!newSourceAssigningAuthority) {
        throw Error('newSourceAssigningAuthority is a required parameter');
    }
    const currentDateTime = new Date();
    /**
     * @type {string[]}
     */
    const collections = parameters.collections
        ? parameters.collections.split(',').map(x => x.trim())
        : ['all'];

    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;
    /**
     * @type {Date|undefined}
     */
    const afterLastUpdatedDate = parameters.after ? new Date(parameters.after) : undefined;

    /**
     * @type {Date|undefined}
     */
    const beforeLastUpdatedDate = parameters.before ? new Date(parameters.before) : undefined;

    const adminLogger = new AdminLogger();

    adminLogger.logInfo(`[${currentDateTime}] Running changeSourceAssigningAuthority script`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('changeSourceAssigningAuthorityRunner', (c) => new ChangeSourceAssigningAuthorityRunner(
        {
            mongoDatabaseManager: c.mongoDatabaseManager,
            preSaveManager: c.preSaveManager,
            databaseQueryFactory: c.databaseQueryFactory,
            resourceLocatorFactory: c.resourceLocatorFactory,
            resourceMerger: c.resourceMerger,
            collections,
            batchSize,
            afterLastUpdatedDate,
            beforeLastUpdatedDate,
            adminLogger,
            startFromCollection: parameters.startFromCollection,
            limit: parameters.limit,
            useTransaction: !!parameters.useTransaction,
            skip: parameters.skip,
            startFromId: parameters.startFromId,
            oldSourceAssigningAuthority,
            newSourceAssigningAuthority,
            searchParametersManager: c.searchParametersManager
        }
    )
    );

    /**
     * @type {ChangeSourceAssigningAuthorityRunner}
     */
    const changeSourceAssigningAuthorityRunner = container.changeSourceAssigningAuthorityRunner;
    await changeSourceAssigningAuthorityRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/changeSourceAssigningAuthority.js --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/changeSourceAssigningAuthority.js --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/changeSourceAssigningAuthority.js --collections=Person_4_0_0 --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/changeSourceAssigningAuthority.js --batchSize=10000 --startFromCollection Person_4_0_0
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/changeSourceAssigningAuthority.js --collections=all --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/changeSourceAssigningAuthority.js --batchSize=10000 --useTransaction
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/changeSourceAssigningAuthority.js --preLoadCollections=Patient_4_0_0 --batchSize=10000 --useTransaction
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/changeSourceAssigningAuthority.js --batchSize=10000 --useTransaction --startFromId=123
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/changeSourceAssigningAuthority.js --batchSize=10000 --useTransaction --skip 200000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/changeSourceAssigningAuthority.js --batchSize=10000 --limit 10
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/changeSourceAssigningAuthority.js --batchSize=10000 --after 2021-12-31
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/changeSourceAssigningAuthority.js --batchSize=10000 --before 2021-12-31
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/changeSourceAssigningAuthority.js --batchSize=10000 --oldSourceAssigningAuthority=client --newSourceAssigningAuthority=new_client
 */
main().catch(reason => {
    console.error(reason);
});
