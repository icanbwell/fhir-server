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
const { ProaPersonPatientLinkageRunner } = require('../runners/proaPersonPatientLinkageRunner');

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
    const afterLastUpdatedDate = parameters.after ? new Date(parameters.after) : undefined;

    /**
     * @type {Date|undefined}
     */
    const beforeLastUpdatedDate = parameters.before ? new Date(parameters.before) : undefined;

    const adminLogger = new AdminLogger();

    adminLogger.logInfo(`[${currentDateTime}] Running proaPersonPatientLinkageReference script`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('proaPersonPatientLinkageRunner', (c) => new ProaPersonPatientLinkageRunner(
        {
            personMatchManager: c.personMatchManager,
            mongoCollectionManager: c.mongoCollectionManager,
            mongoDatabaseManager: c.mongoDatabaseManager,
            preSaveManager: c.preSaveManager,
            batchSize,
            databaseQueryFactory: c.databaseQueryFactory,
            resourceLocatorFactory: c.resourceLocatorFactory,
            resourceMerger: c.resourceMerger,
            afterLastUpdatedDate,
            beforeLastUpdatedDate,
            adminLogger,
            limit: parameters.limit,
            useTransaction: parameters.useTransaction ? true : false,
            skip: parameters.skip
        }
    )
    );

    /**
     * @type {ProaPersonPatientLinkageRunner}
     */
    const proaPersonPatientLinkageRunner = container.proaPersonPatientLinkageRunner;
    await proaPersonPatientLinkageRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/proaPersonPatientLinkage.js
 */
main().catch(reason => {
    console.error(reason);
});
