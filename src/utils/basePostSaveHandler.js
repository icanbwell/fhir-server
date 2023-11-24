class BasePostSaveHandler {
    /**
     * Fires events when a resource is changed
     * @param {string} requestId
     * @param {string} eventType.  Can be C = create or U = update
     * @param {string} resourceType
     * @param {Resource} doc
     * @return {Promise<void>}
     */
    // eslint-disable-next-line no-unused-vars
    async afterSaveAsync({requestId, eventType, resourceType, doc}) {
        throw new Error('Not Implemented by subclass');
    }

    /**
     * flushes the change event buffer
     * @return {Promise<void>}
     */
    // eslint-disable-next-line no-unused-vars
    async flushAsync() {
    }
}

module.exports = {
    BasePostSaveHandler
};
