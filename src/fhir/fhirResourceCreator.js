const {getResource} = require('../operations/common/getResource');
const Resource = require('./classes/4_0_0/resources/resource');
const {assertIsValid} = require('../utils/assertType');
const {VERSIONS} = require('../middleware/fhir/utils/constants');
const {RethrownError} = require('../utils/rethrownError');

class FhirResourceCreator {
    /**
     * creates a resource
     * @param {Resource|Object} obj
     * @param {*} [ResourceConstructor]
     * @return {Resource}
     */
    static create(obj, ResourceConstructor) {
        assertIsValid(obj, 'obj is null');
        try {
            if (obj instanceof Resource) {
                return obj;
            }
            if (ResourceConstructor) {
                return new ResourceConstructor(obj);
            }
            const ResourceCreator = getResource(VERSIONS['4_0_0'], obj.resourceType);
            return new ResourceCreator(obj);
        } catch (e) {
            throw new RethrownError(
                {
                    message: 'Error in creating resource',
                    error: e,
                    args: {
                        resource: obj
                    },
                    source: 'FhirResourceCreator.create'
                }
            );
        }
    }

    /**
     * creates a resource by specified resourceType
     * @param {Resource|Object} obj
     * @param {string} resourceType
     * @return {Resource}
     */
    static createByResourceType(obj, resourceType) {
        assertIsValid(obj, 'obj is null');
        try {
            if (obj instanceof Resource
            ) {
                return obj;
            }
            const ResourceCreator = getResource(VERSIONS['4_0_0'], resourceType);
            return new ResourceCreator(obj);
        } catch (e) {
            throw new RethrownError(
                {
                    message: 'Error in creating resource',
                    error: e,
                    args: {
                        resource: obj
                    },
                    source: 'FhirResourceCreator.createByResourceType'
                }
            );
        }
    }

    /**
     * creates an array of resources
     * @param {Resource|Object|Resource[]|Object[]} obj
     * @param {*} [ResourceConstructor]
     * @return {Resource[]}
     */
    static createArray(obj, ResourceConstructor) {
        try {
            if (Array.isArray(obj)) {
                return obj
                    .filter(v => v)
                    .map(v => FhirResourceCreator.create(v, ResourceConstructor));
            } else {
                return [
                    FhirResourceCreator.create(obj, ResourceConstructor)
                ];
            }
        } catch (e) {
            throw new RethrownError(
                {
                    message: 'Error in creating resource',
                    error: e,
                    args: {
                        resource: obj
                    },
                    source: 'FhirResourceCreator.createArray'
                }
            );
        }
    }
}

module.exports = {
    FhirResourceCreator
};
