const { assertTypeEquals } = require('../utils/assertType');
const Resource = require('../fhir/classes/4_0_0/resources/resource');

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
     * @property {import('../../fhir/classes/4_0_0/resources/resource')} resource
     *
     * @param {PreSaveAsyncProps}
     * @returns {Promise<import('../../fhir/classes/4_0_0/resources/resource')>}
     */
    async preSaveAsync ({ resource }) {
        assertTypeEquals(resource, Resource);

        for (const preSaveHandler of this.preSaveHandlers) {
            resource = await preSaveHandler.preSaveAsync({ resource });
            assertTypeEquals(resource, Resource,
                `return value ${typeof resource} from ${preSaveHandler.constructor.name} was not a resource`);
        }
        return resource;
    }
}

module.exports = {
    PreSaveManager
};
