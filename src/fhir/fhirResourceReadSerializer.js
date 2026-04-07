const { BaseFhirResourceSerializer } = require('./baseFhirResourceSerializer');

/**
 * Serializer for reading FHIR resources from the database
 * Calls the readSerialize() method on BaseSerializer instances
 * This prepares resources for API responses by removing internal fields and applying enrichment
 */
class FhirResourceReadSerializer extends BaseFhirResourceSerializer {
    static serializerMethod = 'readSerialize';
}

module.exports = {
    FhirResourceReadSerializer
};
