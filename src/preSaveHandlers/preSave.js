const {assertTypeEquals} = require('../utils/assertType');
const Resource = require('../fhir/classes/4_0_0/resources/resource');

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
        for (const preSaveHandler of this.preSaveHandlers) {
            resource = await preSaveHandler.preSaveAsync({resource});
            assertTypeEquals(resource, Resource,
                `return value ${typeof resource} from ${preSaveHandler.constructor.name} was not a resource`);
        }
        return resource;
    }
}


module.exports = {
    PreSaveManager
};
