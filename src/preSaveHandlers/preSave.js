class PreSaveManager {
    /**
     * constructor
     * @param {import('./handlers/preSaveHandler').PreSaveHandler[]} preSaveHandlers
     */
    constructor ({ preSaveHandlers }) {
        /**
         * @type {import('./handlers/preSaveHandler').PreSaveHandler[]}
         */
        this.preSaveHandlers = preSaveHandlers;
    }

    /**
     * fixes up any resources before they are saved
     * @typedef {Object} PreSaveAsyncProps
     * @property {Object} resource
     * @property {import('./preSaveOptions').PreSaveOptions} [options]
     *
     * @param {PreSaveAsyncProps}
     * @returns {Promise<Object>}
     */
    async preSaveAsync ({ resource, options }) {
        for (const preSaveHandler of this.preSaveHandlers) {
            resource = await preSaveHandler.preSaveAsync({ resource, options });
        }
        return resource;
    }
}

module.exports = {
    PreSaveManager
};
