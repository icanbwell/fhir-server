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
const { createContainer } = require('../../../createContainer');
const { CommandLineParser } = require('../../../admin/scripts/commandLineParser');
const { AdminLogger } = require('../../../admin/adminLogger');
const { BulkDataExportRunner } = require('./bulkDataExportRunner');

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
    const exportStatusId = String(parameters.exportStatusId);

    if (!exportStatusId) {
        throw new Error('Cannot run Bulk export script without exportStatusId param');
    }

    const currentDateTime = new Date();

    const adminLogger = new AdminLogger();

    adminLogger.logInfo(
        `[${currentDateTime}] Running Bulk data export script for ${exportStatusId}`
    );

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register(
        'bulkDataExportRunner',
        (c) =>
            new BulkDataExportRunner({
                databaseQueryFactory: c.databaseQueryFactory,
                bulkExportManager: c.bulkExportManager,
                patientFilterManager: c.patientFilterManager,
                databaseAttachmentManager: c.databaseAttachmentManager,
                securityTagManager: c.securityTagManager,
                adminLogger,
                exportStatusId
            })
    );

    /**
     * @type {BulkDataExportRunner}
     */
    const bulkDataExportRunner = container.bulkDataExportRunner;
    await bulkDataExportRunner.processAsync();

    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/operations/export/script/bulkDataExport.js --exportStatusId=abee1b6a-90ee-4523-8429-f320e5da2886
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/operations/export/script/bulkDataExport.js --exportStatusId=abee1b6a-90ee-4523-8429-f320e5da2886
 */
main().catch((reason) => {
    console.error(reason);
});
