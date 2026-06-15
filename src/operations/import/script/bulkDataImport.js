// Disable OTEL instrumentation for this script
process.env.OTEL_SDK_DISABLED = 'true';

const { createContainer } = require('../../../createContainer');
const { CommandLineParser } = require('../../../admin/scripts/commandLineParser');
const { BulkDataImportRunner } = require('./bulkDataImportRunner');
const { logInfo, logError } = require('../../common/logging');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main() {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();

    /**
     * @type {string}
     */
    const importStatusId = String(parameters.importStatusId);

    if (!importStatusId) {
        throw new Error('Cannot run Bulk import script without importStatusId param');
    }

    const awsRegion = parameters.awsRegion;

    const currentDateTime = new Date();

    logInfo(
        `[${currentDateTime}] Running Bulk data import script`,
        { importStatusId }
    );

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register(
        'bulkDataImportRunner',
        (c) =>
            new BulkDataImportRunner({
                databaseImportManager: c.databaseImportManager,
                importStatusId,
                awsRegion,
                requestId: parameters.requestId
            })
    );

    /**
     * @type {BulkDataImportRunner}
     */
    const bulkDataImportRunner = container.bulkDataImportRunner;
    await bulkDataImportRunner.processAsync();

    logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/operations/import/script/bulkDataImport.js --importStatusId=<uuid> --awsRegion=us-east-1 --requestId=<requestId>
 */
main().catch((reason) => {
    logError(reason);
    process.exit(1);
});
