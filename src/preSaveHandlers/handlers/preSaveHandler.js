class PreSaveHandler {
    /**
     * fixes up any resources before they are saved
     * @typedef {Object} PreSaveAsyncProps
     * @property {import('../../fhir/classes/4_0_0/resources/resource')} resource
     *
     * @param {PreSaveAsyncProps}
     * @returns {Promise<import('../../fhir/classes/4_0_0/resources/resource')>}
     */
    // eslint-disable-next-line no-unused-vars
    async preSaveAsync ({ resource }) {
        throw Error('Not Implemented');
    }
}

module.exports = {
    PreSaveHandler
};
