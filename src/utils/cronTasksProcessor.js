const { CronJob, validateCronExpression } = require('cron');
const { assertTypeEquals } = require('./assertType');
const { logInfo, logError } = require('../operations/common/logging');
const { ConfigManager } = require('./configManager');
const { AccessLogger } = require('./accessLogger');
const { PostSaveProcessor } = require('../dataLayer/postSaveProcessor');
const { AuditLogger } = require('./auditLogger');

class CronTasksProcessor {
    /**
     * constructor
     * @typedef {Object} params
     * @property {PostSaveProcessor} postSaveProcessor
     * @property {AuditLogger} auditLogger
     * @property {AccessLogger} accessLogger
     * @property {ConfigManager} configManager
     * @param {params} params
     */
    constructor({ postSaveProcessor, auditLogger, accessLogger, configManager }) {
        assertTypeEquals(postSaveProcessor, PostSaveProcessor);
        assertTypeEquals(auditLogger, AuditLogger);
        assertTypeEquals(accessLogger, AccessLogger);
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {PostSaveProcessor}
         */
        this.postSaveProcessor = postSaveProcessor;
        /**
         * @type {AuditLogger}
         */
        this.auditLogger = auditLogger;
        /**
         * @type {AccessLogger}
         */
        this.accessLogger = accessLogger;
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
    }

    async initiateTasks() {
        // Validate cron expression
        const validation = validateCronExpression(this.configManager.postRequestFlushTime);
        if (!validation.valid) {
            logError(`Invalid cron expression: ${this.configManager.postRequestFlushTime}`);
            throw validation.error;
        }

        const cronJob = CronJob.from({
            name: 'CronTasksProcessor',
            cronTime: this.configManager.postRequestFlushTime,
            onTick: async () => {
                await this.postSaveProcessor.flushAsync();
                await this.auditLogger.flushAsync();
                await this.accessLogger.flushAsync();
            },
            start: true,
            waitForCompletion: true,
            errorHandler: (error) => {
                logError(`Error in cron job: ${error.message}`, error);
                throw error;
            }
        });
        logInfo(`Cron job started: ${cronJob.name}`);
    }
}

module.exports = {
    CronTasksProcessor
};
