const { BaseFhirResourceSerializer } = require('./baseFhirResourceSerializer');

/**
 * Serializer for writing FHIR resources to the database
 * Calls the writeSerialize() method on BaseSerializer instances
 */
class FhirResourceWriteSerializer extends BaseFhirResourceSerializer {
    static serializerMethod = 'writeSerialize';
}

module.exports = {
    FhirResourceWriteSerializer
};
