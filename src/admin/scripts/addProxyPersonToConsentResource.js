// load config from .env.  Should be first thing so env vars are available to rest of the code
const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv,
});
console.log(`Reading config from ${pathToEnv}`);
console.log(`MONGO_URL=${process.env.MONGO_URL}`);
const { createContainer } = require('../../createContainer');
const { CommandLineParser } = require('./commandLineParser');
const { AdminLogger } = require('../adminLogger');
const {
    AddProxyPatientToConsentResourceRunner,
} = require('../runners/addProxyPatientToConsentResource');

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
    let collections = parameters.collections ? parameters.collections.split(',').map((x) => x.trim())
        // fallback to Consent Resource only
        : ['Consent_4_0_0'];

    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;
    const adminLogger = new AdminLogger();

    adminLogger.logInfo(`[${currentDateTime}] Running addProxyPatientToConsentResource script`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register(
        'addProxyPatientToConsentResourceRunner',
        (c) =>
            new AddProxyPatientToConsentResourceRunner({
                mongoCollectionManager: c.mongoCollectionManager,
                mongoDatabaseManager: c.mongoDatabaseManager,
                collections,
                batchSize,
                adminLogger,
                limit: parameters.limit,
                skip: parameters.skip,
                startFromId: parameters.startFromId,
                useTransaction: parameters.useTransaction ? true : false,
                bwellPersonFinder: c.bwellPersonFinder,
                preSaveManager: c.preSaveManager,
            })
    );

    /**
     * @type {ChangeSourceAssigningAuthorityRunner}
     */
    const addProxyPatientToConsentResourceRunner = container.addProxyPatientToConsentResourceRunner;
    await addProxyPatientToConsentResourceRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/changeSourceAssigningAuthority.js --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/addProxyPersonToConsentResource.js --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/addProxyPersonToConsentResource.js --collections=Consent_4_0_0 --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/addProxyPersonToConsentResource.js --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/addProxyPersonToConsentResource.js --collections=all --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/addProxyPersonToConsentResource.js --batchSize=10000 --useTransaction
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/addProxyPersonToConsentResource.js --batchSize=10000 --useTransaction --startFromId=123
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/addProxyPersonToConsentResource.js --batchSize=10000 --useTransaction --skip 200000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/addProxyPersonToConsentResource.js --batchSize=10000 --limit 10
 */
console.log('Running main');
main().catch((reason) => {
    console.error(reason);
});
