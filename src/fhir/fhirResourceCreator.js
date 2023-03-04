const {getResource} = require('../operations/common/getResource');
const Resource = require('./classes/4_0_0/resources/resource');
const {assertIsValid} = require('../utils/assertType');
const {VERSIONS} = require('../middleware/fhir/utils/constants');

class FhirResourceCreator {
    /**
     * creates a resource
     * @param {Resource|Object} obj
     * @return {Resource}
     */
    static create(obj) {
        assertIsValid(obj, 'obj is null');
        if (obj instanceof Resource) {
            return obj;
        }
        const ResourceCreator = getResource(VERSIONS['4_0_0'], obj.resourceType);
        return new ResourceCreator(obj);
    }
}

module.exports = {
    FhirResourceCreator
};
