const MetaSerializer = require('../complex_types/meta.js');
const ExtensionSerializer = require('../complex_types/extension.js');
const IdentifierSerializer = require('../complex_types/identifier.js');
const ExportStatusEntrySerializer = require('./exportStatusEntry.js');

class ExportStatusSerialzer {
    static propertyToSerializerMap = {
        id: null,
        resourceType: null,
        meta: (value) => MetaSerializer.serialize(value),
        identifier: (value) => IdentifierSerializer.serialize(value),
        extension: (value) => ExtensionSerializer.serialize(value),
        status: null,
        requestUrl: null,
        requiresAccessToken: null,
        scope: null,
        user: null,
        transactionTime: null,
        output: (value) => ExportStatusEntrySerializer.serialize(value),
        errors: (value) => ExportStatusEntrySerializer.serialize(value)
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