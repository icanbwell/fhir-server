if (process.argv.includes('--dotenv')) {
    const path = require('path');
    const dotenv = require('dotenv');
    const pathToEnv = path.resolve(__dirname, '.env');
    dotenv.config({
        path: pathToEnv
    });
    console.log(`Reading config from ${pathToEnv}`);
}
console.log(`MONGO_URL=${process.env.MONGO_URL}`);
const {createContainer} = require('../../createContainer');
const {CommandLineParser} = require('./commandLineParser');
const {AdminLogger} = require('../adminLogger');
const {GetMultipleUuidCountRunner} = require('../runners/getMultipleUuidCountRunner');

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
    let collections = parameters.collections ?
        parameters.collections.split(',').map(x => x.trim()) :
        ['all'];

    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;

    const adminLogger = new AdminLogger();
    adminLogger.logInfo(`[${currentDateTime}] Running script for collections: ${collections.join(',')}`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('getMultipleUuidCountRunner', (c) => new GetMultipleUuidCountRunner(
            {
                mongoCollectionManager: c.mongoCollectionManager,
                mongoDatabaseManager: c.mongoDatabaseManager,
                adminLogger,
                batchSize,
                collections,
                startFromCollection: parameters.startFromCollection,
            }
        )
    );

    /**
     * @type {getMultipleUuidCountRunner}
     */
    const getMultipleUuidCountRunner = container.getMultipleUuidCountRunner;
    await getMultipleUuidCountRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/getMultipleUuidCount.js --collections=Practitioner_4_0_0 --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getMultipleUuidCount.js --collections=all --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/getMultipleUuidCount.js --collections=all --batchSize=10000 --startFromCollection FamilyMemberHistory_4_0_0
 * node src/admin/scripts/getMultipleUuidCount.js --collections=Account_4_0_0 --batchSize=10000
 */
main().catch(reason => {
    console.error(reason);
});
