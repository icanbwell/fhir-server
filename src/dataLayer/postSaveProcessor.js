const { assertTypeEquals } = require('../utils/assertType');
const { BasePostSaveHandler } = require('../utils/basePostSaveHandler');
const { RethrownError } = require('../utils/rethrownError');
const { logInfo, logError } = require('../operations/common/logging');

/**
 * A handler flush at least this long is logged, so a stalled handler can be identified
 * without logging every fast flush.
 */
const SLOW_HANDLER_FLUSH_THRESHOLD_MS = 1000;

/**
 * @classdesc This class holds all the tasks to run after we insert/update a resource
 */
class PostSaveProcessor {
    /**
     * Constructor
     * @typedef params
     * @property {BasePostSaveHandler[]} handlers
     *
     * @param {params}
     */
    constructor({ handlers }) {
        /**
         * @type {BasePostSaveHandler[]}
         */
        this.handlers = handlers;
        for (const handler of handlers) {
            assertTypeEquals(handler, BasePostSaveHandler);
        }
    }

    /**
     * Checks if any handler requires synchronous writes for this resource type
     * @param {string} resourceType
     * @return {boolean}
     */
    needsSyncFor ({ resourceType }) {
        for (const handler of this.handlers) {
            if (typeof handler.shouldBlockForResource === 'function' &&
                handler.shouldBlockForResource(resourceType)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Fires events when a resource is changed
     * @param {string} requestId
     * @param {string} eventType.  Can be C = create or U = update
     * @param {string} resourceType
     * @param {Resource} doc
     * @param {Object|null} contextData
     * @return {Promise<void>}
     */
    async afterSaveAsync ({ requestId, eventType, resourceType, doc, contextData = null }) {
        try {
            for (const handler of this.handlers) {
                await handler.afterSaveAsync({ requestId, eventType, resourceType, doc, contextData });
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
            const handlerName = handler.constructor.name;
            const startTime = Date.now();
            try {
                await handler.flushAsync();
            } catch (e) {
                logError(`Post-save handler flush failed: ${handlerName}`, {
                    handler: handlerName,
                    durationMs: Date.now() - startTime,
                    errMessage: e.message
                });
                throw e;
            }
            const durationMs = Date.now() - startTime;
            if (durationMs >= SLOW_HANDLER_FLUSH_THRESHOLD_MS) {
                logInfo(`Slow post-save handler flush finished: ${handlerName}`, {
                    handler: handlerName,
                    durationMs
                });
            }
        }
    }
}

module.exports = {
    PostSaveProcessor,
    SLOW_HANDLER_FLUSH_THRESHOLD_MS
};
