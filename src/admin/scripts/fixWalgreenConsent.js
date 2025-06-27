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
const { createContainer } = require('../../createContainer');
const { CommandLineParser } = require('./commandLineParser');
const { AdminLogger } = require('../adminLogger');
const { FixWalgreenConsentRunner } = require('../runners/fixWalgreenConsentRunner');
// const path = require("path");
// const dotenv = require("dotenv");

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

    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 10000;

    /**
     * @type {Date|undefined}
     */
    const afterLastUpdatedDate = parameters.after ? new Date(parameters.after) : undefined;

    /**
     * @type {Date|undefined}
     */
    const beforeLastUpdatedDate = parameters.before ? new Date(parameters.before) : undefined;

    const properties = parameters.properties
        ? parameters.properties.split(',').map(x => x.trim())
        : undefined;

    const adminLogger = new AdminLogger();
    adminLogger.logInfo(`[${currentDateTime}] Running script for fixing Consent}`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('fixWalgreenConsentRunner', (c) => new FixWalgreenConsentRunner(
            {
                mongoDatabaseManager: c.mongoDatabaseManager,
                adminLogger,
                batchSize,
                limit: parameters.limit,
                skip: parameters.skip,
                startFromId: parameters.startFromId,
                useTransaction: !!parameters.useTransaction,
                properties,
                afterLastUpdatedDate,
                beforeLastUpdatedDate
            }
        )
    );

    /**
     * @type {FixWalgreenConsentRunner}
     */
    const fixWalgreenConsentRunner = container.fixWalgreenConsentRunner;
    await fixWalgreenConsentRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/fixWalgreenConsent.js --collections=Practitioner_4_0_0 --batchSize=10000 --dotenv
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixWalgreenConsent.js --collections=all --batchSize=10000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixWalgreenConsent.js --collections=all --batchSize=10000 --startFromCollection FamilyMemberHistory_4_0_0
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixWalgreenConsent.js --collections=Person_4_0_0 --batchSize=10000 --useTransaction
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixWalgreenConsent.js --collections=Person_4_0_0 --batchSize=10000 --useTransaction --startFromId 123
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixWalgreenConsent.js --collections=Person_4_0_0 --batchSize=10000 --useTransaction --skip 200000
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixWalgreenConsent.js --collections=Person_4_0_0 --batchSize=10000 --limit 10
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixWalgreenConsent.js --collections=Person_4_0_0 --batchSize=10000 --limit 10 --properties
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixWalgreenConsent.js --collections=all --batchSize=10000 --after 2021-12-31
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/admin/scripts/fixWalgreenConsent.js --collections=all --batchSize=10000 --before 2021-12-31
 */
main().catch(reason => {
    console.error(reason);
});
