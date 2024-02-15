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
const { FixBwellMasterPersonReferenceRunner } = require('../runners/fixBwellMasterPersonReferenceRunner');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main() {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();
    const currentDateTime = new Date();
    /**
     * @type {string[]}
     */
    const collections = parameters.collections ?
        parameters.collections.split(',').map(x => x.trim()) :
        ['all'];

    /**
     * @type {string[]}
     */
    const preLoadCollections = parameters.preLoadCollections ?
        parameters.preLoadCollections.split(',').map(x => x.trim()) :
        ['all'];

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

    adminLogger.logInfo(`[${currentDateTime}] Running fixBwellMasterPersonReference script`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('fixBwellMasterPersonReferenceRunner', (c) => new FixBwellMasterPersonReferenceRunner(
        {
            mongoCollectionManager: c.mongoCollectionManager,
            mongoDatabaseManager: c.mongoDatabaseManager,
            preSaveManager: c.preSaveManager,
            databaseQueryFactory: c.databaseQueryFactory,
            resourceLocatorFactory: c.resourceLocatorFactory,
            resourceMerger: c.resourceMerger,
            collections,
            preLoadCollections,
            batchSize,
            afterLastUpdatedDate,
            beforeLastUpdatedDate,
            adminLogger,
            startFromCollection: parameters.startFromCollection,
            limit: parameters.limit,
            useTransaction: parameters.useTransaction ? true : false,
            skip: parameters.skip,
            startFromId: parameters.startFromId,
            logUnresolvedReferencesToFile: parameters.logUnresolvedReferencesToFile ? true : false
        }
    )
    );

    /**
     * @type {fixBwellMasterPersonReferenceRunner}
     */
    const fixBwellMasterPersonReferenceRunner = container.fixBwellMasterPersonReferenceRunner;
    await fixBwellMasterPersonReferenceRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/fixBwellMasterPersonReference.js --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixBwellMasterPersonReference.js --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixBwellMasterPersonReference.js --collections=Person_4_0_0 --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixBwellMasterPersonReference.js --batchSize=10000 --startFromCollection Person_4_0_0
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixBwellMasterPersonReference.js --collections=all --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixBwellMasterPersonReference.js --batchSize=10000 --logUnresolvedReferencesToFile
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixBwellMasterPersonReference.js --batchSize=10000 --useTransaction
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixBwellMasterPersonReference.js --preLoadCollections=Patient_4_0_0 --batchSize=10000 --useTransaction
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixBwellMasterPersonReference.js --batchSize=10000 --useTransaction --startFromId=123
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixBwellMasterPersonReference.js --batchSize=10000 --useTransaction --skip 200000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixBwellMasterPersonReference.js --batchSize=10000 --limit 10
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixBwellMasterPersonReference.js --batchSize=10000 --after 2021-12-31
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixBwellMasterPersonReference.js --batchSize=10000 --before 2021-12-31
 */
main().catch(reason => {
    console.error(reason);
});
