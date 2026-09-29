const { BaseFhirResourceSerializer } = require('./baseFhirResourceSerializer');
const { RethrownError } = require('../utils/rethrownError');

/**
 * Serializer for writing FHIR resources to the database
 * Calls the writeSerialize() method on BaseSerializer instances
 */
class FhirResourceWriteSerializer extends BaseFhirResourceSerializer {
    static serializerMethod = 'writeSerialize';

    /**
     * serializes an array of resources
     * @typedef {Object} serializeArrayParams
     * @property {Object | Object[]} obj
     * @property {import('./writeSerializers/4_0_0/customSerializers').BaseSerializer} [SerializerClass]
     * @property {Object} [context]
     *
     * @param {serializeArrayParams} params
     * @return {Object[]}
     */
    static serializeArray({ obj, SerializerClass, context = {} }) {
        try {
            if (!obj) return null;
            let serializedArray;
            if (Array.isArray(obj)) {
                serializedArray = obj
                    .map((v) => this.serialize({ obj: v, SerializerClass, context }))
                    .filter((v) => v);
            } else {
                serializedArray = [this.serialize({ obj, SerializerClass, context })].filter(
                    (v) => v
                );
            }
            return serializedArray.length > 0 ? serializedArray : null;
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
    FhirResourceWriteSerializer
};
