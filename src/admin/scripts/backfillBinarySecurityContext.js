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
    BackfillBinarySecurityContextRunner
} = require('../runners/backfillBinarySecurityContextRunner');

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

    const afterLastUpdatedDate = parameters.after ? new Date(parameters.after) : undefined;
    const beforeLastUpdatedDate = parameters.before ? new Date(parameters.before) : undefined;
    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 1000;
    // a real run is the default only with an explicit --dryRun false, so a bare invocation never writes
    const dryRun = parameters.dryRun === undefined ? true : String(parameters.dryRun) !== 'false';
    const adminLogger = new AdminLogger();

    adminLogger.logInfo(
        `[${currentDateTime}] Running backfillBinarySecurityContext script${dryRun ? ' (DRY RUN)' : ''}`
    );

    // set up all the standard services in the container
    const container = createContainer();

    container.register(
        'backfillBinarySecurityContextRunner',
        (c) =>
            new BackfillBinarySecurityContextRunner({
                mongoDatabaseManager: c.mongoDatabaseManager,
                batchSize,
                adminLogger,
                limit: parameters.limit,
                skip: parameters.skip,
                startFromId: parameters.startFromId,
                useTransaction: !!parameters.useTransaction,
                beforeLastUpdatedDate,
                afterLastUpdatedDate,
                dryRun,
                sleepMs: parameters.sleepMs
            })
    );

    /**
     * @type {BackfillBinarySecurityContextRunner}
     */
    const backfillBinarySecurityContextRunner = container.backfillBinarySecurityContextRunner;
    await backfillBinarySecurityContextRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * Sets Binary.securityContext on existing Binary from the subject (a Patient) of the DocumentReference that points at
 * them (design section 17). Only sets it where it is missing. Dry run by default.
 *
 * To run this:
 * nvm use
 * node src/admin/scripts/backfillBinarySecurityContext.js --limit=1000                                  (dry run)
 * node --max-old-space-size=8192 src/admin/scripts/backfillBinarySecurityContext.js --dryRun=false --batchSize=1000 --sleepMs=200
 * node --max-old-space-size=8192 src/admin/scripts/backfillBinarySecurityContext.js --dryRun=false --startFromId=<DocumentReference _id>
 * node --max-old-space-size=8192 src/admin/scripts/backfillBinarySecurityContext.js --dryRun=false --after=2024-01-01 --before=2024-02-01
 *
 * --sleepMs pauses that long after every --batchSize DocumentReferences. --startFromId resumes from the last
 * DocumentReference _id printed in the progress/summary log.
 */
console.log('Running main');
main().catch((reason) => {
    console.error(reason);
    process.exit(1);
});
