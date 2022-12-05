class PreSaveHandler {
    /**
     * fixes up any resources before they are saved
     * @param {Resource} resource
     * @returns {Promise<Resource>}
     */
    // eslint-disable-next-line no-unused-vars
    async preSaveAsync({resource}) {
        throw Error('Not Implemented');
    }
}

module.exports = {
    PreSaveHandler
};
