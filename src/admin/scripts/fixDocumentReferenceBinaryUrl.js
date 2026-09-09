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
const { FixDocumentReferenceBinaryUrlRunner } = require('../runners/fixDocumentReferenceBinaryUrlRunner');

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

    console.log(`[${currentDateTime}] Running DocumentReference Binary url backfill`);

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('fixDocumentReferenceBinaryUrlRunner', (c) => new FixDocumentReferenceBinaryUrlRunner(
            {
                batchSize,
                adminLogger: new AdminLogger(),
                mongoDatabaseManager: c.mongoDatabaseManager,
                limit: parameters.limit,
                skip: parameters.skip,
                useTransaction: !!parameters.useTransaction
            }
        )
    );

    /**
     * @type {FixDocumentReferenceBinaryUrlRunner}
     */
    const fixDocumentReferenceBinaryUrlRunner = container.fixDocumentReferenceBinaryUrlRunner;
    await fixDocumentReferenceBinaryUrlRunner.processAsync();

    console.log('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/admin/scripts/fixDocumentReferenceBinaryUrl.js --batchSize=10000
 * node --max-old-space-size=8192 src/admin/scripts/fixDocumentReferenceBinaryUrl.js --batchSize=10000
 * node --max-old-space-size=8192 src/admin/scripts/fixDocumentReferenceBinaryUrl.js --batchSize=10000 --limit 10   (dry run against a small sample)
 * node --max-old-space-size=8192 src/admin/scripts/fixDocumentReferenceBinaryUrl.js --batchSize=10000 --skip 200000
 * node --max-old-space-size=8192 src/admin/scripts/fixDocumentReferenceBinaryUrl.js --batchSize=10000 --useTransaction
 */
main().catch(reason => {
    console.error(reason);
});
