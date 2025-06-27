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
const { FixInstantDataTypeRunner } = require('../runners/fixInstantDataTypeRunner');

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
    /**
     * @type {string[]}
     */
    const collections = parameters.collections
        ? parameters.collections.split(',').map(x => x.trim())
        : ['all'];

    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 1000;

    const adminLogger = new AdminLogger();

    adminLogger.logInfo(`[${currentDateTime}] Running fixInstantDataType script`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('fixInstantDataTypeRunner', (c) => new FixInstantDataTypeRunner(
        {
            mongoDatabaseManager: c.mongoDatabaseManager,
            collections,
            batchSize,
            adminLogger,
            startFromCollection: parameters.startFromCollection,
            limit: parameters.limit,
            useTransaction: !!parameters.useTransaction,
            skip: parameters.skip,
            startFromId: parameters.startFromId
        }
    )
    );

    /**
     * @type {FixInstantDataTypeRunner}
     */
    const fixInstantDataTypeRunner = container.fixInstantDataTypeRunner;
    await fixInstantDataTypeRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/fixInstantDataType.js --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixInstantDataType.js --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixInstantDataType.js --collections=Person_4_0_0 --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixInstantDataType.js --batchSize=10000 --startFromCollection Person_4_0_0
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixInstantDataType.js --collections=all --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixInstantDataType.js --batchSize=10000 --useTransaction
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixInstantDataType.js --preLoadCollections=Patient_4_0_0 --batchSize=10000 --useTransaction
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixInstantDataType.js --batchSize=10000 --useTransaction --startFromId=123
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixInstantDataType.js --batchSize=10000 --useTransaction --skip 200000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixInstantDataType.js --batchSize=10000 --limit 10
 */
main().catch(reason => {
    console.error(reason);
});
