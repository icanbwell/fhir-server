// This file is auto-generated by generate_classes so do not edit manually

/** @type {import('../complex_types/extension.js')} */
let ExtensionSerializer;
/** @type {import('../backbone_elements/capabilityStatementInteraction.js')} */
let CapabilityStatementInteractionSerializer;
/** @type {import('../backbone_elements/capabilityStatementSearchParam.js')} */
let CapabilityStatementSearchParamSerializer;
/** @type {import('../backbone_elements/capabilityStatementOperation.js')} */
let CapabilityStatementOperationSerializer;

/**
 * Lazy loads the required serializers
 * It esnures that require is called only once for each serializer to minimize the call stack for require()
 * @returns {any}
 */
function initializeSerializers(serializerName) {
    initializeResourceSerializer()
    if (serializerName === 'Extension' && !ExtensionSerializer) {
        ExtensionSerializer = require('../complex_types/extension.js');
        return ExtensionSerializer;
    }
    if (serializerName === 'CapabilityStatementInteraction' && !CapabilityStatementInteractionSerializer) {
        CapabilityStatementInteractionSerializer = require('../backbone_elements/capabilityStatementInteraction.js');
        return CapabilityStatementInteractionSerializer;
    }
    if (serializerName === 'CapabilityStatementSearchParam' && !CapabilityStatementSearchParamSerializer) {
        CapabilityStatementSearchParamSerializer = require('../backbone_elements/capabilityStatementSearchParam.js');
        return CapabilityStatementSearchParamSerializer;
    }
    if (serializerName === 'CapabilityStatementOperation' && !CapabilityStatementOperationSerializer) {
        CapabilityStatementOperationSerializer = require('../backbone_elements/capabilityStatementOperation.js');
        return CapabilityStatementOperationSerializer;
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

class CapabilityStatementResourceSerializer {
    static propertyToSerializerMap = {
        id: null,
        extension: (value) => {
            initializeSerializers('Extension');
            return FhirResourceSerializer.serializeArray(value, ExtensionSerializer);
        },
        modifierExtension: (value) => {
            initializeSerializers('Extension');
            return FhirResourceSerializer.serializeArray(value, ExtensionSerializer);
        },
        type: null,
        profile: null,
        supportedProfile: null,
        documentation: null,
        interaction: (value) => {
            initializeSerializers('CapabilityStatementInteraction');
            return FhirResourceSerializer.serializeArray(value, CapabilityStatementInteractionSerializer);
        },
        versioning: null,
        readHistory: null,
        updateCreate: null,
        conditionalCreate: null,
        conditionalRead: null,
        conditionalUpdate: null,
        conditionalDelete: null,
        referencePolicy: null,
        searchInclude: null,
        searchRevInclude: null,
        searchParam: (value) => {
            initializeSerializers('CapabilityStatementSearchParam');
            return FhirResourceSerializer.serializeArray(value, CapabilityStatementSearchParamSerializer);
        },
        operation: (value) => {
            initializeSerializers('CapabilityStatementOperation');
            return FhirResourceSerializer.serializeArray(value, CapabilityStatementOperationSerializer);
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
            return rawJson.map(item => CapabilityStatementResourceSerializer.serialize(item));
        }

        // Handle non-object case
        if (typeof rawJson !== 'object') return rawJson;

        Object.keys(rawJson).forEach(propertyName => {
            const value = rawJson[propertyName];

            if (value === null || value === undefined) {
                delete rawJson[propertyName];
                return;
            }

            if (propertyName in CapabilityStatementResourceSerializer.propertyToSerializerMap) {
                if (CapabilityStatementResourceSerializer.propertyToSerializerMap[propertyName]) {
                    const serializedValue = CapabilityStatementResourceSerializer.propertyToSerializerMap[propertyName](value);
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

module.exports = CapabilityStatementResourceSerializer;
