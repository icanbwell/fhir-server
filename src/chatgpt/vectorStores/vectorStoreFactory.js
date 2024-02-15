const {BaseVectorStoreManager} = require('./baseVectorStoreManager');
const {assertTypeEquals} = require('../../utils/assertType');

/**
 * @classdesc Base factory to create a vector store from documents
 */
class VectorStoreFactory {
    /**
     * constructor
     * @param {BaseVectorStoreManager[]} vectorStoreManagers
     */
    constructor (
        {
            vectorStoreManagers
        }
    ) {
        this.vectorStoreManagers = vectorStoreManagers;
        for (const vectorStoreManager of this.vectorStoreManagers) {
            assertTypeEquals(vectorStoreManager, BaseVectorStoreManager);
        }
    }

    /**
     * creates a vector store from a list of langchain documents
     * @returns {Promise<BaseVectorStoreManager|undefined>}
     */
    async createVectorStoreAsync () {
        for (const vectorStoreManager of this.vectorStoreManagers) {
            if (await vectorStoreManager.isEnabledAsync()) {
                await vectorStoreManager.createVectorStoreAsync();
                return vectorStoreManager;
            }
        }
        return undefined;
    }
}

module.exports = {
    VectorStoreFactory
};
