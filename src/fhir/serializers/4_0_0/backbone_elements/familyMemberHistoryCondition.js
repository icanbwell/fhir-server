// This file is auto-generated by generate_classes so do not edit manually

/** @type {import('../complex_types/extension.js')} */
let ExtensionSerializer;
/** @type {import('../complex_types/codeableConcept.js')} */
let CodeableConceptSerializer;
/** @type {import('../complex_types/quantity.js')} */
let QuantitySerializer;
/** @type {import('../complex_types/range.js')} */
let RangeSerializer;
/** @type {import('../complex_types/period.js')} */
let PeriodSerializer;
/** @type {import('../complex_types/annotation.js')} */
let AnnotationSerializer;

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
    if (serializerName === 'CodeableConcept' && !CodeableConceptSerializer) {
        CodeableConceptSerializer = require('../complex_types/codeableConcept.js');
        return CodeableConceptSerializer;
    }
    if (serializerName === 'Quantity' && !QuantitySerializer) {
        QuantitySerializer = require('../complex_types/quantity.js');
        return QuantitySerializer;
    }
    if (serializerName === 'Range' && !RangeSerializer) {
        RangeSerializer = require('../complex_types/range.js');
        return RangeSerializer;
    }
    if (serializerName === 'Period' && !PeriodSerializer) {
        PeriodSerializer = require('../complex_types/period.js');
        return PeriodSerializer;
    }
    if (serializerName === 'Annotation' && !AnnotationSerializer) {
        AnnotationSerializer = require('../complex_types/annotation.js');
        return AnnotationSerializer;
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

class FamilyMemberHistoryConditionSerializer {
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
        code: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serialize(value, CodeableConceptSerializer);
        },
        outcome: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serialize(value, CodeableConceptSerializer);
        },
        contributedToDeath: null,
        onsetAge: (value) => {
            initializeSerializers('Quantity');
            return FhirResourceSerializer.serialize(value, QuantitySerializer);
        },
        onsetRange: (value) => {
            initializeSerializers('Range');
            return FhirResourceSerializer.serialize(value, RangeSerializer);
        },
        onsetPeriod: (value) => {
            initializeSerializers('Period');
            return FhirResourceSerializer.serialize(value, PeriodSerializer);
        },
        onsetString: null,
        note: (value) => {
            initializeSerializers('Annotation');
            return FhirResourceSerializer.serializeArray(value, AnnotationSerializer);
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
            return rawJson.map(item => FamilyMemberHistoryConditionSerializer.serialize(item));
        }

        // Handle non-object case
        if (typeof rawJson !== 'object') return rawJson;

        Object.keys(rawJson).forEach(propertyName => {
            const value = rawJson[propertyName];

            if (value === null || value === undefined) {
                delete rawJson[propertyName];
                return;
            }

            if (propertyName in FamilyMemberHistoryConditionSerializer.propertyToSerializerMap) {
                if (FamilyMemberHistoryConditionSerializer.propertyToSerializerMap[propertyName]) {
                    const serializedValue = FamilyMemberHistoryConditionSerializer.propertyToSerializerMap[propertyName](value);
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

module.exports = FamilyMemberHistoryConditionSerializer;
