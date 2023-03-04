const {getResource} = require('../operations/common/getResource');
const Resource = require('./classes/4_0_0/resources/resource');
const {assertIsValid} = require('../utils/assertType');
const {VERSIONS} = require('../middleware/fhir/utils/constants');

class FhirResourceCreator {
    /**
     * creates a resource
     * @param {Resource|Object} obj
     * @param {*} [ResourceConstructor]
     * @return {Resource}
     */
    static create(obj, ResourceConstructor) {
        assertIsValid(obj, 'obj is null');
        if (obj instanceof Resource) {
            return obj;
        }
        if (ResourceConstructor) {
            return new ResourceConstructor(obj);
        }
        const ResourceCreator = getResource(VERSIONS['4_0_0'], obj.resourceType);
        return new ResourceCreator(obj);
    }

    /**
     * creates an array of resources
     * @param {Resource|Object|Resource[]|Object[]} obj
     * @param {*} [ResourceConstructor]
     * @return {Resource[]}
     */
    static createArray(obj, ResourceConstructor) {
        if (Array.isArray(obj)) {
            return obj
                .filter(v => v)
                .map(v => FhirResourceCreator.create(v, ResourceConstructor));
        } else {
            return [
                FhirResourceCreator.create(obj, ResourceConstructor)
            ];
        }
    }
}

module.exports = {
    FhirResourceCreator
};
