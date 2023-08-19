const {assertTypeEquals} = require('../utils/assertType');
const {BasePostSaveHandler} = require('../utils/basePostSaveHandler');

/**
 * @classdesc This class holds all the tasks to run after we insert/update a resource
 */
class PostSaveProcessor {
    /**
     * Constructor
     * @param {BasePostSaveHandler[]} handlers
     */
    constructor(
        {
            handlers
        }
    ) {
        /**
         * @type {BasePostSaveHandler[]}
         */
        this.handlers = handlers;
        for (const handler of handlers) {
            assertTypeEquals(handler, BasePostSaveHandler);
        }
    }

    /**
     * Fires events when a resource is changed
     * @param {string} requestId
     * @param {string} eventType.  Can be C = create or U = update
     * @param {string} resourceType
     * @param {Resource} doc
     * @return {Promise<void>}
     */
    async afterSaveAsync({requestId, eventType, resourceType, doc}) {
        for (const handler of this.handlers) {
            await handler.afterSaveAsync({requestId, eventType, resourceType, doc});
        }
    }

    /**
     * flushes the change event buffer
     * @param {string} requestId
     * @return {Promise<void>}
     */
    async flushAsync({requestId}) {
        for (const handler of this.handlers) {
            await handler.flushAsync({requestId});
        }
    }
}

module.exports = {
    PostSaveProcessor
};
