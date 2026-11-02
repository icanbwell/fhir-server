class PreSaveHandler {
    /**
     * fixes up any resources before they are saved
     * @typedef {Object} PreSaveAsyncProps
     * @property {Object} resource
     * @property {import('../preSaveOptions').PreSaveOptions} [options]
     *
     * @param {PreSaveAsyncProps}
     * @returns {Promise<Object>}
     */

    async preSaveAsync ({ resource, options }) {
        throw Error('Not Implemented');
    }
}

module.exports = {
    PreSaveHandler
};
