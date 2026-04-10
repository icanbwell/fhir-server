const { getResourceSerializer } = require('../operations/common/getResourceSerializer');
const { VERSIONS } = require('../middleware/fhir/utils/constants');
const { RethrownError } = require('../utils/rethrownError');
const { BadRequestError } = require('../utils/httpErrors');

class FhirResourceSerializer {
    /**
     * @type {import('../utils/configManager').ConfigManager}
     */
    static configManager = null;

    /**
     * @param {import('../utils/configManager').ConfigManager} configManager
     */
    static setConfigManager(configManager) {
        FhirResourceSerializer.configManager = configManager;
    }

    /**
     * Builds a default context with configManager if not already present
     * @param {Object} context
     * @returns {Object}
     */
    static getContext(context) {
        if (!context || !context.configManager) {
            return { ...context, configManager: FhirResourceSerializer.configManager };
        }
        return context;
    }

    /**
     * serializes a resource
     * @param {Resource|Object} obj
     * @param {{ serialize: (obj, context) => obj}} [SerializerClass]
     * @param {Object} [context]
     * @return {obj}
     */
    static serialize(obj, SerializerClass, context) {
        if (!obj) return obj;

        context = FhirResourceSerializer.getContext(context);

        try {

            if (SerializerClass) {
                return SerializerClass.serialize(obj, context)
            }
            if (!obj.resourceType) {
                // noinspection ExceptionCaughtLocallyJS
                throw new BadRequestError(new Error('resourceType is null'));
            }

            const serializer = getResourceSerializer(VERSIONS['4_0_0'], obj.resourceType);

            if (!serializer) {
                throw new BadRequestError(new Error(`Serialization of ResourceType ${obj.resourceType} is not supported`));
            }
            return serializer.serialize(obj, context);
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
     * @param {Object} [context]
     * @return {obj}
     */
    static serializeByResourceType(obj, resourceType, context) {
        if (!obj) return obj;
        context = FhirResourceSerializer.getContext(context);
        try {
            const serializer = getResourceSerializer(VERSIONS['4_0_0'], resourceType);
            return serializer.serialize(obj, context);
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
     * @param {{ serialize: (obj, context) => obj}} [SerializerClass]
     * @param {Object} [context]
     * @return {obj[]}
     */
    static serializeArray(obj, SerializerClass, context) {
        if (!obj) return obj;
        context = FhirResourceSerializer.getContext(context);
        try {
            if (Array.isArray(obj)) {
                return obj
                    .filter(v => v)
                    .map(v => FhirResourceSerializer.serialize(v, SerializerClass, context));
            } else {
                return [
                    FhirResourceSerializer.serialize(obj, SerializerClass, context)
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
