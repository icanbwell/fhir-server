const cron = require('node-cron');
const { assertTypeEquals, assertIsValid } = require('../utils/assertType');
const { BasePostSaveHandler } = require('../utils/basePostSaveHandler');
const { RethrownError } = require('../utils/rethrownError');
const { ConfigManager } = require('../utils/configManager');
const { logInfo } = require('../operations/common/logging');

/**
 * @classdesc This class holds all the tasks to run after we insert/update a resource
 */
class PostSaveProcessor {
    /**
     * Constructor
     * @typedef params
     * @property {BasePostSaveHandler[]} handlers
     * @property {ConfigManager} configManager
     *
     * @param {params}
     */
    constructor (
        {
            handlers,
            configManager
        }
    ) {
        /**
         * @type {BasePostSaveHandler[]}
         */
        this.handlers = handlers;
        for (const handler of handlers) {
            assertTypeEquals(handler, BasePostSaveHandler);
        }

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        assertIsValid(cron.validate(this.configManager.postRequestFlushTime), 'Invalid cron expression');
        const cronTask = cron.schedule(
            this.configManager.postRequestFlushTime,
            async () => {
                await this.flushAsync();
            },
            { name: 'PostSaveProcessor Cron' }
        );
        cronTask.on('execution:missed', (ctx) => {
            logInfo('Missed execution of scheduled-cron', { name: ctx.task.name });
        });
    }

    /**
     * Fires events when a resource is changed
     * @param {string} requestId
     * @param {string} eventType.  Can be C = create or U = update
     * @param {string} resourceType
     * @param {Resource} doc
     * @return {Promise<void>}
     */
    async afterSaveAsync ({ requestId, eventType, resourceType, doc }) {
        try {
            for (const handler of this.handlers) {
                await handler.afterSaveAsync({ requestId, eventType, resourceType, doc });
            }
        } catch (e) {
            throw new RethrownError({
                message: 'Error in afterSaveAsync(): ', error: e
            });
        }
    }

    /**
     * flushes the change event buffer
     * @return {Promise<void>}
     */
    async flushAsync () {
        for (const handler of this.handlers) {
            await handler.flushAsync();
        }
    }
}

module.exports = {
    PostSaveProcessor
};
