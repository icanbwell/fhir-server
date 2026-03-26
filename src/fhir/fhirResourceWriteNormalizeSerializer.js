const { FhirResourceWriteSerializer } = require('./fhirResourceWriteSerializer');

/**
 * Serializer for normalizing FHIR resources
 * Calls the normalize() method on BaseSerializer instances
 * This validates and removes fields that are not part of the FHIR specification
 */
class FhirResourceWriteNormalizeSerializer extends FhirResourceWriteSerializer {
    static serializerMethod = 'writeNormalize';
}

module.exports = {
    FhirResourceWriteNormalizeSerializer
};
