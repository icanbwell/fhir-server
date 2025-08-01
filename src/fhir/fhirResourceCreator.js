const { getResource } = require('../operations/common/getResource');
const Resource = require('./classes/4_0_0/resources/resource');
const { assertIsValid } = require('../utils/assertType');
const { VERSIONS } = require('../middleware/fhir/utils/constants');
const { RethrownError } = require('../utils/rethrownError');
const { BadRequestError } = require('../utils/httpErrors');
const BundleEntry = require('../fhir/classes/4_0_0/backbone_elements/bundleEntry');

class FhirResourceCreator {
    /**
     * creates a resource
     * @param {Resource|Object} obj
     * @param {*} [ResourceConstructor]
     * @return {Resource}
     */
    static create (obj, ResourceConstructor) {
        assertIsValid(obj, 'obj is null');
        try {
            if (obj instanceof Resource) {
                return obj;
            }
            if (ResourceConstructor) {
                return new ResourceConstructor(obj);
            }
            if (!obj.resourceType) {
                // noinspection ExceptionCaughtLocallyJS
                throw new BadRequestError(new Error('resourceType is null'));
            }
            const ResourceCreator = getResource(VERSIONS['4_0_0'], obj.resourceType);
            if (!ResourceCreator) {
                throw new BadRequestError(new Error(`ResourceType ${obj.resourceType} is not supported`));
            }
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
    static createByResourceType (obj, resourceType) {
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
    static createArray (obj, ResourceConstructor) {
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

    /**
     * maps a doc from the database into a Resource Object or BundleEntry
     * @param {Object} doc
     * @param {string} classResourceType
     * @return {Resource|BundleEntry}
     */
    static mapDocumentToResourceObject(doc, classResourceType) {
        const resourceType = doc.resource ? 'BundleEntry' : doc.resourceType || classResourceType;
        try {
            if (resourceType === 'BundleEntry') {
                return new BundleEntry(doc);
            }
            return FhirResourceCreator.createByResourceType(doc, resourceType);
        } catch (e) {
            throw new RethrownError({
                message: 'Error in mapping resource to Resource Object',
                error: e,
                args: {
                    resource: doc
                },
                source: 'FhirResourceCreator.mapDocumentToResourceObject'
            });
        }
    }
}

module.exports = {
    FhirResourceCreator
};
