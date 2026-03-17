const { VERSIONS } = require('../middleware/fhir/utils/constants');
const { RethrownError } = require('../utils/rethrownError');
const { BadRequestError } = require('../utils/httpErrors');

// Lazy-load serializers to avoid circular dependency
let serializerR4B;
let serializerComplexTypeR4B;
let serializersCustom;

/**
 *
 * @param {String} version
 * @param {String} schema
 * @returns {import('./writeSerializers/4_0_0/customSerializers').BaseSerializer}
 */
const getSerializer = (version = '4_0_0', schema = '') => {
    if (!serializerR4B) {
        serializerR4B = require('./writeSerializers/4_0_0/resources');
        serializerComplexTypeR4B = require('./writeSerializers/4_0_0/complexTypes');
        serializersCustom = require('./writeSerializers/4_0_0/customSerializers');
    }

    const schemaName = `${schema[0].toLowerCase()}${schema.slice(1)}Serializer`;

    switch (version) {
        case '4_0_0':
            return serializerR4B[schemaName] || serializerComplexTypeR4B[schemaName] || serializersCustom[schemaName];
    }
};

/**
 * Base class for FHIR resource serializers
 * This abstract class provides common serialization logic that is shared across
 * Write, Read, and Normalize serializers
 */
class BaseFhirResourceSerializer {
    static serializerMethod = null;

    /**
     * serializes a resource
     * @typedef {Object} serializeParams
     * @property {Object} obj
     * @property {import('./writeSerializers/4_0_0/customSerializers/baseSerializer.js').BaseSerializer} [SerializerClass]
     * @property {Object} [context]
     *
     * @param {serializeParams} params
     * @return {Object}
     */
    static serialize({ obj, SerializerClass, context = {} }) {
        if (!obj) return obj;

        try {
            if (SerializerClass) {
                // Add resourceType to context if available
                const fullContext = obj.resourceType ? { ...context, resourceType: obj.resourceType } : context;
                return SerializerClass[this.serializerMethod](obj, fullContext);
            }
            if (!obj.resourceType) {
                // noinspection ExceptionCaughtLocallyJS
                throw new BadRequestError(new Error('resourceType is null'));
            }

            const serializer = getSerializer(VERSIONS['4_0_0'], obj.resourceType);

            if (!serializer) {
                throw new BadRequestError(
                    new Error(`Serialization of ResourceType ${obj.resourceType} is not supported`)
                );
            }
            // Add resourceType to context
            const fullContext = { ...context, resourceType: obj.resourceType };
            return serializer[this.serializerMethod](obj, fullContext);
        } catch (e) {
            throw new RethrownError({
                message: 'Error in serializing resource',
                error: e,
                args: {
                    resource: obj
                },
                source: `${this.name}.serialize`
            });
        }
    }

    /**
     * serializes a resource by specified resourceType
     * @typedef {Object} serializeByResourceTypeParams
     * @property {Object} obj
     * @property {string} resourceType
     * @property {Object} [context]
     *
     * @param {serializeByResourceTypeParams} params
     * @return {Object}
     */
    static serializeByResourceType({ obj, resourceType, context = {} }) {
        if (!obj) return obj;
        try {
            const serializer = getSerializer(VERSIONS['4_0_0'], resourceType);
            // Add resourceType to context
            const fullContext = { ...context, resourceType };
            return serializer[this.serializerMethod](obj, fullContext);
        } catch (e) {
            throw new RethrownError({
                message: 'Error in serializing resource',
                error: e,
                args: {
                    resource: obj
                },
                source: `${this.name}.serializeByResourceType`
            });
        }
    }

    /**
     * serializes an array of resources
     * @typedef {Object} serializeArrayParams
     * @property {Object | Object[]} obj
     * @property {import('./writeSerializers/4_0_0/customSerializers/baseSerializer.js').BaseSerializer} [SerializerClass]
     * @property {Object} [context]
     *
     * @param {serializeArrayParams} params
     * @return {Object[]}
     */
    static serializeArray({ obj, SerializerClass, context = {} }) {
        if (!obj) return obj;
        try {
            if (Array.isArray(obj)) {
                return obj.filter((v) => v).map((v) => this.serialize({ obj: v, SerializerClass, context }));
            } else {
                return [this.serialize({ obj, SerializerClass, context })];
            }
        } catch (e) {
            throw new RethrownError({
                message: 'Error in serializing resource',
                error: e,
                args: {
                    resource: obj
                },
                source: `${this.name}.serializeArray`
            });
        }
    }
}

module.exports = {
    BaseFhirResourceSerializer
};
