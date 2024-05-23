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
const { GetIncompatibleResourcesRunner } = require('../runners/getIncompatibleResourcesRunner');

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
    const collections = parameters.collections
        ? parameters.collections.split(',').map((x) => x.trim())
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
    adminLogger.logInfo(
        `[${currentDateTime}] Running script for collections: ${collections.join(',')}`
    );

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register(
        'getIncompatibleResourcesRunner',
        (c) =>
            new GetIncompatibleResourcesRunner({
                mongoCollectionManager: c.mongoCollectionManager,
                mongoDatabaseManager: c.mongoDatabaseManager,
                databaseQueryFactory: c.databaseQueryFactory,
                adminLogger,
                batchSize,
                collections,
                startFromCollection: parameters.startFromCollection,
                limit: parameters.limit,
                skip: parameters.skip,
                startFromId: parameters.startFromId,
                afterLastUpdatedDate,
                beforeLastUpdatedDate
            })
    );

    /**
     * @type {GetIncompatibleResourcesRunner}
     */
    const getIncompatibleResourcesRunner = container.getIncompatibleResourcesRunner;
    await getIncompatibleResourcesRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/getIncompatibleResources.js --collections=Practitioner_4_0_0 --batchSize=10000 --dotenv
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getIncompatibleResources.js --collections=all --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getIncompatibleResources.js --collections=all --batchSize=10000 --startFromCollection FamilyMemberHistory_4_0_0
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getIncompatibleResources.js --collections=Person_4_0_0 --batchSize=10000 --startFromId 123
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getIncompatibleResources.js --collections=Person_4_0_0 --batchSize=10000 --skip 200000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getIncompatibleResources.js --collections=Person_4_0_0 --batchSize=10000 --limit 10
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getIncompatibleResources.js --collections=all --batchSize=10000 --after 2021-12-31
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getIncompatibleResources.js --collections=all --batchSize=10000 --before 2021-12-31
 */
main().catch((reason) => {
    console.error(reason);
});
