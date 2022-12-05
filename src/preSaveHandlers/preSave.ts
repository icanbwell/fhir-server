class PreSaveManager {
    /**
     * constructor
     * @param {PreSaveHandler[]} preSaveHandlers
     */
    constructor(
        {
            preSaveHandlers
        }
    ) {
        /**
         * @type {PreSaveHandler[]}
         */
        this.preSaveHandlers = preSaveHandlers;
    }

    /**
     * fixes up any resources before they are saved
     * @param {Resource} resource
     * @returns {Promise<Resource>}
     */
    async preSaveAsync(resource) {
        for (const preSaveHandler of this.preSaveHandlers){
            resource = await preSaveHandler.preSaveAsync({resource});
        }
        return resource;
    }
}


module.exports = {
    PreSaveManager
};
