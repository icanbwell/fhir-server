const BaseSerializer = require('./baseSerializer.js');

/**
 * Write serializer for the BlobMeta internal-only complex type. BlobMeta describes
 * where a base64 payload has been offloaded to external blob storage; it must never
 * appear in public FHIR JSON responses, only in internal MongoDB documents.
 */
class BlobMetaSerializer extends BaseSerializer {
    fhirPropertyToSerializerMap = {
        rawReference: null,
        rawSize: null
    };

    allPropertyToSerializerMap = this.fhirPropertyToSerializerMap;
}

module.exports = new BlobMetaSerializer();
