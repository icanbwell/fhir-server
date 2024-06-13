const { createContainer } = require('../../../createContainer');
const { CommandLineParser } = require('../../../admin/scripts/commandLineParser');
const { CronJobRunner } = require('./cronJobRunner');
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

    const currentDateTime = new Date();

    logInfo(
        `[${currentDateTime}] Running cron job script to update status of ExportStatus resources & export data`
    );

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register(
        'cronJobRunner',
        (c) =>
            new CronJobRunner({
                databaseQueryFactory: c.databaseQueryFactory,
                databaseExportManager: c.databaseExportManager,
                k8sClient: c.k8sClient,
                configManager: c.configManager
            })
    );

    /**
     * @type {CronJobRunner}
     */
    const cronJobRunner = container.cronJobRunner;
    await cronJobRunner.processAsync();

    logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/operations/export/script/cronJob.js
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/operations/export/script/cronJob.js
 */
main().catch((reason) => {
    logError(reason);
    process.exit(1);
});
