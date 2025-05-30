// This file is auto-generated by generate_classes so do not edit manually

/** @type {import('../complex_types/extension.js')} */
let ExtensionSerializer;
/** @type {import('../complex_types/codeableConcept.js')} */
let CodeableConceptSerializer;
/** @type {import('../complex_types/quantity.js')} */
let QuantitySerializer;
/** @type {import('../complex_types/money.js')} */
let MoneySerializer;
/** @type {import('../backbone_elements/explanationOfBenefitAdjudication.js')} */
let ExplanationOfBenefitAdjudicationSerializer;

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
    if (serializerName === 'Money' && !MoneySerializer) {
        MoneySerializer = require('../complex_types/money.js');
        return MoneySerializer;
    }
    if (serializerName === 'ExplanationOfBenefitAdjudication' && !ExplanationOfBenefitAdjudicationSerializer) {
        ExplanationOfBenefitAdjudicationSerializer = require('../backbone_elements/explanationOfBenefitAdjudication.js');
        return ExplanationOfBenefitAdjudicationSerializer;
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

class ExplanationOfBenefitSubDetail1Serializer {
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
        productOrService: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serialize(value, CodeableConceptSerializer);
        },
        modifier: (value) => {
            initializeSerializers('CodeableConcept');
            return FhirResourceSerializer.serializeArray(value, CodeableConceptSerializer);
        },
        quantity: (value) => {
            initializeSerializers('Quantity');
            return FhirResourceSerializer.serialize(value, QuantitySerializer);
        },
        unitPrice: (value) => {
            initializeSerializers('Money');
            return FhirResourceSerializer.serialize(value, MoneySerializer);
        },
        factor: null,
        net: (value) => {
            initializeSerializers('Money');
            return FhirResourceSerializer.serialize(value, MoneySerializer);
        },
        noteNumber: null,
        adjudication: (value) => {
            initializeSerializers('ExplanationOfBenefitAdjudication');
            return FhirResourceSerializer.serializeArray(value, ExplanationOfBenefitAdjudicationSerializer);
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
            return rawJson.map(item => ExplanationOfBenefitSubDetail1Serializer.serialize(item));
        }

        // Handle non-object case
        if (typeof rawJson !== 'object') return rawJson;

        Object.keys(rawJson).forEach(propertyName => {
            const value = rawJson[propertyName];

            if (value === null || value === undefined) {
                delete rawJson[propertyName];
                return;
            }

            if (propertyName in ExplanationOfBenefitSubDetail1Serializer.propertyToSerializerMap) {
                if (ExplanationOfBenefitSubDetail1Serializer.propertyToSerializerMap[propertyName]) {
                    const serializedValue = ExplanationOfBenefitSubDetail1Serializer.propertyToSerializerMap[propertyName](value);
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

module.exports = ExplanationOfBenefitSubDetail1Serializer;
