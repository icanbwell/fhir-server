class PreSaveHandler {
    /**
     * fixes up any resources before they are saved
     * @typedef {Object} PreSaveAsyncProps
     * @property {import('../../fhir/classes/4_0_0/resources/resource')} resource
     * @property {import('../preSaveOptions').PreSaveOptions} [options]
     *
     * @param {PreSaveAsyncProps}
     * @returns {Promise<import('../../fhir/classes/4_0_0/resources/resource')>}
     */

    async preSaveAsync ({ resource, options }) {
        throw Error('Not Implemented');
    }
}

module.exports = {
    PreSaveHandler
};
