const { createContainer } = require('../createContainer');
const { CronJobRunner } = require('./cronJobRunner');
const { logInfo, logError } = require('../operations/common/logging');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main() {
    const currentDateTime = new Date();

    logInfo(
        `[${currentDateTime}] Running cron job script runner`
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
                exportManager: c.exportManager,
                configManager: c.configManager,
                postSaveProcessor: c.postSaveProcessor,
                bulkExportEventProducer: c.bulkExportEventProducer,
                k8sClient: c.k8sClient
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
