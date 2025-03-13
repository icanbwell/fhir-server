const { getResourceSerializer } = require('../operations/common/getResourceSerializer');
const { VERSIONS } = require('../middleware/fhir/utils/constants');
const { RethrownError } = require('../utils/rethrownError');
const { BadRequestError } = require('../utils/httpErrors');

class FhirResourceSerializer {
    /**
     * serializes a resource
     * @param {Resource|Object} obj
     * @param {{ serialize: (obj) => obj}} [SerializerClass]
     * @return {obj}
     */
    static serialize(obj, SerializerClass) {
        if (!obj) return obj;

        try {

            if (SerializerClass) {
                return SerializerClass.serialize(obj)
            }
            if (!obj.resourceType) {
                // noinspection ExceptionCaughtLocallyJS
                throw new BadRequestError(new Error('resourceType is null'));
            }

            const serializer = getResourceSerializer(VERSIONS['4_0_0'], obj.resourceType);

            if (!serializer) {
                throw new BadRequestError(new Error(`Serialization of ResourceType ${obj.resourceType} is not supported`));
            }
            return serializer.serialize(obj);
        } catch (e) {
            throw new RethrownError(
                {
                    message: 'Error in serializing resource',
                    error: e,
                    args: {
                        resource: obj
                    },
                    source: 'FhirResourceSerializer.serialize'
                }
            );
        }
    }

    /**
     * serializes a resource by specified resourceType
     * @param {obj} obj
     * @param {string} resourceType
     * @return {obj}
     */
    static serializeByResourceType(obj, resourceType) {
        if (!obj) return obj;
        try {
            const serializer = getResourceSerializer(VERSIONS['4_0_0'], resourceType);
            return serializer.serialize(obj);
        } catch (e) {
            throw new RethrownError(
                {
                    message: 'Error in serializing resource',
                    error: e,
                    args: {
                        resource: obj
                    },
                    source: 'FhirResourceSerializer.serializeByResourceType'
                }
            );
        }
    }

    /**
     * serializes an array of resources
     * @param {obj | obj[]} obj
     * @param {{ serialize: (obj) => obj}} [SerializerClass]
     * @return {obj[]}
     */
    static serializeArray(obj, SerializerClass) {
        if (!obj) return obj;
        try {
            if (Array.isArray(obj)) {
                return obj
                    .filter(v => v)
                    .map(v => FhirResourceSerializer.serialize(v, SerializerClass));
            } else {
                return [
                    FhirResourceSerializer.serialize(obj, SerializerClass)
                ];
            }
        } catch (e) {
            throw new RethrownError(
                {
                    message: 'Error in serializing resource',
                    error: e,
                    args: {
                        resource: obj
                    },
                    source: 'FhirResourceSerializer.serializeArray'
                }
            );
        }
    }
}

module.exports = {
    FhirResourceSerializer
};
