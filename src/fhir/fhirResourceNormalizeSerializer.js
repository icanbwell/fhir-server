const { BaseFhirResourceSerializer } = require('./baseFhirResourceSerializer');

/**
 * Serializer for normalizing FHIR resources
 * Calls the normalize() method on BaseSerializer instances
 * This validates and removes fields that are not part of the FHIR specification
 */
class FhirResourceNormalizeSerializer extends BaseFhirResourceSerializer {
    static serializerMethod = 'normalize';
}

module.exports = {
    FhirResourceNormalizeSerializer
};
