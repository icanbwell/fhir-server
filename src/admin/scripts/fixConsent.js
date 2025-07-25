// load config from .env.  Should be first thing so env vars are available to rest of the code
if (process.argv.includes('--dotenv')) {
    const path = require('path');
    const dotenv = require('dotenv');
    const pathToEnv = path.resolve(__dirname, '.env');
    dotenv.config({
        path: pathToEnv
    });
    console.log(`Reading config from ${pathToEnv}`);
}
const { createContainer } = require('../../createContainer');
const { CommandLineParser } = require('./commandLineParser');
const { AdminLogger } = require('../adminLogger');
const {
    FixConsentRunner
} = require('../runners/fixConsentRunner');

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
     * @type {Date|undefined}
     */
    const afterLastUpdatedDate = parameters.after ? new Date(parameters.after) : undefined;

    /**
     * @type {Date|undefined}
     */
    const beforeLastUpdatedDate = parameters.before ? new Date(parameters.before) : undefined;

    /**
     * @type {string[]}
     */
    const collections = ['Consent_4_0_0'];

    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;
    const adminLogger = new AdminLogger();

    adminLogger.logInfo(`[${currentDateTime}] Running fixConsent script`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register(
        'fixConsentRunner',
        (c) =>
            new FixConsentRunner({
                mongoDatabaseManager: c.mongoDatabaseManager,
                collections,
                batchSize,
                adminLogger,
                limit: parameters.limit,
                skip: parameters.skip,
                startFromId: parameters.startFromId,
                useTransaction: !!parameters.useTransaction,
                bwellPersonFinder: c.bwellPersonFinder,
                preSaveManager: c.preSaveManager,
                beforeLastUpdatedDate,
                afterLastUpdatedDate
            })
    );

    /**
     * @type {FixConsentRunner}
     */
    const fixConsentRunner = container.fixConsentRunner;
    await fixConsentRunner.processAsync();

    adminLogger.logInfo('Exiting process fixConsent');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/fixConsent.js --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixConsent.js --batchSize=10000 --dotenv
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixConsent.js --batchSize=10000 --limit 10 --before 2023-10-28 --dotenv
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixConsent.js --batchSize=10000 --limit 10 --after 2023-10-28 --dotenv
 */
console.log('Running main');
main().catch((reason) => {
    console.error(reason);
});
