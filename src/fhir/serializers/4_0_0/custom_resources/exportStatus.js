/** @type {import('../complex_types/meta.js')} */
let Meta;
/** @type {import('../complex_types/identifier.js')} */
let Identifier;
/** @type {import('../complex_types/extension.js')} */
let Extension;
/** @type {import('../custom_resources/exportStatusEntry.js')} */
let ExportStatusEntry;

/**
 * Lazy loads the required serializers
 * It esnures that require is called only once for each serializer to minimize the call stack for require()
 * @returns {any}
 */
function initializeSerializers(serializerName) {
    initializeResourceSerializer()
    if (serializerName === 'Meta' && !Meta) {
        Meta = require('../complex_types/meta.js');
        return Meta;
    }
    if (serializerName === 'Extension' && !Extension) {
        Extension = require('../complex_types/extension.js');
        return Extension;
    }
    if (serializerName === 'Identifier' && !Identifier) {
        Identifier = require('../complex_types/identifier.js');
        return Identifier;
    }
    if (serializerName === 'ExportStatusEntrySerializer' && !ExportStatusEntry) {
        ExportStatusEntry = require('../custom_resources/exportStatusEntry.js');
        return ExportStatusEntry;
    }
}

/** @type {import('../../../fhirResourceSerializer.js').FhirResourceSerializer} */
let FhirResourceSerializer;

function initializeResourceSerializer() {
    if (!FhirResourceSerializer) {
        FhirResourceSerializer = require('../../../fhirResourceSerializer.js').FhirResourceSerializer;
    }

    return FhirResourceSerializer;
}

class ExportStatusSerialzer {
    static propertyToSerializerMap = {
        id: null,
        resourceType: null,
        meta: (value) => {
            initializeSerializers('Meta');
            return FhirResourceSerializer.serialize(value, Meta);
        },
        identifier: (value) => {
            initializeSerializers('Identifier');
            return FhirResourceSerializer.serializeArray(value, Identifier);
        },
        extension: (value) => {
            initializeSerializers('Extension');
            return FhirResourceSerializer.serializeArray(value, Extension);
        },
        status: null,
        requestUrl: null,
        requiresAccessToken: null,
        scope: null,
        user: null,
        transactionTime: null,
        output: (value) => {
            initializeSerializers('Extension');
            return FhirResourceSerializer.serializeArray(value, ExportStatusEntry);
        },
        errors: (value) => {
            initializeSerializers('Extension');
            return FhirResourceSerializer.serializeArray(value, ExportStatusEntry);
        }
    };

    /**
     * This methods cleans the raw json by removing additional fields which are not defined
     * according to FHIR Specs
     * @param {any} rawJson
     * @returns {any} Cleaned object
     */
    static serialize(rawJson) {
        if (!rawJson) return rawJson;

        // Handle array case
        if (Array.isArray(rawJson)) {
            return rawJson.map(item => ExportStatusSerialzer.serialize(item));
        }

        // Handle non-object case
        if (typeof rawJson !== 'object') return rawJson;

        Object.keys(rawJson).forEach(propertyName => {
            const value = rawJson[propertyName];

            if (value === null || value === undefined) {
                delete rawJson[propertyName];
                return;
            }

            if (propertyName in ExportStatusSerialzer.propertyToSerializerMap) {
                if (ExportStatusSerialzer.propertyToSerializerMap[propertyName]) {
                    const serializedValue = ExportStatusSerialzer.propertyToSerializerMap[propertyName](value);
                    if (serializedValue === null || serializedValue === undefined) {
                        delete rawJson[propertyName];
                    } else {
                        rawJson[propertyName] = serializedValue;
                    }
                }
            } else {
                delete rawJson[propertyName];
            }
        });

        return rawJson;
    }
}

module.exports = ExportStatusSerialzer;
