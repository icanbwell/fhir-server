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

    /**
     * Runs a background task and logs when it starts, finishes (with duration) or fails.
     * Errors are rethrown so the existing cron error handling is unchanged.
     * @param {string} taskName
     * @param {() => Promise<void>} fnTask
     * @return {Promise<void>}
     */
    async runTaskAsync(taskName, fnTask) {
        const startTime = Date.now();
        logInfo(`Background task started: ${taskName}`, { task: taskName });
        try {
            await fnTask();
            logInfo(`Background task finished: ${taskName}`, {
                task: taskName,
                durationMs: Date.now() - startTime
            });
        } catch (e) {
            logError(`Background task failed: ${taskName}`, {
                task: taskName,
                durationMs: Date.now() - startTime,
                error: e
            });
            throw e;
        }
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
                await this.runTaskAsync('postSaveProcessorFlush', () => this.postSaveProcessor.flushAsync());
                await this.runTaskAsync('auditLoggerFlush', () => this.auditLogger.flushAsync());
                await this.runTaskAsync('accessLoggerFlush', () => this.accessLogger.flushAsync());
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
